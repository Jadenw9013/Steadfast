import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
const mocks = vi.hoisted(() => ({ authUserId: "" }));

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { claimQueuedRun, type ClaimResult } from "@/lib/ai-coach/runs";
import { runExecutorSweep, processClaimedRun } from "@/lib/ai-coach/executor";
import { getRunStatusForClient } from "@/lib/ai-coach/run-status";
import { GET as getRunStatusRoute } from "@/app/api/client/ai-coach/runs/[runId]/route";
import { GET as executorCronRoute } from "@/app/api/cron/ai-coach-executor/route";
import type { ModelProvider, ModelStageResult } from "@/lib/ai-coach/provider/adapter";
import { checkProviderRateLimit, MAX_TOKENS_PER_STAGE_CALL } from "@/lib/ai-coach/provider/spend-limits";

suite("A05 — durable job executor with real PostgreSQL constraints", () => {
  const originalGenerationFlag = process.env.FEATURE_AI_COACH_GENERATION;
  const originalCronSecret = process.env.CRON_SECRET;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    process.env.FEATURE_AI_COACH_GENERATION = originalGenerationFlag;
    process.env.CRON_SECRET = originalCronSecret;
  });
  afterAll(async () => { await db.$disconnect(); });

  async function makeClient() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true } });
  }

  async function makeQueuedRun(clientId: string) {
    return db.aiCoachRun.create({
      data: {
        clientId, kind: "WEEKLY_REVIEW", businessKey: randomUUID(),
        contextRevision: 1, profileRevision: 1, observationRevision: 1, safetyRevision: 1,
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
    async runStage(): Promise<ModelStageResult> { return this.result; }
  }
  class ThrowingProvider implements ModelProvider {
    async runStage(): Promise<ModelStageResult> { throw new Error("simulated provider crash"); }
  }

  describe("processClaimedRun — per-run stage logic, independent of what else is queued", () => {
    it("completes a run on a final stage result and records the review action", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(claim, new StubProvider({ outcome: "success", isFinal: true, stageOutput: {}, tokensUsed: 5, reviewAction: "SIMPLIFY" }));
      expect(outcome).toBe("completed");

      const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } });
      expect(updated.status).toBe("COMPLETED");
      expect(updated.resultReviewAction).toBe("SIMPLIFY");
    });

    it("checkpoints and requeues on a non-final stage result, persisting the stage output", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(claim, new StubProvider({ outcome: "success", isFinal: false, stageOutput: { stage: "DRAFT" }, tokensUsed: 5 }));
      expect(outcome).toBe("requeued");

      const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } });
      expect(updated.status).toBe("QUEUED");
      expect(updated.checkpointData).toEqual({ stage: "DRAFT" });
      expect(updated.attempts).toBe(1);
    });

    it("fails the attempt when the provider reports an error", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(claim, new StubProvider({ outcome: "error", message: "policy rejected input" }));
      expect(outcome).toBe("failed");
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe("RETRY_WAIT");
    });

    it("fails the attempt when the provider throws instead of resolving", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(claim, new ThrowingProvider());
      expect(outcome).toBe("failed");
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe("RETRY_WAIT");
    });

    it("fails the attempt when reported token usage exceeds the safety ceiling", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);

      const outcome = await processClaimedRun(claim, new StubProvider({ outcome: "success", isFinal: true, stageOutput: {}, tokensUsed: MAX_TOKENS_PER_STAGE_CALL + 1, reviewAction: "HOLD" }));
      expect(outcome).toBe("failed");
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe("RETRY_WAIT");
    });

    it("fails the attempt when the client's provider rate limit is already exhausted, without ever calling the provider", async () => {
      const client = await makeClient();
      const claim = await claimFreshRun(client.id);
      for (let i = 0; i < 10; i++) await checkProviderRateLimit(client.id, "WEEKLY_REVIEW");

      let providerCalled = false;
      class TrackingProvider implements ModelProvider {
        async runStage(): Promise<ModelStageResult> { providerCalled = true; return { outcome: "success", isFinal: true, stageOutput: {}, tokensUsed: 1, reviewAction: "HOLD" }; }
      }
      const outcome = await processClaimedRun(claim, new TrackingProvider());
      expect(outcome).toBe("rateLimited");
      expect(providerCalled).toBe(false);
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: claim.run.id } })).status).toBe("RETRY_WAIT");
    });
  });

  describe("runExecutorSweep — claim/select loop", () => {
    it("claims nothing and reports disabled when generation is not explicitly enabled", async () => {
      process.env.FEATURE_AI_COACH_GENERATION = "false";
      const client = await makeClient();
      const run = await makeQueuedRun(client.id);

      const summary = await runExecutorSweep(new StubProvider({ outcome: "success", isFinal: true, stageOutput: {}, tokensUsed: 1, reviewAction: "HOLD" }));
      expect(summary).toMatchObject({ disabled: true, claimed: 0 });
      expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("QUEUED");
    });

    it("never claims more than the configured concurrency cap in one sweep, however much else is queued", async () => {
      process.env.FEATURE_AI_COACH_GENERATION = "true";
      const client = await makeClient();
      // Guarantees at least 5 QUEUED rows exist system-wide regardless of
      // whatever else is left over from other suites sharing this DB — the
      // cap is a hard constant, so `claimed` must be exactly 3 either way.
      await Promise.all(Array.from({ length: 5 }, () => makeQueuedRun(client.id)));

      const summary = await runExecutorSweep(new StubProvider({ outcome: "success", isFinal: true, stageOutput: {}, tokensUsed: 1, reviewAction: "HOLD" }));
      expect(summary.claimed).toBe(3);
    });
  });

  describe("run-status — safe read", () => {
    it("a client can read their own run but not another client's", async () => {
      const client = await makeClient();
      const other = await makeClient();
      const run = await makeQueuedRun(client.id);

      expect(await getRunStatusForClient(client.id, run.id)).toMatchObject({ success: true, run: { id: run.id, status: "QUEUED" } });
      expect(await getRunStatusForClient(other.id, run.id)).toMatchObject({ success: false, error: "FORBIDDEN" });
      expect(await getRunStatusForClient(client.id, randomUUID())).toMatchObject({ success: false, error: "NOT_FOUND" });
    });

    it("never leaks raw lastError or checkpointData", async () => {
      const client = await makeClient();
      const run = await db.aiCoachRun.create({
        data: {
          clientId: client.id, kind: "WEEKLY_REVIEW", businessKey: randomUUID(), status: "FAILED",
          contextRevision: 1, profileRevision: 1, observationRevision: 1, safetyRevision: 1,
          lastError: "raw internal provider stack trace with secrets", checkpointData: { internal: "trace" },
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
      const forbidden = await getRunStatusRoute(new NextRequest(`https://example.test/api/client/ai-coach/runs/${run.id}`), { params: Promise.resolve({ runId: run.id }) });
      expect(forbidden.status).toBe(403);

      mocks.authUserId = client.clerkId;
      const ok = await getRunStatusRoute(new NextRequest(`https://example.test/api/client/ai-coach/runs/${run.id}`), { params: Promise.resolve({ runId: run.id }) });
      expect(ok.status).toBe(200);
    });
  });

  it("the cron route rejects a missing/incorrect bearer token and accepts the configured secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.FEATURE_AI_COACH_GENERATION = "false";

    const unauthorized = await executorCronRoute(new NextRequest("https://example.test/api/cron/ai-coach-executor"));
    expect(unauthorized.status).toBe(401);

    const wrongToken = await executorCronRoute(new NextRequest("https://example.test/api/cron/ai-coach-executor", { headers: { authorization: "Bearer wrong" } }));
    expect(wrongToken.status).toBe(401);

    const authorized = await executorCronRoute(new NextRequest("https://example.test/api/cron/ai-coach-executor", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ disabled: true });
  });
});
