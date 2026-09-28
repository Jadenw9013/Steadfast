/**
 * T-2009 (S-18) — enqueue-time drain against a real PostgreSQL.
 *
 * The one property that matters: the kick is a second *invoker* of run
 * execution, never a second *implementation*. It claims through the same
 * `claimQueuedRun` conditional update the cron sweep uses, so a run can never
 * be executed twice; and anything that goes wrong in the kick leaves the row
 * exactly where `runs.ts` left it, for the sweep to finish.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ authUserId: "", faultAfterClaim: false }));
/**
 * Simulates "the serverless invocation was torn down after the claim": the
 * real `claimQueuedRun` still moves the row to RUNNING and takes a lease,
 * and then the very next write never lands. Every other export stays the real
 * implementation, so the claim/fencing behaviour under test is untouched.
 */
vi.mock("@/lib/ai-coach/runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-coach/runs")>();
  return {
    ...actual,
    completeRun: async (...args: Parameters<typeof actual.completeRun>) => {
      if (mocks.faultAfterClaim) throw new Error("simulated invocation teardown after claim");
      return actual.completeRun(...args);
    },
  };
});

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: drives runExecutorSweep/reconcileExpiredRuns, which take no client
// filter. Runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { drainRunNow, runExecutorSweep } from "@/lib/ai-coach/executor";
import { POST as createRunRoute } from "@/app/api/client/ai-coach/runs/route";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import type { ModelProvider, ModelStageResult } from "@/lib/ai-coach/provider/adapter";

