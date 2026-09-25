import { processManagedRun } from "./managed-executor";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
import {
  claimQueuedRun,
  checkpointAndRequeue,
  completeRun,
  failRunAttempt,
  reconcileExpiredRuns,
  type ClaimResult,
} from "./runs";
import {
  callProviderWithTimeout,
  legacySyntheticStageInput,
  ProviderTimeoutError,
  type ModelProvider,
} from "./provider/adapter";
import { SyntheticFixtureProvider } from "./provider/synthetic-provider";
import { checkProviderRateLimit, isWithinTokenCeiling } from "./provider/spend-limits";
import { assertAiCoachOperationEnabled, getAcceptanceDeliveryState } from "./operations";
import {
  drainAcceptanceNotifications,
  type AcceptanceNotificationDrainSummary,
} from "./acceptance-notifications";
import { reportServerError } from "@/lib/observability/report";
import { CRON_FAILED } from "@/lib/observability/events";

/**
 * A05 — durable job executor.
 *
 * Invoked by the authenticated cron route (app/api/cron/ai-coach-executor).
 * Runs the T-502 acceptance-notification drain phase first (see
 * `runAcceptanceNotificationPhase` below — gated independently on
 * `FEATURE_AI_COACH_PUBLICATION`, not `FEATURE_AI_COACH_GENERATION`, and
 * never able to fault the generation sweep), then reconciles expired
 * leases and claims a bounded number of QUEUED runs, advancing each by
 * exactly one provider stage — never a whole run to completion in a
 * single pass, and never a network/model call inside a database
 * transaction (claim/checkpoint/complete are separate non-transactional
 * conditional updates; the provider call happens strictly between them).
 * If the client's rate limit is exhausted, or the reported token usage
 * exceeds the safety ceiling, the attempt is failed through the same
 * runs.ts accounting as any other provider failure — it still counts
 * against MAX_ATTEMPTS_PER_RUN.
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
export async function processClaimedRun(
  claim: Extract<ClaimResult, { claimed: true }>,
  provider: ModelProvider
): Promise<ProcessedOutcome> {
  if (claim.run.inputSnapshot !== null) return processManagedRun(claim, provider);
  const withinRate = await checkProviderRateLimit(claim.run.clientId, claim.run.kind);
  if (!withinRate) {
    await failRunAttempt(
      claim.run.id,
      claim.fencingToken,
      "Client model-call rate limit exceeded for this period."
    );
    return "rateLimited";
  }

  let result;
  try {
    result = await callProviderWithTimeout(provider, legacySyntheticStageInput(claim.run.kind));
  } catch (err) {
    const message =
      err instanceof ProviderTimeoutError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown provider error";
    await failRunAttempt(claim.run.id, claim.fencingToken, message);
    return "failed";
  }

  if (result.outcome === "error") {
    await failRunAttempt(claim.run.id, claim.fencingToken, result.message);
    return "failed";
  }

  if (!isWithinTokenCeiling(result.tokensUsed)) {
    await failRunAttempt(
      claim.run.id,
      claim.fencingToken,
      `Stage reported ${result.tokensUsed} tokens, exceeding the per-call safety ceiling.`
    );
    return "failed";
  }

  if (result.isFinal) {
    await completeRun(claim.run.id, claim.fencingToken, {
      resultReviewAction: result.reviewAction,
    });
    return "completed";
  }

  await checkpointAndRequeue(
    claim.run.id,
    claim.fencingToken,
    result.stageOutput as Prisma.InputJsonValue
  );
  return "requeued";
}

export interface ExecutorSweepSummary {
  /** Refers to the GENERATION phase only. The notification drain has its
   * own gate; see `notifications.skipped`/`notifications.reason`. */
  disabled: boolean;
  reconciled: { requeued: number; failed: number; resumed: number };
  claimed: number;
  completed: number;
  requeuedForNextStage: number;
  failed: number;
  rateLimited: number;
  notifications: AcceptanceNotificationDrainSummary;
}

function skippedNotifications(
  reason: NonNullable<AcceptanceNotificationDrainSummary["reason"]>
): AcceptanceNotificationDrainSummary {
  return {
    skipped: true,
    reason,
    stale: 0,
    superseded: 0,
    claimed: 0,
    delivered: 0,
    suppressed: 0,
    retried: 0,
    abandoned: 0,
  };
}

