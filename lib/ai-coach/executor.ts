import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
import { claimQueuedRun, checkpointAndRequeue, completeRun, failRunAttempt, reconcileExpiredRuns, type ClaimResult } from "./runs";
import { callProviderWithTimeout, ProviderTimeoutError, type ModelProvider } from "./provider/adapter";
import { SyntheticFixtureProvider } from "./provider/synthetic-provider";
import { checkProviderRateLimit, isWithinTokenCeiling } from "./provider/spend-limits";

/**
 * A05 — durable job executor.
 *
 * Invoked by the authenticated cron route (app/api/cron/ai-coach-executor).
 * Reconciles expired leases first, then claims a bounded number of
 * QUEUED runs and advances each by exactly one provider stage — never a
 * whole run to completion in a single pass, and never a network/model
 * call inside a database transaction (claim/checkpoint/complete are
 * separate non-transactional conditional updates; the provider call
 * happens strictly between them). If the client's rate limit is
 * exhausted, or the reported token usage exceeds the safety ceiling, the
 * attempt is failed through the same runs.ts accounting as any other
 * provider failure — it still counts against MAX_ATTEMPTS_PER_RUN.
 */

const MAX_CONCURRENT_CLAIMS_PER_SWEEP = 3; // docs/ai-coach/08 A05 engineering default

export type ProcessedOutcome = "completed" | "requeued" | "failed" | "rateLimited";

/**
 * Advances one already-claimed run by exactly one provider stage. Split
 * out from `runExecutorSweep` so the claim/select loop (which necessarily
 * competes over the whole table) and the per-run stage logic (rate limit,
 * provider call, token ceiling, checkpoint/complete/fail) can be tested
 * independently of what else happens to be QUEUED at the moment.
 */
export async function processClaimedRun(claim: Extract<ClaimResult, { claimed: true }>, provider: ModelProvider): Promise<ProcessedOutcome> {
  const withinRate = await checkProviderRateLimit(claim.run.clientId, claim.run.kind);
  if (!withinRate) {
    await failRunAttempt(claim.run.id, claim.fencingToken, "Client model-call rate limit exceeded for this period.");
    return "rateLimited";
  }

  let result;
  try {
    result = await callProviderWithTimeout(provider, { run: claim.run });
  } catch (err) {
    const message = err instanceof ProviderTimeoutError ? err.message : err instanceof Error ? err.message : "Unknown provider error";
    await failRunAttempt(claim.run.id, claim.fencingToken, message);
    return "failed";
  }

  if (result.outcome === "error") {
    await failRunAttempt(claim.run.id, claim.fencingToken, result.message);
    return "failed";
  }

  if (!isWithinTokenCeiling(result.tokensUsed)) {
    await failRunAttempt(claim.run.id, claim.fencingToken, `Stage reported ${result.tokensUsed} tokens, exceeding the per-call safety ceiling.`);
    return "failed";
  }

  if (result.isFinal) {
    await completeRun(claim.run.id, claim.fencingToken, { resultReviewAction: result.reviewAction, resultPlanVersionId: result.resultPlanVersionId });
    return "completed";
  }

  await checkpointAndRequeue(claim.run.id, claim.fencingToken, result.stageOutput as Prisma.InputJsonValue);
  return "requeued";
}

export interface ExecutorSweepSummary {
  disabled: boolean;
  reconciled: { requeued: number; failed: number; resumed: number };
  claimed: number;
  completed: number;
  requeuedForNextStage: number;
  failed: number;
  rateLimited: number;
}

export async function runExecutorSweep(provider: ModelProvider = new SyntheticFixtureProvider()): Promise<ExecutorSweepSummary> {
  if (!isAiCoachGenerationEnabled()) {
    return { disabled: true, reconciled: { requeued: 0, failed: 0, resumed: 0 }, claimed: 0, completed: 0, requeuedForNextStage: 0, failed: 0, rateLimited: 0 };
  }

  const reconciled = await reconcileExpiredRuns();

  const candidates = await db.aiCoachRun.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: MAX_CONCURRENT_CLAIMS_PER_SWEEP,
    select: { id: true },
  });

  let claimed = 0, completed = 0, requeuedForNextStage = 0, failed = 0, rateLimited = 0;

  for (const candidate of candidates) {
    const claim = await claimQueuedRun(candidate.id);
    if (!claim.claimed) continue;
    claimed++;

    const outcome = await processClaimedRun(claim, provider);
    if (outcome === "completed") completed++;
    else if (outcome === "requeued") requeuedForNextStage++;
    else if (outcome === "failed") failed++;
    else rateLimited++;
  }

  return { disabled: false, reconciled, claimed, completed, requeuedForNextStage, failed, rateLimited };
}