suite("T-2009 — enqueue-time drain", () => {
  const originalGenerationFlag = process.env.FEATURE_AI_COACH_GENERATION;
  beforeEach(() => {
    mocks.faultAfterClaim = false;
    process.env.FEATURE_AI_COACH_GENERATION = "true";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalGenerationFlag === undefined) delete process.env.FEATURE_AI_COACH_GENERATION;
    else process.env.FEATURE_AI_COACH_GENERATION = originalGenerationFlag;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  /** Mirrors tests/integration/ai-coach-executor.test.ts — the control row is
   * process-wide state shared with other suites, so restore it unconditionally. */
  async function withDisabledGenerationControl<T>(fn: () => Promise<T>): Promise<T> {
    const prior = await db.aiCoachOperationalControl.findUnique({ where: { scope: "GENERATION" } });
    await db.aiCoachOperationalControl.upsert({
      where: { scope: "GENERATION" },
      create: {
        scope: "GENERATION",
        disabled: true,
        reasonCode: "T2009_SYNTHETIC_GOVERNANCE_PAUSE_TEST",
        updatedByGrantId: "synthetic-t2009-test-grant",
      },
      update: { disabled: true, reasonCode: "T2009_SYNTHETIC_GOVERNANCE_PAUSE_TEST" },
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

  class StubProvider implements ModelProvider {
    async runStage(): Promise<ModelStageResult> {
      return {
        outcome: "success",
        isFinal: true,
        stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
        tokensUsed: 1,
        reviewAction: "HOLD",
      };
    }
  }
  const stub = new StubProvider();


  async function makeClient() {
    const id = randomUUID();
    return db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true },
    });
  }

  /** A legacy (non-managed) QUEUED run — `inputSnapshot` null, so
   * `processClaimedRun` takes the stub-provider branch instead of the managed
   * executor. This file is about claim/lease/fencing, not plan composition. */
  async function makeQueuedRun(clientId: string) {
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

  it("processes the run on its own, with no sweep", async () => {
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);
    expect(run.status).toBe("QUEUED");
    expect(run.attempts).toBe(0);

    expect(await drainRunNow(run.id, stub)).toBe("completed");

    const after = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.attempts).toBe(1);
  });

  it("cannot double-execute a run alongside the sweep — attempts stays 1", async () => {
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);

    const [kick, sweep] = await Promise.all([
      drainRunNow(run.id, stub),
      runExecutorSweep(stub),
    ]);

    const after = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.attempts).toBe(1);
    expect(after.status).toBe("COMPLETED");
    // Exactly one of the two advanced it; the loser's conditional update
    // matched zero rows and it did nothing.
    if (kick === "not_claimed") expect(sweep.claimed).toBe(1);
    else expect(kick).toBe("completed");
  });

  it("claims only its own run id", async () => {
    const [clientA, clientB] = await Promise.all([makeClient(), makeClient()]);
    const runA = await makeQueuedRun(clientA.id);
    const runB = await makeQueuedRun(clientA.id);
    const runC = await makeQueuedRun(clientB.id);

    expect(await drainRunNow(runA.id, stub)).toBe("completed");

    for (const untouched of [runB, runC]) {
      const row = await db.aiCoachRun.findUniqueOrThrow({ where: { id: untouched.id } });
      expect({
        status: row.status,
        attempts: row.attempts,
        fencingToken: row.fencingToken,
        leaseExpiresAt: row.leaseExpiresAt,
      }).toEqual({
        status: untouched.status,
        attempts: untouched.attempts,
        fencingToken: untouched.fencingToken,
        leaseExpiresAt: untouched.leaseExpiresAt,
      });
    }
  });

  it("a torn-down kick never FAILs the run, and the sweep still finishes it", async () => {
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);
    mocks.faultAfterClaim = true;
    try {
      // The drain resolves; it never throws into the post-response callback.
      expect(await drainRunNow(run.id, stub)).toBe("error");
    } finally {
      mocks.faultAfterClaim = false;
    }

    const stranded = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stranded.status).toBe("RUNNING");
    expect(stranded.status).not.toBe("FAILED");
    expect(stranded.leaseExpiresAt).not.toBeNull();

    // The sweep's reconciliation is what recovers it — first to RETRY_WAIT...
    await db.aiCoachRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await runExecutorSweep(stub);
    expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "RETRY_WAIT"
    );

    // ...then back to QUEUED and through to completion. The sweep claims at
    // most MAX_CONCURRENT_CLAIMS_PER_SWEEP (3) rows per call across the whole
    // table, so in a shared database this run may not be in the first batch —
    // sweep until it is terminal rather than assuming two passes. The bound is
    // the assertion: if it never finishes, the test fails.
    await db.aiCoachRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    let recovered = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    for (let sweep = 0; sweep < 20 && recovered.status !== "COMPLETED"; sweep++) {
      await runExecutorSweep(stub);
      recovered = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
      // At no point does anything mark it FAILED on the kick's behalf.
      expect(recovered.status).not.toBe("FAILED");
    }
    expect(recovered.status).toBe("COMPLETED");
  });

  it("does nothing at all while the generation flag is unset", async () => {
    delete process.env.FEATURE_AI_COACH_GENERATION;
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);

    expect(await drainRunNow(run.id, stub)).toBe("flag_disabled");

    const after = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect({
      status: after.status,
      attempts: after.attempts,
      fencingToken: after.fencingToken,
      leaseExpiresAt: after.leaseExpiresAt,
      checkpointData: after.checkpointData,
    }).toEqual({
      status: run.status,
      attempts: run.attempts,
      fencingToken: run.fencingToken,
      leaseExpiresAt: run.leaseExpiresAt,
      checkpointData: run.checkpointData,
    });
  });

  it("reports a governance pause instead of failing the run", async () => {
    const client = await makeClient();
    const run = await makeQueuedRun(client.id);

    await withDisabledGenerationControl(async () => {
      expect(await drainRunNow(run.id, stub)).toBe("paused");
    });

    const after = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("QUEUED");
    expect(after.attempts).toBe(0);
  });

  it("run creation still succeeds when after() has no request scope", async () => {
    // vitest provides no Next request scope, so `after()` throws E468 inside
    // scheduleRunDrain. This is the production-safety regression: the kick
    // must never be able to break run creation.
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    const id = randomUUID();
    const client = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true },
    });
    mocks.authUserId = id;
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: client.id,
        isSynthetic: true,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
        confirmedIntake: {
          goal: "GENERAL_FITNESS",
          experienceLevel: "NEW",
          trainingDaysPerWeek: 2,
          equipmentAccess: ["NONE"],
          allergies: [],
          dietaryRestrictions: [],
          foodBudgetLevel: "LOW",
          trackingPreference: "NUMBERS_VISIBLE",
          unitsPreference: "METRIC",
        },
      },
    });

    const body = {
      requestKey: randomUUID(),
      kind: "INITIAL",
      representation: "MACROS",
      expectedContextRevision: 0,
      expectedProfileRevision: 0,
    };
    const response = await createRunRoute(
      new NextRequest("http://localhost:3000/api/client/ai-coach/runs", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(typeof payload.data.runId).toBe("string");
    const created = await db.aiCoachRun.findUniqueOrThrow({ where: { id: payload.data.runId } });
    expect(created.status).toBe("QUEUED");
    vi.unstubAllEnvs();
  });

  it("requestAiRun still refuses to create a row while the flag is unset", async () => {
    delete process.env.FEATURE_AI_COACH_GENERATION;
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    const id = randomUUID();
    const client = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({
      data: { clientId: client.id, isSynthetic: true, consentedAt: new Date(), reviewTimezone: "America/Los_Angeles" },
    });

    await expect(
      requestAiRun(client.id, {
        requestKey: randomUUID(),
        kind: "INITIAL",
        representation: "MACROS",
        expectedContextRevision: 0,
        expectedProfileRevision: 0,
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
    expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(0);
    vi.unstubAllEnvs();
  });
});
