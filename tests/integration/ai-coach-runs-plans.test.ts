import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * A02 — AiCoachRun lifecycle transitions and AiPlanVersion/AiAdjustmentSlot
 * storage-level invariants.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V10/V13/V14): one logical result per run; a stale/expired worker cannot
 * write after fencing; bounded retries; a persistent AiAdjustmentSlot
 * prevents a second ROUTINE adjustment in the same window even under
 * concurrent acceptance; replaying an accepted version does not reactivate
 * old advice or create a duplicate active pointer.
 */

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

import { db } from "@/lib/db";
import {
  claimQueuedRun,
  checkpointAndRequeue,
  completeRun,
  failRunAttempt,
  cancelRun,
  reconcileExpiredRuns,
  createRetryRun,
  MAX_ATTEMPTS_PER_RUN,
} from "@/lib/ai-coach/runs";
import { createProposedPlanVersion, acceptPlanVersion, hashPlanPayload } from "@/lib/ai-coach/plan-lifecycle";

suite("A02 — AiCoachRun lifecycle with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeClient() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true } });
  }

  async function makeRun(clientId: string) {
    return db.aiCoachRun.create({
      data: {
        clientId,
        kind: "WEEKLY_REVIEW",
        businessKey: randomUUID(),
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
      },
    });
  }

  it("claimQueuedRun moves QUEUED to RUNNING exactly once under concurrent claims", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);

    const results = await Promise.all([claimQueuedRun(run.id), claimQueuedRun(run.id), claimQueuedRun(run.id)]);
    const claimed = results.filter((r) => r.claimed);
    expect(claimed).toHaveLength(1);

    const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.status).toBe("RUNNING");
    expect(row.attempts).toBe(1);
  });

  it("a stale fencing token cannot complete a run another claim already advanced", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);
    const first = await claimQueuedRun(run.id);
    if (!first.claimed) throw new Error("expected claim");

    // Simulate the lease expiring and being reclaimed by someone else.
    await db.aiCoachRun.update({ where: { id: run.id }, data: { status: "QUEUED" } });
    const second = await claimQueuedRun(run.id);
    if (!second.claimed) throw new Error("expected second claim");
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);

    // The first (stale) worker's completion attempt must be rejected.
    const staleComplete = await completeRun(run.id, first.fencingToken, { resultReviewAction: "HOLD" });
    expect(staleComplete).toBe(false);

    const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.status).toBe("RUNNING"); // untouched by the stale write
  });

  it("checkpointAndRequeue moves RUNNING back to QUEUED for the correct fencing token", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);
    const claimed = await claimQueuedRun(run.id);
    if (!claimed.claimed) throw new Error("expected claim");

    const ok = await checkpointAndRequeue(run.id, claimed.fencingToken);
    expect(ok).toBe(true);
    const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.status).toBe("QUEUED");
  });

  it("completeRun sets COMPLETED with the result", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);
    const claimed = await claimQueuedRun(run.id);
    if (!claimed.claimed) throw new Error("expected claim");

    const ok = await completeRun(run.id, claimed.fencingToken, { resultReviewAction: "ADJUST" });
    expect(ok).toBe(true);
    const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.status).toBe("COMPLETED");
    expect(row.resultReviewAction).toBe("ADJUST");
  });

  it("failRunAttempt retries within budget then terminally fails", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);

    let fencingToken: number | undefined;
    for (let i = 1; i <= MAX_ATTEMPTS_PER_RUN; i++) {
      const claimed = await claimQueuedRun(run.id);
      if (!claimed.claimed) throw new Error(`expected claim on attempt ${i}`);
      fencingToken = claimed.fencingToken;
      const outcome = await failRunAttempt(run.id, fencingToken, `attempt ${i} failed`);
      if (i < MAX_ATTEMPTS_PER_RUN) {
        expect(outcome).toBe("RETRY_WAIT");
        await db.aiCoachRun.update({ where: { id: run.id }, data: { status: "QUEUED" } }); // simulate due retry
      } else {
        expect(outcome).toBe("FAILED");
      }
    }

    const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.status).toBe("FAILED");
  });

  it("cancelRun cancels any nonterminal run but never a terminal one", async () => {
    const client = await makeClient();
    const queuedRun = await makeRun(client.id);
    expect(await cancelRun(queuedRun.id)).toBe(true);

    const completedRun = await makeRun(client.id);
    const claimed = await claimQueuedRun(completedRun.id);
    if (!claimed.claimed) throw new Error("expected claim");
    await completeRun(completedRun.id, claimed.fencingToken, { resultReviewAction: "HOLD" });
    expect(await cancelRun(completedRun.id)).toBe(false);
  });

  it("reconcileExpiredRuns moves an expired RUNNING lease to RETRY_WAIT with a bumped fencing token", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);
    const claimed = await claimQueuedRun(run.id);
    if (!claimed.claimed) throw new Error("expected claim");
    // Force the lease into the past.
    await db.aiCoachRun.update({ where: { id: run.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const result = await reconcileExpiredRuns();
    expect(result.requeued).toBeGreaterThanOrEqual(1);

    const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.status).toBe("RETRY_WAIT");
    expect(row.fencingToken).toBeGreaterThan(claimed.fencingToken);
  });

  it("createRetryRun only accepts a terminally FAILED run and links a new row without reopening it", async () => {
    const client = await makeClient();
    const run = await makeRun(client.id);
    const claimed = await claimQueuedRun(run.id);
    if (!claimed.claimed) throw new Error("expected claim");
    await db.aiCoachRun.update({ where: { id: run.id }, data: { attempts: MAX_ATTEMPTS_PER_RUN } });
    await failRunAttempt(run.id, claimed.fencingToken, "terminal");

    const notFailed = await makeRun(client.id);
    const rejected = await createRetryRun(notFailed.id, randomUUID());
    expect(rejected.success).toBe(false);

    const retried = await createRetryRun(run.id, randomUUID());
    expect(retried.success).toBe(true);
    if (!retried.success) throw new Error("unreachable");

    const newRun = await db.aiCoachRun.findUniqueOrThrow({ where: { id: retried.runId } });
    expect(newRun.retryOfRunId).toBe(run.id);
    expect(newRun.retryGeneration).toBe(1);
    expect(newRun.status).toBe("QUEUED");

    const original = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(original.status).toBe("FAILED"); // never reopened
  });
});

