import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const mocks = vi.hoisted(() => ({ authUserId: "", sendPushToUser: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("@/lib/notifications/push", () => ({ sendPushToUser: mocks.sendPushToUser }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

import { db } from "@/lib/db";
import { acceptPlanVersionAtomic } from "@/lib/ai-coach/plan-acceptance";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { runExecutorSweep } from "@/lib/ai-coach/executor";
import {
  drainAcceptanceNotifications,
  MAX_NOTIFICATION_ATTEMPTS,
  DRAIN_BATCH_LIMIT,
} from "@/lib/ai-coach/acceptance-notifications";
import { AI_PLAN_ACCEPTANCE_PUSH, type AiPlanNotificationResult } from "@/lib/notifications/ai-coach-plan";
import { getReviewerOperations } from "@/lib/ai-coach/reviewer-operations";
import { getAcceptanceDeliveryState } from "@/lib/ai-coach/operations";
import type { Prisma } from "@/app/generated/prisma/client";

suite("T-502 — acceptance-notification drain with real PostgreSQL constraints", () => {
  const originalPublicationFlag = process.env.FEATURE_AI_COACH_PUBLICATION;
  const originalGenerationFlag = process.env.FEATURE_AI_COACH_GENERATION;
  const originalFixtureMode = process.env.AI_COACH_FIXTURE_MODE;

  // A stable, file-unique email domain marker (T-502 review round 1, MINOR
  // 4/8). Every user this file creates, in every run, gets this domain, so
  // this file can find and clean up ONLY its own rows — including ones
  // left pending by an earlier run of this same file against a database
  // that isn't reset between runs — without ever touching another
  // integration file's fixtures. A table-wide `updateMany`/`deleteMany`
  // (the previous approach) is unsafe under parallelism or a reordered
  // suite; this is scoped by construction instead.
  const OWNED_EMAIL_DOMAIN = "t502-acceptance-notifications.example.test";

  async function ownedClientIds(): Promise<string[]> {
    const owned = await db.user.findMany({
      where: { email: { endsWith: `@${OWNED_EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    return owned.map((u) => u.id);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue({ sent: true, result: { success: true, status: 200 } });
    process.env.FEATURE_AI_COACH_PUBLICATION = "true";
    // Retire only THIS file's own still-pending rows (see
    // OWNED_EMAIL_DOMAIN above) before each test, so every test starts
    // from a candidate pool containing none of this file's own earlier
    // leftovers, without touching any other suite's fixtures.
    const ids = await ownedClientIds();
    if (ids.length > 0) {
      await db.aiPlanAcceptanceOutbox.updateMany({
        where: { processedAt: null, clientId: { in: ids } },
        data: { processedAt: new Date(0), deliveryOutcome: "SUPPRESSED_STALE", nextAttemptAt: null },
      });
    }
  });
  afterEach(async () => {
    if (originalPublicationFlag === undefined) delete process.env.FEATURE_AI_COACH_PUBLICATION;
    else process.env.FEATURE_AI_COACH_PUBLICATION = originalPublicationFlag;
    if (originalGenerationFlag === undefined) delete process.env.FEATURE_AI_COACH_GENERATION;
    else process.env.FEATURE_AI_COACH_GENERATION = originalGenerationFlag;
    if (originalFixtureMode === undefined) delete process.env.AI_COACH_FIXTURE_MODE;
    else process.env.AI_COACH_FIXTURE_MODE = originalFixtureMode;
    vi.unstubAllEnvs();
    await db.aiCoachOperationalControl.deleteMany({ where: { scope: "ACCEPTANCE" } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  // ── fixtures ────────────────────────────────────────────────────────────

  async function makeClient(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    const id = randomUUID();
    return db.user.create({
      data: {
        clerkId: id,
        email: `${id}@${OWNED_EMAIL_DOMAIN}`,
        isCoach: false,
        isClient: true,
        pushMealPlanUpdates: true,
        ...overrides,
      },
    });
  }

  async function makeEligibleAiClient() {
    const client = await makeClient({ apnsToken: "device-token" });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI", revision: 0 } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({ data: { clientId: client.id } });
    return client;
  }

  async function makeCandidate(clientId: string, overrides: Partial<Prisma.AiPlanVersionUncheckedCreateInput> = {}) {
    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId } });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId } });
    const latest = await db.aiPlanVersion.findFirst({ where: { clientId }, orderBy: { version: "desc" } });
    return db.aiPlanVersion.create({
      data: {
        clientId,
        version: (latest?.version ?? 0) + 1,
        baseVersionId: profile.activePlanVersionId,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload: { schemaVersion: 1, nutrition: null, meals: null, strength: [], cardio: [] },
        payloadHash: "test-hash",
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        policyVersion: ACTIVE_POLICY_VERSION,
        catalogVersions: {},
        ...overrides,
      },
    });
  }

  function acceptInputFor(candidate: {
    baseVersionId: string | null;
    contextRevision: number;
    profileRevision: number;
    observationRevision: number;
    safetyRevision: number;
  }) {
    return {
      requestKey: randomUUID(),
      expectedBaseVersionId: candidate.baseVersionId,
      expectedContextRevision: candidate.contextRevision,
      expectedProfileRevision: candidate.profileRevision,
      expectedObservationRevision: candidate.observationRevision,
      expectedSafetyRevision: candidate.safetyRevision,
    };
  }

  /** A minimal, directly-created ACCEPTED plan version + pending outbox row —
   * for tests that exercise the drain without going through the full
   * acceptance service. */
  async function makeOutboxRow(clientId: string, overrides: Partial<Prisma.AiPlanAcceptanceOutboxUncheckedCreateInput> = {}) {
    const latest = await db.aiPlanVersion.findFirst({ where: { clientId }, orderBy: { version: "desc" } });
    const plan = await db.aiPlanVersion.create({
      data: {
        clientId,
        version: (latest?.version ?? 0) + 1,
        status: "ACCEPTED",
        acceptedAt: new Date(),
        payload: {},
        payloadHash: "hash",
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        policyVersion: "p1",
        catalogVersions: {},
      },
    });
    return db.aiPlanAcceptanceOutbox.create({
      data: { clientId, planVersionId: plan.id, ...overrides },
    });
  }

  async function outboxRow(id: string) {
    return db.aiPlanAcceptanceOutbox.findUniqueOrThrow({ where: { id } });
  }

  /** A qualified reviewer grant covering exactly one synthetic client, for
   * the `getReviewerOperations`/`notificationDelivery` assertions. Caller
   * is responsible for deleting the returned grant afterward. */
  async function makeReviewerFor(clientId: string) {
    process.env.AI_COACH_FIXTURE_MODE = "true";
    const reviewer = await makeClient({ isCoach: true, isClient: false });
    await db.aiCoachProfile.upsert({
      where: { clientId },
      create: { clientId, isSynthetic: true },
      update: { isSynthetic: true },
    });
    const grant = await db.aiCoachReviewerGrant.create({
      data: { userId: reviewer.id, qualificationNote: "SYNTHETIC", clientIds: [clientId], domains: ["NUTRITION"] },
    });
    return { reviewer, grant };
  }

  const failingSend = async (): Promise<AiPlanNotificationResult> => ({
    status: "FAILED",
    errorCode: "APNS_UNAVAILABLE",
    budgetConsumed: true,
  });

  // T-502 review round 2, MINOR 2: tests that assert EXACT claimed/pending
  // counts must not depend on cross-file ordering. `tests/integration/ai-
  // coach-plan-acceptance.test.ts` creates outbox rows and never drains
  // them; if such a foreign row happens to be older than a test's own
  // fixtures, it would be selected ahead of them and change the exact
  // count. Pin fixture `createdAt` values to a controlled point safely in
  // the past — old enough that any row created "now" by a concurrently
  // run file is always newer, but still comfortably inside the 48h
  // STALE_AFTER_MS window so the stale pass doesn't retire them first.
  const SAFE_OLD_OFFSET_MS = 47 * 3_600_000; // 47h ago: < 48h stale cutoff, ≫ any same-run "now"
  function safeOldTimestamp(offsetMs = 0): Date {
    return new Date(Date.now() - SAFE_OLD_OFFSET_MS + offsetMs);
  }

  // ── 1. row created on accept → drained once ───────────────────────────

  it("delivers a row the real acceptance path creates, exactly once, and marks it DELIVERED", async () => {
    const client = await makeEligibleAiClient();
    const candidate = await makeCandidate(client.id);
    const accepted = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
    expect(accepted).toMatchObject({ success: true });

    const created = await db.aiPlanAcceptanceOutbox.findUniqueOrThrow({ where: { planVersionId: candidate.id } });
    expect(created.processedAt).toBeNull();

    const summary = await runExecutorSweep();
    expect(summary.notifications.delivered).toBeGreaterThanOrEqual(1);
    const callsForClient = mocks.sendPushToUser.mock.calls.filter(([id]) => id === client.id);
    expect(callsForClient).toHaveLength(1);
    expect(callsForClient[0][1]).toMatchObject(AI_PLAN_ACCEPTANCE_PUSH);

    const finalRow = await outboxRow(created.id);
    expect(finalRow).toMatchObject({ deliveryOutcome: "DELIVERED", attempts: 1 });
    expect(finalRow.processedAt).not.toBeNull();

    await runExecutorSweep();
    const callsAfterSecondSweep = mocks.sendPushToUser.mock.calls.filter(([id]) => id === client.id);
    expect(callsAfterSecondSweep).toHaveLength(1);
  });

  // ── 2. concurrent sweeps deliver once ──────────────────────────────────

  it("delivers exactly once under two concurrent sweeps (the claim-conditional-update regression)", async () => {
    const client = await makeClient();
    const row = await makeOutboxRow(client.id);
    const send = vi.fn(async (): Promise<AiPlanNotificationResult> => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: "RESOLVED", outcome: "DELIVERED" };
    });

    const [a, b] = await Promise.all([
      drainAcceptanceNotifications({ send }),
      drainAcceptanceNotifications({ send }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(a.claimed + b.claimed).toBe(1);
    const final = await outboxRow(row.id);
    expect(final.attempts).toBe(1);
    expect(final.deliveryOutcome).toBe("DELIVERED");
  });

  // ── 3. send failure → backoff, then terminal ───────────────────────────

  it("backs off on repeated failure and abandons after the budget is exhausted", async () => {
    // Assertions below check this ROW's own state deltas, never the
    // drain's global summary counts — the outbox table is shared across
    // this whole suite (and across repeated runs against the same local
    // database), so a global "claimed === 1" can be polluted by another
    // test's still-pending row becoming due at the same injected `now`.
    const client = await makeClient();
    const row = await makeOutboxRow(client.id);
    let cursor = new Date(Date.now() + 10_000);

    // pass 1
    await drainAcceptanceNotifications({ now: cursor, send: failingSend });
    let current = await outboxRow(row.id);
    expect(current.processedAt).toBeNull();
    expect(current.attempts).toBe(1);
    expect(current.lastErrorCode).toBe("APNS_UNAVAILABLE");
    expect(current.nextAttemptAt).not.toBeNull();
    expect(current.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(cursor.getTime() + 5 * 60_000 - 1000);
    expect(current.nextAttemptAt!.getTime()).toBeLessThanOrEqual(cursor.getTime() + 5 * 60_000 + 1000);

    // a pass before nextAttemptAt is due must not call send at all, and
    // must not touch this row.
    const earlySend = vi.fn(failingSend);
    await drainAcceptanceNotifications({ now: cursor, send: earlySend });
    expect(earlySend).not.toHaveBeenCalled();
    const afterEarly = await outboxRow(row.id);
    expect(afterEarly.attempts).toBe(current.attempts);
    expect(afterEarly.nextAttemptAt).toEqual(current.nextAttemptAt);

    // passes 2..5 — the backoff GROWS each pass (RETRY_DELAYS_MS indexed by
    // the row's attempts count at the start of that pass), so the cursor
    // must clear each successive delay, not a fixed increment.
    const growingDelaysMs = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
    for (let i = 2; i <= MAX_NOTIFICATION_ATTEMPTS; i++) {
      cursor = new Date(cursor.getTime() + growingDelaysMs[Math.min(i - 2, growingDelaysMs.length - 1)] + 60_000);
      const before = await outboxRow(row.id);
      await drainAcceptanceNotifications({ now: cursor, send: failingSend });
      const after = await outboxRow(row.id);
      expect(after.attempts).toBe(before.attempts + 1);
    }

    current = await outboxRow(row.id);
    expect(current.processedAt).not.toBeNull();
    expect(current.deliveryOutcome).toBe("ABANDONED");
    expect(current.attempts).toBe(MAX_NOTIFICATION_ATTEMPTS);

    // a sixth pass never calls send and never touches this (now terminal) row
    cursor = new Date(cursor.getTime() + 6 * 3_600_000 + 60_000);
    const sixthSend = vi.fn(failingSend);
    await drainAcceptanceNotifications({ now: cursor, send: sixthSend });
    expect(sixthSend).not.toHaveBeenCalled();
    const finalRow = await outboxRow(row.id);
    expect(finalRow.attempts).toBe(MAX_NOTIFICATION_ATTEMPTS);
  });

  // ── 4. PUSH_CONFIG_MISSING does not consume budget ─────────────────────

  it("never abandons a row on PUSH_CONFIG_MISSING, because a missing env var must not consume the attempt budget", async () => {
    const client = await makeClient();
    const row = await makeOutboxRow(client.id);
    const configMissingSend = async (): Promise<AiPlanNotificationResult> => ({
      status: "FAILED",
      errorCode: "PUSH_CONFIG_MISSING",
      budgetConsumed: false,
    });

    let cursor = new Date(Date.now() + 10_000);
    for (let i = 0; i < 10; i++) {
      const summary = await drainAcceptanceNotifications({ now: cursor, send: configMissingSend });
      expect(summary.claimed).toBe(1);
      cursor = new Date(cursor.getTime() + 6 * 60_000);
    }

    const final = await outboxRow(row.id);
    expect(final.processedAt).toBeNull();
    expect(final.attempts).toBeLessThanOrEqual(1);
    expect(final.deliveryOutcome).toBeNull();
  });

  // ── 5. deleted / closed client is dropped, not retried forever ─────────

  it.each([
    ["deactivated client", async (c: { id: string }) => db.user.update({ where: { id: c.id }, data: { isDeactivated: true } })],
    [
      "pending account deletion request",
      async (c: { id: string }) =>
        db.accountDeletionRequest.create({
          data: { userId: c.id, status: "PENDING", scheduledPurgeAt: new Date(Date.now() + 86400000), roleAtRequest: "CLIENT" },
        }),
    ],
    ["non-client account", async (c: { id: string }) => db.user.update({ where: { id: c.id }, data: { isClient: false } })],
  ] as const)("terminal after one pass, send never called: %s", async (_label, mutate) => {
    const client = await makeClient({ apnsToken: "device-token" });
    await mutate(client);
    const row = await makeOutboxRow(client.id);

    const summary = await drainAcceptanceNotifications();
    expect(summary.suppressed).toBeGreaterThanOrEqual(1);

    const final = await outboxRow(row.id);
    expect(final.processedAt).not.toBeNull();
    expect(final.deliveryOutcome).toBe("SUPPRESSED_ACCOUNT_CLOSED");
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  // ── 6. preference off is honoured ──────────────────────────────────────

  it("honours pushMealPlanUpdates: false without ever calling sendPushToUser", async () => {
    const client = await makeClient({ apnsToken: "device-token", pushMealPlanUpdates: false });
    const row = await makeOutboxRow(client.id);

    await drainAcceptanceNotifications();

    const final = await outboxRow(row.id);
    expect(final.processedAt).not.toBeNull();
    expect(final.deliveryOutcome).toBe("SUPPRESSED_PREFERENCE");
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  // ── 7. 48-hour cutoff ───────────────────────────────────────────────────

  it("retires a row older than 48 hours as SUPPRESSED_STALE without ever sending, and excludes it from pendingNotifications", async () => {
    const client = await makeClient();
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    const row = await makeOutboxRow(client.id, { createdAt: tenDaysAgo });

    const summary = await drainAcceptanceNotifications();
    expect(summary.stale).toBeGreaterThanOrEqual(1);

    const final = await outboxRow(row.id);
    expect(final.processedAt).not.toBeNull();
    expect(final.deliveryOutcome).toBe("SUPPRESSED_STALE");
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();

    const { reviewer, grant } = await makeReviewerFor(client.id);
    const ops = await getReviewerOperations(reviewer.id);
    expect(ops.pendingNotifications).toBe(0);
    await db.aiCoachReviewerGrant.delete({ where: { id: grant.id } });
  });

  // ── 8. one client, two pending rows → one push ─────────────────────────

  it("collapses two pending rows for one client into a single delivered push, superseding the older", async () => {
    const client = await makeClient({ apnsToken: "device-token" });
    const older = await makeOutboxRow(client.id, { createdAt: new Date(Date.now() - 60_000) });
    const newer = await makeOutboxRow(client.id, { createdAt: new Date() });

    const summary = await drainAcceptanceNotifications();
    expect(summary.superseded).toBeGreaterThanOrEqual(1);
    expect(summary.delivered).toBeGreaterThanOrEqual(1);

    const finalOlder = await outboxRow(older.id);
    const finalNewer = await outboxRow(newer.id);
    expect(finalOlder.deliveryOutcome).toBe("SUPPRESSED_SUPERSEDED");
    expect(finalNewer.deliveryOutcome).toBe("DELIVERED");

    const callsForClient = mocks.sendPushToUser.mock.calls.filter(([id]) => id === client.id);
    expect(callsForClient).toHaveLength(1);
  });

  // ── 8b. supersede-window overflow (T-502 review round 1, MAJOR 3) ──────

  it("still dedupes a client's two pending rows inside the claim loop once more than 200 rows are pending, outside the supersede pass's window", async () => {
    const dedupClient = await makeClient();
    // Both of dedupClient's rows are the OLDEST in the table; 200 other
    // clients' rows are all newer. The bulk supersede pass only looks at
    // the newest 200 pending rows (`acceptance-notifications.ts`'s own
    // `take: 200`), so with 200 strictly-newer rows filling that window,
    // it never even sees dedupClient's pair — reproducing the exact gap
    // the claim-loop dedupe exists to close.
    const base = safeOldTimestamp().getTime();
    const oldestA = await makeOutboxRow(dedupClient.id, { createdAt: new Date(base) });
    const oldestB = await makeOutboxRow(dedupClient.id, { createdAt: new Date(base + 1) });
    for (let i = 0; i < 200; i++) {
      const other = await makeClient();
      await makeOutboxRow(other.id, { createdAt: new Date(base + 10 + i) });
    }

    const sendCalls: string[] = [];
    const send = async (clientId: string): Promise<AiPlanNotificationResult> => {
      sendCalls.push(clientId);
      return { status: "RESOLVED", outcome: "DELIVERED" };
    };

    // dedupClient's two rows are literally the two oldest in the entire
    // table, so both land in the oldest-DRAIN_BATCH_LIMIT candidate slate.
    const summary = await drainAcceptanceNotifications({ send, limit: DRAIN_BATCH_LIMIT });
    expect(summary.claimed).toBe(DRAIN_BATCH_LIMIT);

    const callsForDedupClient = sendCalls.filter((id) => id === dedupClient.id);
    expect(callsForDedupClient).toHaveLength(1);

    const finalA = await outboxRow(oldestA.id);
    const finalB = await outboxRow(oldestB.id);
    expect([finalA.deliveryOutcome, finalB.deliveryOutcome].sort()).toEqual(["DELIVERED", "SUPPRESSED_SUPERSEDED"]);
  });

  // ── 9. batch bound ──────────────────────────────────────────────────────

  it("claims at most DRAIN_BATCH_LIMIT in one pass across many distinct clients; the remainder stay pending", async () => {
    const rows: { id: string }[] = [];
    for (let i = 0; i < 25; i++) {
      const client = await makeClient();
      // Pinned safely-in-the-past (T-502 review round 2, MINOR 2) so a
      // foreign pending row from another file can never rank ahead of
      // these 25 and change the exact claimed/pending split asserted
      // below.
      const row = await makeOutboxRow(client.id, { createdAt: safeOldTimestamp(i) });
      rows.push(row);
    }

    const summary = await drainAcceptanceNotifications({ send: failingSend });
    expect(summary.claimed).toBeLessThanOrEqual(DRAIN_BATCH_LIMIT);

    const finalRows = await db.aiPlanAcceptanceOutbox.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    const claimedAmongMine = finalRows.filter((r) => r.attempts > 0).length;
    const pendingAmongMine = finalRows.filter((r) => r.attempts === 0).length;
    // Exact, not just bounded (T-502 review round 1, MINOR 7 — a drain
    // that silently claimed zero rows previously satisfied every
    // assertion here). This file's `beforeEach` retires only its OWN
    // domain-marked leftovers, so these 25 freshly created rows are the
    // only T502-owned candidates in the pool at this point.
    expect(claimedAmongMine).toBe(DRAIN_BATCH_LIMIT);
    expect(pendingAmongMine).toBe(25 - DRAIN_BATCH_LIMIT);
  });

  // ── 10. no-op proof with the flag unset ────────────────────────────────

  it("is a strict no-op when FEATURE_AI_COACH_PUBLICATION is unset, proven against a fresh row and a stale row alike", async () => {
    delete process.env.FEATURE_AI_COACH_PUBLICATION;
    const client = await makeClient();
    const freshRow = await makeOutboxRow(client.id);
    const staleRow = await makeOutboxRow(client.id, { createdAt: new Date(Date.now() - 10 * 86400000) });

    const before = { fresh: await outboxRow(freshRow.id), stale: await outboxRow(staleRow.id) };

    const summary = await runExecutorSweep();
    expect(summary.notifications).toMatchObject({ skipped: true, reason: "FLAG_OFF", claimed: 0, stale: 0 });
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();

    const after = { fresh: await outboxRow(freshRow.id), stale: await outboxRow(staleRow.id) };
    for (const key of ["processedAt", "attempts", "nextAttemptAt", "deliveryOutcome", "lastErrorCode"] as const) {
      expect(after.fresh[key]).toEqual(before.fresh[key]);
      expect(after.stale[key]).toEqual(before.stale[key]);
    }
  });

  // ── 11. operational pause ──────────────────────────────────────────────

  it("pauses delivery via the ACCEPTANCE operational control and reports PAUSED to the reviewer panel", async () => {
    await db.aiCoachOperationalControl.upsert({
      where: { scope: "ACCEPTANCE" },
      create: { scope: "ACCEPTANCE", disabled: true, reasonCode: "SYNTHETIC_TEST", updatedByGrantId: "synthetic-grant" },
      update: { disabled: true, reasonCode: "SYNTHETIC_TEST", updatedByGrantId: "synthetic-grant" },
    });

    const client = await makeClient();
    const row = await makeOutboxRow(client.id);

    const summary = await runExecutorSweep();
    expect(summary.notifications.reason).toBe("PAUSED");
    const untouched = await outboxRow(row.id);
    expect(untouched.processedAt).toBeNull();
    expect(untouched.attempts).toBe(0);

    const { reviewer, grant } = await makeReviewerFor(client.id);
    const ops = await getReviewerOperations(reviewer.id);
    expect(ops.notificationDelivery).toBe("PAUSED");
    await db.aiCoachReviewerGrant.delete({ where: { id: grant.id } });
  });

  // ── 11b. the other two delivery states are reachable and correctly
  // reported too (T-502 review round 1, MAJOR 4 — only PAUSED had any
  // coverage; ENABLED was also the one MAJOR 1 proved could be wrong) ────

  it("reports ENABLED to the reviewer panel when the flag is on and nothing pauses delivery", async () => {
    const client = await makeClient();
    const { reviewer, grant } = await makeReviewerFor(client.id);
    const ops = await getReviewerOperations(reviewer.id);
    expect(ops.notificationDelivery).toBe("ENABLED");
    await db.aiCoachReviewerGrant.delete({ where: { id: grant.id } });
  });

  it("reports DISABLED_BY_FLAG to the reviewer panel when FEATURE_AI_COACH_PUBLICATION is unset", async () => {
    delete process.env.FEATURE_AI_COACH_PUBLICATION;
    const client = await makeClient();
    const { reviewer, grant } = await makeReviewerFor(client.id);
    const ops = await getReviewerOperations(reviewer.id);
    expect(ops.notificationDelivery).toBe("DISABLED_BY_FLAG");
    await db.aiCoachReviewerGrant.delete({ where: { id: grant.id } });
  });

  // ── 11c. production, no ACCEPTANCE control row → PAUSED, never a false
  // ENABLED (T-502 review round 1, MAJOR 1) ───────────────────────────────

  it("getAcceptanceDeliveryState reads PAUSED in production with no ACCEPTANCE control row — the exact state MAJOR 1 found reading as a false ENABLED", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // No AiCoachOperationalControl row for scope ACCEPTANCE exists — this
    // file's afterEach deletes it every test, and none is created here —
    // which is the state a fresh production environment is actually in
    // before governance ever touches the switch. Before the MAJOR 1 fix,
    // getReviewerOperations's own hand-rolled check
    // (`acceptanceControl?.disabled ? "PAUSED" : ...`) read this as
    // ENABLED, because `acceptanceControl` is `null`/falsy here just like
    // "not disabled". The real gate's fail-closed default
    // (`NODE_ENV === "production" && !control`) always read this as
    // paused; the two disagreed. `getAcceptanceDeliveryState` now IS the
    // gate's own check, so there is nothing left to disagree.
    const state = await getAcceptanceDeliveryState();
    expect(state).toBe("PAUSED");
  });

  // ── 12. a drain fault cannot break the generation sweep ────────────────

  it("never lets a drain fault break the generation sweep", async () => {
    vi.doMock("@/lib/ai-coach/acceptance-notifications", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/ai-coach/acceptance-notifications")>();
      return { ...actual, drainAcceptanceNotifications: vi.fn().mockRejectedValue(new Error("synthetic drain fault")) };
    });
    vi.resetModules();
    const { runExecutorSweep: sweepWithFaultingDrain } = await import("@/lib/ai-coach/executor");

    process.env.FEATURE_AI_COACH_GENERATION = "true";
    const client = await makeClient();
    // The generation claim-select is table-wide (`orderBy: createdAt asc,
    // take: MAX_CONCURRENT_CLAIMS_PER_SWEEP`), same shared-table caveat as
    // the outbox: a stale QUEUED row left by another integration file
    // (e.g. ai-coach-executor.test.ts's own concurrency-cap fixtures) can
    // otherwise crowd this test's run out of the batch. Rather than
    // deleting rows this file doesn't own (T-502 review round 1, MINOR 8 —
    // that broke whichever suite owned them), pin this run's `createdAt`
    // to the epoch so it sorts first regardless of what else is QUEUED.
    const run = await db.aiCoachRun.create({
      data: {
        clientId: client.id,
        kind: "WEEKLY_REVIEW",
        businessKey: randomUUID(),
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        createdAt: new Date(0),
      },
    });

    const summary = await sweepWithFaultingDrain();
    expect(summary.notifications.reason).toBe("ERRORED");
    expect(summary.claimed).toBeGreaterThanOrEqual(1);

    // The run may legitimately checkpoint back to QUEUED after one stage —
    // that is not "stuck", so assert it was actually claimed/advanced via
    // its attempt counter rather than its (possibly cyclical) status.
    const finalRun = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(finalRun.attempts).toBeGreaterThanOrEqual(1);

    vi.doUnmock("@/lib/ai-coach/acceptance-notifications");
    vi.resetModules();
  });

  // ── 12b. a non-AiCoachError gate throw cannot break the generation sweep
  // either (T-502 review round 1, MAJOR 2) ────────────────────────────────

  it("never lets a gate resolving ERRORED break the generation sweep", async () => {
    // Mocks the GATE (`getAcceptanceDeliveryState`, the single shared
    // function `runAcceptanceNotificationPhase` now consumes — T-502
    // review round 2, MINOR 1), not the drain. This is the exact bug: in
    // production, `assertAiCoachOperationEnabled("ACCEPTANCE")` (called
    // from inside `getAcceptanceDeliveryState`) can throw `LiveLaunchError`
    // (not `AiCoachError`) from its own live-launch check, which
    // `getAcceptanceDeliveryState` now classifies as `"ERRORED"`. An
    // earlier version of `runAcceptanceNotificationPhase` only caught
    // `AiCoachError` at its own separate call site and let anything else
    // escape, 500ing the cron and stopping generation over a
    // notification-gate problem. Mocking `assertAiCoachOperationEnabled`
    // alone would no longer reach this path — it is called from INSIDE
    // `getAcceptanceDeliveryState`'s own module scope, not re-imported by
    // the executor — so this mocks the gate's own outcome directly.
    vi.doMock("@/lib/ai-coach/operations", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/ai-coach/operations")>();
      return {
        ...actual,
        getAcceptanceDeliveryState: vi.fn().mockResolvedValue("ERRORED"),
      };
    });
    vi.resetModules();
    const { runExecutorSweep: sweepWithFaultingGate } = await import("@/lib/ai-coach/executor");

    process.env.FEATURE_AI_COACH_GENERATION = "true";
    const client = await makeClient();
    const run = await db.aiCoachRun.create({
      data: {
        clientId: client.id,
        kind: "WEEKLY_REVIEW",
        businessKey: randomUUID(),
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        createdAt: new Date(0),
      },
    });

    const summary = await sweepWithFaultingGate();
    expect(summary.notifications.reason).toBe("ERRORED");
    expect(summary.claimed).toBeGreaterThanOrEqual(1);

    const finalRun = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(finalRun.attempts).toBeGreaterThanOrEqual(1);

    vi.doUnmock("@/lib/ai-coach/operations");
    vi.resetModules();
  });

  // ── 13. `disabled` still means generation only ──────────────────────────

  it("keeps disabled=true meaning 'generation only' while the notification drain still runs and delivers", async () => {
    delete process.env.FEATURE_AI_COACH_GENERATION;
    const client = await makeClient({ apnsToken: "device-token" });
    const row = await makeOutboxRow(client.id);

    const summary = await runExecutorSweep();
    expect(summary).toMatchObject({ disabled: true, claimed: 0 });

    const final = await outboxRow(row.id);
    expect(final.deliveryOutcome).toBe("DELIVERED");
    expect(final.processedAt).not.toBeNull();
  });
});