/**
 * T-502 — the acceptance-notification drain phase. Gated on
 * `FEATURE_AI_COACH_PUBLICATION` alone (plus the `ACCEPTANCE` operational
 * control) — deliberately NOT on `FEATURE_AI_COACH_GENERATION`. An outbox
 * row describes a plan that is already active on the client's screen (the
 * acceptance transaction already committed); stranding that notification
 * because generation happens to be paused would mean the client's plan
 * changed and nothing ever told them.
 *
 * The gate decision itself is `getAcceptanceDeliveryState()`
 * (`lib/ai-coach/operations.ts`) — the SAME function the reviewer panel's
 * readout calls — not a second, parallel flag/control-row check next to
 * it. Round 2 (MINOR 1) found this file still hand-rolling that check: the
 * two happened to agree, but only by coincidence of two independently
 * maintained implementations, which is exactly how MAJOR 1 (round 1)
 * first drifted. There is now exactly one place that decides "is delivery
 * allowed", called from both.
 *
 * A fault here can never take down the generation sweep. `ERRORED` (an
 * unexpected gate failure, reported once inside
 * `getAcceptanceDeliveryState` itself — e.g. a thrown `LiveLaunchError`
 * from the production-only live-launch check, a *different* class that
 * does not extend `AiCoachError`) and `PAUSED` (the ordinary,
 * deliberate-pause signal) both stop here and return `skipped: true`;
 * only `ENABLED` proceeds to the drain itself, which has its own,
 * separate try/catch below — running the drain is a mutating action the
 * read-only panel must never perform, so that half cannot be unified the
 * same way. An earlier version of this phase let a non-`AiCoachError` gate
 * throw escape uncaught, 500ing the cron and stopping generation over a
 * notification-gate problem (T-502 review round 1, MAJOR 2) — that class
 * of bug is now structurally impossible here: this function no longer
 * contains a call that can throw before the generation phase runs.
 */
async function runAcceptanceNotificationPhase(): Promise<AcceptanceNotificationDrainSummary> {
  const state = await getAcceptanceDeliveryState();
  if (state === "DISABLED_BY_FLAG") return skippedNotifications("FLAG_OFF");
  if (state === "PAUSED") return skippedNotifications("PAUSED");
  if (state === "ERRORED") return skippedNotifications("ERRORED");

  try {
    return await drainAcceptanceNotifications();
  } catch (error) {
    reportServerError(CRON_FAILED.evt, error, {
      route: "/api/cron/ai-coach-executor",
      context: { job: "ai-coach-executor", phase: "acceptance-notification-drain" },
      allow: CRON_FAILED.allow,
    });
    console.error("[ai-coach-executor] acceptance-notification drain faulted", error);
    return skippedNotifications("ERRORED");
  }
}

export async function runExecutorSweep(
  provider: ModelProvider = new SyntheticFixtureProvider()
): Promise<ExecutorSweepSummary> {
  const notifications = await runAcceptanceNotificationPhase();

  if (!isAiCoachGenerationEnabled()) {
    return {
      disabled: true,
      reconciled: { requeued: 0, failed: 0, resumed: 0 },
      claimed: 0,
      completed: 0,
      requeuedForNextStage: 0,
      failed: 0,
      rateLimited: 0,
      notifications,
    };
  }

  // Future production executors must bind an exact live-launch packet. The
  // current executor is synthetic-only and deliberately has no such context.
  await assertAiCoachOperationEnabled("GENERATION");
  await assertAiCoachOperationEnabled("PROVIDER");

  const reconciled = await reconcileExpiredRuns();

  const candidates = await db.aiCoachRun.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: MAX_CONCURRENT_CLAIMS_PER_SWEEP,
    select: { id: true },
  });

  let claimed = 0,
    completed = 0,
    requeuedForNextStage = 0,
    failed = 0,
    rateLimited = 0;

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

  return {
    disabled: false,
    reconciled,
    claimed,
    completed,
    requeuedForNextStage,
    failed,
    rateLimited,
    notifications,
  };
}