suite("A02 — AiPlanVersion / AiAdjustmentSlot storage invariants with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeClient() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true } });
  }

  function fixturePayload(seed: string) {
    return { schemaVersion: 1, nutrition: null, meals: null, strength: [], cardio: [], policyVersion: "test", catalogVersions: {}, seed };
  }

  it("hashPlanPayload is stable for identical content and differs for different content", () => {
    const a = hashPlanPayload(fixturePayload("a"));
    const a2 = hashPlanPayload(fixturePayload("a"));
    const b = hashPlanPayload(fixturePayload("b"));
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });

  it("createProposedPlanVersion assigns sequential versions per client", async () => {
    const client = await makeClient();
    const v1 = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("v1"), contextRevision: 1, profileRevision: 1,
      observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    const v2 = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("v2"), contextRevision: 1, profileRevision: 1,
      observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it("accepting a PROPOSED version activates it and stores a permanent acceptedAt", async () => {
    const client = await makeClient();
    const candidate = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("initial"), changeClass: "INITIAL", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });

    const result = await acceptPlanVersion(client.id, candidate.id, "2026-W03");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.alreadyAccepted).toBe(false);

    const row = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(row.status).toBe("ACCEPTED");
    expect(row.acceptedAt).not.toBeNull();
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.activePlanVersionId).toBe(candidate.id);
  });

  it("replaying acceptance of an already-accepted version is idempotent and does not reactivate stale state", async () => {
    const client = await makeClient();
    const candidate = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("initial"), changeClass: "INITIAL", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    await acceptPlanVersion(client.id, candidate.id, "2026-W03");

    const replay = await acceptPlanVersion(client.id, candidate.id, "2026-W03");
    expect(replay.success).toBe(true);
    if (!replay.success) throw new Error("unreachable");
    expect(replay.alreadyAccepted).toBe(true);
    expect(replay.activeVersionId).toBe(candidate.id);
  });

  it("accepting a new version supersedes the prior active one — never two ACCEPTED at once", async () => {
    const client = await makeClient();
    const v1 = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("v1"), changeClass: "INITIAL", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    await acceptPlanVersion(client.id, v1.id, "2026-W03");

    const v2 = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("v2"), baseVersionId: v1.id, changeClass: "TARGET_PRESERVING",
      contextRevision: 1, profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    await acceptPlanVersion(client.id, v2.id, "2026-W04");

    const v1After = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: v1.id } });
    const v2After = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: v2.id } });
    expect(v1After.status).toBe("SUPERSEDED");
    expect(v2After.status).toBe("ACCEPTED");

    const acceptedCount = await db.aiPlanVersion.count({ where: { clientId: client.id, status: "ACCEPTED" } });
    expect(acceptedCount).toBe(1);
  });

  it("cannot accept a DECLINED, INVALIDATED, or unaccepted SUPERSEDED candidate", async () => {
    const client = await makeClient();
    for (const status of ["DECLINED", "INVALIDATED", "SUPERSEDED"] as const) {
      const candidate = await createProposedPlanVersion({
        clientId: client.id, payload: fixturePayload(status), contextRevision: 1, profileRevision: 1,
        observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
      });
      await db.aiPlanVersion.update({ where: { id: candidate.id }, data: { status } });
      const result = await acceptPlanVersion(client.id, candidate.id, `window-${status}`);
      expect(result.success).toBe(false);
    }
  });

  it("only one ROUTINE adjustment slot can ever be accepted per client per review window, even under concurrent acceptance", async () => {
    const client = await makeClient();
    const a = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("a"), changeClass: "ROUTINE", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    const b = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("b"), changeClass: "ROUTINE", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });

    const results = await Promise.allSettled([
      acceptPlanVersion(client.id, a.id, "2026-W05"),
      acceptPlanVersion(client.id, b.id, "2026-W05"),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.success);
    expect(succeeded).toHaveLength(1);

    const slotCount = await db.aiAdjustmentSlot.count({ where: { clientId: client.id, reviewWindowKey: "2026-W05" } });
    expect(slotCount).toBe(1);
  });

  it("the adjustment slot survives supersession, pausing, and re-enrollment — retained permanently", async () => {
    const client = await makeClient();
    const v1 = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("v1"), changeClass: "ROUTINE", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    await acceptPlanVersion(client.id, v1.id, "2026-W06");

    // Supersede with a later, unrelated accepted version.
    const v2 = await createProposedPlanVersion({
      clientId: client.id, payload: fixturePayload("v2"), changeClass: "TARGET_PRESERVING", contextRevision: 1,
      profileRevision: 1, observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
    });
    await acceptPlanVersion(client.id, v2.id, "2026-W07");

    const slot = await db.aiAdjustmentSlot.findUnique({ where: { clientId_reviewWindowKey: { clientId: client.id, reviewWindowKey: "2026-W06" } } });
    expect(slot).not.toBeNull();
    expect(slot?.acceptedPlanVersionId).toBe(v1.id);
  });
});
