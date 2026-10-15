import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ authUserId: "" }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: table-wide AI Coach state; runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { claimQueuedRun, completeRun, reconcileExpiredRuns, type ClaimResult } from "@/lib/ai-coach/runs";
import { runExecutorSweep, processClaimedRun } from "@/lib/ai-coach/executor";
import { getRunStatusForClient } from "@/lib/ai-coach/run-status";
import { GET as getRunStatusRoute } from "@/app/api/client/ai-coach/runs/[runId]/route";
import { GET as executorCronRoute } from "@/app/api/cron/ai-coach-executor/route";
import type { ModelProvider, ModelStageResult } from "@/lib/ai-coach/provider/adapter";
import {
  checkProviderRateLimit,
  MAX_TOKENS_PER_STAGE_CALL,
} from "@/lib/ai-coach/provider/spend-limits";

suite("A05 — durable job executor with real PostgreSQL constraints", () => {
  const originalGenerationFlag = process.env.FEATURE_AI_COACH_GENERATION;
  const originalCronSecret = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env.FEATURE_AI_COACH_GENERATION = originalGenerationFlag;
    process.env.CRON_SECRET = originalCronSecret;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  /** T-503: AiCoachOperationalControl is process-wide global state shared
   * with other suites (e.g. ai-coach-release-drills.test.ts) — capture
   * whatever was there before a test disables GENERATION and restore it
   * unconditionally so a failure here can never leave the kill switch
   * disabled for a later run against this database. */
  async function withDisabledGenerationControl<T>(fn: () => Promise<T>): Promise<T> {
    const prior = await db.aiCoachOperationalControl.findUnique({ where: { scope: "GENERATION" } });
    await db.aiCoachOperationalControl.upsert({
      where: { scope: "GENERATION" },
      create: {
        scope: "GENERATION",
        disabled: true,
        reasonCode: "T503_SYNTHETIC_GOVERNANCE_PAUSE_TEST",
        updatedByGrantId: "synthetic-t503-test-grant",
      },
      update: { disabled: true, reasonCode: "T503_SYNTHETIC_GOVERNANCE_PAUSE_TEST" },
    });
    try {
      return await fn();
    } finally {
      if (prior) {
        await db.aiCoachOperationalControl.update({
          where: { scope: "GENERATION" },
          data: {
            disabled: prior.disabled,
            reasonCode: prior.reasonCode,
            incidentReference: prior.incidentReference,
            updatedByGrantId: prior.updatedByGrantId,
          },
        });
      } else {
        await db.aiCoachOperationalControl.deleteMany({ where: { scope: "GENERATION" } });
      }
    }
  }

  async function makeClient() {
    const id = randomUUID();
    return db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true },
    });
  }

  async function makeQueuedRun(clientId: string, createdAt?: Date) {
    return db.aiCoachRun.create({
      data: {
        clientId,
        kind: "WEEKLY_REVIEW",
        businessKey: randomUUID(),
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        ...(createdAt !== undefined ? { createdAt } : {}),
      },
    });
  }

  async function claimFreshRun(clientId: string) {
    const run = await makeQueuedRun(clientId);
    const claim = await claimQueuedRun(run.id);
    if (!claim.claimed) throw new Error("unreachable — freshly created run must be claimable");
    return claim as Extract<ClaimResult, { claimed: true }>;
  }

  class StubProvider implements ModelProvider {
    constructor(private readonly result: ModelStageResult) {}
    async runStage(): Promise<ModelStageResult> {
      return this.result;
    }
  }
  class ThrowingProvider implements ModelProvider {
    async runStage(): Promise<ModelStageResult> {
      throw new Error("simulated provider crash");
    }
  }

  describe("processClaimedRun — per-run stage logic, independent of what else is queued", () => {
    it("completes a run on a final stage result and records the review action", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(
        claim,
        new StubProvider({
          outcome: "success",
          isFinal: true,
          stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
          tokensUsed: 5,
          reviewAction: "HOLD",
        })
      );
      expect(outcome).toBe("completed");

      const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } });
      expect(updated.status).toBe("COMPLETED");
      expect(updated.resultReviewAction).toBe("HOLD");
    });

    it("checkpoints and requeues on a non-final stage result, persisting the stage output", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(
        claim,
        new StubProvider({
          outcome: "success",
          isFinal: false,
          stageOutput: { checkpoint: "SYNTHETIC_STAGE_COMPLETE" },
          tokensUsed: 5,
        })
      );
      expect(outcome).toBe("requeued");

      const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } });
      expect(updated.status).toBe("QUEUED");
      expect(updated.checkpointData).toEqual({ checkpoint: "SYNTHETIC_STAGE_COMPLETE" });
      expect(updated.attempts).toBe(1);
    });

    it("fails the attempt when the provider reports an error", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(
        claim,
        new StubProvider({ outcome: "error", message: "policy rejected input" })
      );
      expect(outcome).toBe("failed");
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe(
        "RETRY_WAIT"
      );
    });

    it("fails the attempt when the provider throws instead of resolving", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(claim, new ThrowingProvider());
      expect(outcome).toBe("failed");
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe(
        "RETRY_WAIT"
      );
    });

    it("fails the attempt when reported token usage exceeds the safety ceiling", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(
        claim,
        new StubProvider({
          outcome: "success",
          isFinal: true,
          stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
          tokensUsed: MAX_TOKENS_PER_STAGE_CALL + 1,
          reviewAction: "HOLD",
        })
      );
      expect(outcome).toBe("failed");
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe(
        "RETRY_WAIT"
      );
    });

    it("fails the attempt when the client's provider rate limit is already exhausted, without ever calling the provider", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);
      for (let i = 0; i < 10; i++) await checkProviderRateLimit(client.id, "WEEKLY_REVIEW");

      let providerCalled = false;
      class TrackingProvider implements ModelProvider {
        async runStage(): Promise<ModelStageResult> {
          providerCalled = true;
          return {
            outcome: "success",
            isFinal: true,
            stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
            tokensUsed: 1,
            reviewAction: "HOLD",
          };
        }
      }
      const outcome = await processClaimedRun(claim, new TrackingProvider());
      expect(outcome).toBe("rateLimited");
      expect(providerCalled).toBe(false);
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe(
        "RETRY_WAIT"
      );
    });
  });

  describe("runExecutorSweep — claim/select loop", () => {
    it("claims nothing and reports disabled when generation is not explicitly enabled", async () => {
      process.env.FEATURE_AI_COACH_GENERATION = "false";
      const client = await makeClient();
      const run = await makeQueuedRun(client.id);

      const summary = await runExecutorSweep(
        new StubProvider({
          outcome: "success",
          isFinal: true,
          stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
          tokensUsed: 1,
          reviewAction: "HOLD",
        })
      );
      expect(summary).toMatchObject({ disabled: true, claimed: 0 });
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        "QUEUED"
      );
    });

    it("never claims more than the configured concurrency cap in one sweep, however much else is queued", async () => {
      process.env.FEATURE_AI_COACH_GENERATION = "true";
      const client = await makeClient();
      // Guarantees at least 5 QUEUED rows exist system-wide regardless of
      // whatever else is left over from other suites sharing this DB — the
      // cap is a hard constant, so `claimed` must be exactly 3 either way.
      await Promise.all(Array.from({ length: 5 }, () => makeQueuedRun(client.id)));

      const summary = await runExecutorSweep(
        new StubProvider({
          outcome: "success",
          isFinal: true,
          stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
          tokensUsed: 1,
          reviewAction: "HOLD",
        })
      );
      expect(summary.claimed).toBe(3);
    });

    it("reconciliation drains all due/expired work in one sweep, not a bounded slice, even though claiming is capped at 3", async () => {
      process.env.FEATURE_AI_COACH_GENERATION = "true";
      const client = await makeClient();

      const expiredRunning = await Promise.all(
        Array.from({ length: 7 }, async () => {
          const run = await makeQueuedRun(client.id);
          return db.aiCoachRun.update({
            where: { id: run.id },
            data: {
              status: "RUNNING",
              attempts: 1,
              fencingToken: 1,
              leaseExpiresAt: new Date(Date.now() - 60_000),
            },
          });
        })
      );
      const dueRetryWait = await Promise.all(
        Array.from({ length: 4 }, async () => {
          const run = await makeQueuedRun(client.id);
          return db.aiCoachRun.update({
            where: { id: run.id },
            data: {
              status: "RETRY_WAIT",
              attempts: 1,
              leaseExpiresAt: new Date(Date.now() - 1_000),
            },
          });
        })
      );

      const summary = await runExecutorSweep(
        new StubProvider({
          outcome: "success",
          isFinal: true,
          stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
          tokensUsed: 1,
          reviewAction: "HOLD",
        })
      );

      // T-503 review round 1 finding 3: reconcileExpiredRuns has no clientId
      // filter, so `requeued` counts every expired-RUNNING row in the
      // database, not only this test's 7 — exact equality here is an
      // ordering accident against a shared DB, not a property this test can
      // guarantee under full-suite parallelism. The per-row,
      // clientRunIds-scoped assertions below already prove the exact
      // guarantee (all 7 of *this test's* expired RUNNING rows left that
      // state in one sweep); this counter only needs to be at-least-7.
      expect(summary.reconciled.requeued).toBeGreaterThanOrEqual(7);
      expect(summary.reconciled.resumed).toBeGreaterThanOrEqual(4);
      expect(summary.claimed).toBeLessThanOrEqual(3);

      const clientRunIds = [...expiredRunning, ...dueRetryWait].map((run) => run.id);
      const afterRows = await db.aiCoachRun.findMany({ where: { id: { in: clientRunIds } } });
      const stillExpiredRunning = afterRows.filter(
        (row) => row.status === "RUNNING" && row.leaseExpiresAt !== null && row.leaseExpiresAt < new Date()
      );
      const stillDueRetryWait = afterRows.filter(
        (row) => row.status === "RETRY_WAIT" && row.leaseExpiresAt !== null && row.leaseExpiresAt < new Date()
      );
      expect(stillExpiredRunning).toHaveLength(0);
      expect(stillDueRetryWait).toHaveLength(0);
    });

    it("two concurrent sweeps never double-claim the same run (overlap safety)", async () => {
      process.env.FEATURE_AI_COACH_GENERATION = "true";

      // The claim query is system-wide, oldest-QUEUED-first, with no
      // clientId filter — and this shared local test database accumulates
      // QUEUED rows left over from other tests/suites across many runs.
      // Backdating createdAt to the Unix epoch guarantees this test's own
      // seeded rows are the oldest QUEUED candidates in the whole table, so
      // both concurrent sweeps below draw their claim candidates
      // exclusively from this set. T-503 review round 1 finding 1: that
      // exclusivity must be established, not assumed — clear out any
      // epoch-backdated leftovers from a prior run of this exact test
      // before seeding, and delete this test's own rows in `finally` so
      // nothing it creates can poison a later sweep (including the
      // reconciliation test above, if the file is ever reordered).
      const backdate = new Date(0);
      await db.aiCoachRun.deleteMany({ where: { createdAt: backdate } });

      const client = await makeClient();
      // T-503 review round 1 finding 2: with 5 rows and a claim cap of 3,
      // the double-claim invariant below holds identically whether the two
      // sweeps actually contended for a row or ran serially (A claims 3, B
      // claims the remaining 2 with zero contested `claimQueuedRun` calls) —
      // that would prove nothing about the race the hourly schedule can
      // create. Seeding 6 (2x the cap) means both sweeps' candidate queries
      // draw from the same oversubscribed pool, so a combined claimed count
      // below 6 is direct evidence a claim was actually contested and lost,
      // not just that nothing collided.
      const seeded = await Promise.all(
        Array.from({ length: 6 }, () => makeQueuedRun(client.id, backdate))
      );
      const seededIds = seeded.map((run) => run.id);

      const provider = new StubProvider({
        outcome: "success",
        isFinal: true,
        stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
        tokensUsed: 1,
        reviewAction: "HOLD",
      });

      try {
        const [summaryA, summaryB] = await Promise.all([
          runExecutorSweep(provider),
          runExecutorSweep(provider),
        ]);

        const afterRows = await db.aiCoachRun.findMany({ where: { id: { in: seededIds } } });
        expect(afterRows.every((row) => row.attempts <= 1)).toBe(true);
        expect(afterRows.some((row) => row.status === "RUNNING")).toBe(false);

        const leftQueued = afterRows.filter((row) => row.status === "QUEUED").length;
        const startedAsQueued = seededIds.length - leftQueued;
        expect(startedAsQueued).toBe(summaryA.claimed + summaryB.claimed);

        // Proves actual contention happened (a claim was attempted on a row
        // the other sweep had already won), not just that the two sweeps
        // happened not to collide: with 6 rows oversubscribing the cap of 3
        // per sweep, "no contention" would mean the combined claimed count
        // is the full 6 (A claims its 3, B independently claims a disjoint
        // remaining 3). A sum strictly under 6 means at least one
        // `claimQueuedRun` call lost a race for a row the other sweep had
        // already claimed.
        expect(summaryA.claimed + summaryB.claimed).toBeLessThan(6);
      } finally {
        await db.aiCoachRun.deleteMany({ where: { id: { in: seededIds } } });
      }
    });
  });

  describe("run-status — safe read", () => {
    it("a client can read their own run but not another client's", async () => {
      const client = await makeClient();
      const other = await makeClient();
      const run = await makeQueuedRun(client.id);

      expect(await getRunStatusForClient(client.id, run.id)).toMatchObject({
        success: true,
        run: { id: run.id, status: "QUEUED" },
      });
      expect(await getRunStatusForClient(other.id, run.id)).toMatchObject({
        success: false,
        error: "FORBIDDEN",
      });
      expect(await getRunStatusForClient(client.id, randomUUID())).toMatchObject({
        success: false,
        error: "NOT_FOUND",
      });
    });

    it("never leaks raw lastError or checkpointData", async () => {
      const client = await makeClient();
      const run = await db.aiCoachRun.create({
        data: {
          clientId: client.id,
          kind: "WEEKLY_REVIEW",
          businessKey: randomUUID(),
          status: "FAILED",
          contextRevision: 1,
          profileRevision: 1,
          observationRevision: 1,
          safetyRevision: 1,
          lastError: "raw internal provider stack trace with secrets",
          checkpointData: { internal: "trace" },
        },
      });
      const result = await getRunStatusForClient(client.id, run.id);
      expect(result.success).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("secrets");
      expect(serialized).not.toContain("internal");
    });

    it("the client REST route enforces the same ownership boundary", async () => {
      const client = await makeClient();
      const other = await makeClient();
      const run = await makeQueuedRun(client.id);

      mocks.authUserId = other.clerkId;
      const forbidden = await getRunStatusRoute(
        new NextRequest(`https://example.test/api/client/ai-coach/runs/${run.id}`),
        { params: Promise.resolve({ runId: run.id }) }
      );
      expect(forbidden.status).toBe(403);

      mocks.authUserId = client.clerkId;
      const ok = await getRunStatusRoute(
        new NextRequest(`https://example.test/api/client/ai-coach/runs/${run.id}`),
        { params: Promise.resolve({ runId: run.id }) }
      );
      expect(ok.status).toBe(200);
    });
  });

  describe("stale-token fencing", () => {
    it("a presumed-dead worker's late completeRun write loses to a bumped fencing token", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      // Force the lease into the past so reconcileExpiredRuns treats this
      // worker as dead and bumps the fencing token out from under it.
      await db.aiCoachRun.update({
        where: { id: claim.run.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      await reconcileExpiredRuns();

      const wroteCompleted = await completeRun(claim.run.id, claim.fencingToken, {
        resultReviewAction: "HOLD",
      });
      expect(wroteCompleted).toBe(false);

      const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } });
      expect(updated.status).not.toBe("COMPLETED");
    });
  });

  it("the cron route no-ops when FEATURE_AI_COACH_GENERATION is unset entirely (not just \"false\")", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    delete process.env.FEATURE_AI_COACH_GENERATION;
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);

    const response = await executorCronRoute(
      new NextRequest("https://example.test/api/cron/ai-coach-executor", {
        headers: { authorization: "Bearer test-cron-secret" },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ disabled: true, claimed: 0 });

    const untouched = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(untouched.status).toBe("QUEUED");
    expect(untouched.attempts).toBe(0);
    expect(untouched.fencingToken).toBe(0);
    expect(untouched.leaseExpiresAt).toBeNull();
    expect(untouched.checkpointData).toBeNull();
  });

  it("the cron route returns a clean 200 (not a 500) when a governance pause blocks the sweep", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.FEATURE_AI_COACH_GENERATION = "true";
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);

    await withDisabledGenerationControl(async () => {
      const response = await executorCronRoute(
        new NextRequest("https://example.test/api/cron/ai-coach-executor", {
          headers: { authorization: "Bearer test-cron-secret" },
        })
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        paused: true,
        reason: "TEMPORARILY_UNAVAILABLE",
      });
    });

    const untouched = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(untouched.status).toBe("QUEUED");
  });

  it("the cron route rejects a missing/incorrect bearer token and accepts the configured secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.FEATURE_AI_COACH_GENERATION = "false";

    const unauthorized = await executorCronRoute(
      new NextRequest("https://example.test/api/cron/ai-coach-executor")
    );
    expect(unauthorized.status).toBe(401);

    const wrongToken = await executorCronRoute(
      new NextRequest("https://example.test/api/cron/ai-coach-executor", {
        headers: { authorization: "Bearer wrong" },
      })
    );
    expect(wrongToken.status).toBe(401);

    const authorized = await executorCronRoute(
      new NextRequest("https://example.test/api/cron/ai-coach-executor", {
        headers: { authorization: "Bearer test-cron-secret" },
      })
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ disabled: true });
  });
});
