import { db } from "@/lib/db";
import type { AiCoachRun, AiReviewAction, Prisma } from "@/app/generated/prisma/client";

/**
 * AiCoachRun lifecycle (A02, A05 owns the actual executor/cron). All
 * transitions here are conditional updateMany calls guarded by the
 * current status (and, once claimed, the fencing token) so a stale or
 * duplicate worker's write is silently rejected rather than corrupting a
 * run another worker already advanced. Terminal statuses (COMPLETED,
 * FAILED, CANCELED) are never reopened by any function here.
 *
 * docs/ai-coach/05-API-and-State-Contracts.md transition table:
 * QUEUED→RUNNING on a valid claim; RUNNING→QUEUED only after a persisted
 * stage checkpoint; RUNNING→COMPLETED on a validated final result;
 * RUNNING→RETRY_WAIT for a retryable failure within budget; RETRY_WAIT→
 * RUNNING when due; RUNNING/RETRY_WAIT→FAILED after terminal error or
 * exhausted budget. Reconciliation moves expired RUNNING leases to
 * RETRY_WAIT or FAILED with fencing. Any nonterminal run can become
 * CANCELED after authority/safety invalidation.
 */

export const MAX_ATTEMPTS_PER_RUN = 3;
const LEASE_DURATION_MS = 90_000;
const RETRY_DELAYS_MS = [60_000, 300_000]; // 60s, then 300s, per docs/ai-coach/04 A05 defaults

export type ClaimResult = { claimed: true; run: AiCoachRun; fencingToken: number } | { claimed: false };

/** QUEUED → RUNNING. Only one concurrent caller can win a given run. */
export async function claimQueuedRun(runId: string): Promise<ClaimResult> {
  const run = await db.aiCoachRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "QUEUED") return { claimed: false };

  const nextFencingToken = run.fencingToken + 1;
  const result = await db.aiCoachRun.updateMany({
    where: { id: runId, status: "QUEUED", fencingToken: run.fencingToken },
    data: {
      status: "RUNNING",
      fencingToken: nextFencingToken,
      leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
      attempts: { increment: 1 },
    },
  });
  if (result.count === 0) return { claimed: false };
  const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
  return { claimed: true, run: updated, fencingToken: nextFencingToken };
}

/**
 * RUNNING → QUEUED, only for the caller holding the current fencing
 * token, persisting the stage's output atomically with the state
 * transition (A05: "stage outputs"). A resumed run reads this back via
 * `run.checkpointData` to continue from real progress instead of
 * repeating a completed stage. Never store prompts or raw model traces
 * here — see run-status.ts for what may reach a client/reviewer view.
 */
export async function checkpointAndRequeue(runId: string, fencingToken: number, checkpointData?: Prisma.InputJsonValue): Promise<boolean> {
  const result = await db.aiCoachRun.updateMany({
    where: { id: runId, status: "RUNNING", fencingToken },
    data: { status: "QUEUED", leaseExpiresAt: null, ...(checkpointData !== undefined ? { checkpointData } : {}) },
  });
  return result.count > 0;
}

export interface CompleteRunInput {
  resultPlanVersionId?: string;
  resultReviewAction: AiReviewAction;
}

/** RUNNING → COMPLETED. A validated HOLD needs no resultPlanVersionId. */
export async function completeRun(runId: string, fencingToken: number, result: CompleteRunInput): Promise<boolean> {
  const updated = await db.aiCoachRun.updateMany({
    where: { id: runId, status: "RUNNING", fencingToken },
    data: {
      status: "COMPLETED",
      leaseExpiresAt: null,
      resultPlanVersionId: result.resultPlanVersionId ?? null,
      resultReviewAction: result.resultReviewAction,
    },
  });
  return updated.count > 0;
}

/** RUNNING → RETRY_WAIT (if attempts remain) or → FAILED (budget exhausted). */
export async function failRunAttempt(runId: string, fencingToken: number, error: string): Promise<"RETRY_WAIT" | "FAILED" | null> {
  const run = await db.aiCoachRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING" || run.fencingToken !== fencingToken) return null;

  const exhausted = run.attempts >= MAX_ATTEMPTS_PER_RUN;
  const nextStatus = exhausted ? "FAILED" : "RETRY_WAIT";
  const delay = RETRY_DELAYS_MS[Math.min(run.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

  const updated = await db.aiCoachRun.updateMany({
    where: { id: runId, status: "RUNNING", fencingToken },
    data: {
      status: nextStatus,
      leaseExpiresAt: exhausted ? null : new Date(Date.now() + delay),
      lastError: error.slice(0, 2000),
    },
  });
  return updated.count > 0 ? nextStatus : null;
}

/** Any nonterminal run → CANCELED (safety/authority invalidation). */
export async function cancelRun(runId: string): Promise<boolean> {
  const result = await db.aiCoachRun.updateMany({
    where: { id: runId, status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] } },
    data: { status: "CANCELED", leaseExpiresAt: null },
  });
  return result.count > 0;
}

/**
 * Reconciliation sweep (A05 owns actually scheduling this): moves RUNNING
 * runs whose lease has expired to RETRY_WAIT or FAILED, fencing out the
 * presumed-dead worker so its eventual late write can't succeed; moves
 * RETRY_WAIT runs whose delay has elapsed back to QUEUED for re-claim.
 */
export async function reconcileExpiredRuns(now: Date = new Date()): Promise<{ requeued: number; failed: number; resumed: number }> {
  const expiredRunning = await db.aiCoachRun.findMany({
    where: { status: "RUNNING", leaseExpiresAt: { lt: now } },
  });

  let requeued = 0;
  let failed = 0;
  for (const run of expiredRunning) {
    const exhausted = run.attempts >= MAX_ATTEMPTS_PER_RUN;
    const nextStatus = exhausted ? "FAILED" : "RETRY_WAIT";
    const delay = RETRY_DELAYS_MS[Math.min(run.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const result = await db.aiCoachRun.updateMany({
      // Fencing: only touch it if still exactly the state we just read —
      // a worker could have completed it between our read and this write.
      where: { id: run.id, status: "RUNNING", fencingToken: run.fencingToken },
      data: {
        status: nextStatus,
        fencingToken: { increment: 1 },
        leaseExpiresAt: exhausted ? null : new Date(now.getTime() + delay),
        lastError: exhausted ? "Lease expired and attempt budget exhausted" : "Lease expired — reclaiming",
      },
    });
    if (result.count > 0) {
      if (exhausted) failed++; else requeued++;
    }
  }

  const dueRetries = await db.aiCoachRun.updateMany({
    where: { status: "RETRY_WAIT", leaseExpiresAt: { lt: now } },
    data: { status: "QUEUED", leaseExpiresAt: null },
  });

  return { requeued, failed, resumed: dueRetries.count };
}

/**
 * A server-authorized manual retry after terminal FAILED. Creates a new,
 * linked run rather than reopening the terminal row — retryGeneration
 * (part of the caller's businessKey computation, not owned here) does not
 * reset adjustment slots, clinical limits, or spending counters, because
 * it's a wholly new AiCoachRun row.
 */
export async function createRetryRun(
  originalRunId: string,
  newBusinessKey: string
): Promise<{ success: true; runId: string } | { success: false; error: string }> {
  const original = await db.aiCoachRun.findUnique({ where: { id: originalRunId } });
  if (!original) return { success: false, error: "Original run not found." };
  if (original.inputSnapshot !== null) return { success: false, error: "Use the owner-scoped managed retry command." };
  if (original.status !== "FAILED") return { success: false, error: "Can only retry a terminally failed run." };

  const created = await db.aiCoachRun.create({
    data: {
      clientId: original.clientId,
      kind: original.kind,
      businessKey: newBusinessKey,
      contextRevision: original.contextRevision,
      profileRevision: original.profileRevision,
      observationRevision: original.observationRevision,
      safetyRevision: original.safetyRevision,
      lookbackStart: original.lookbackStart,
      lookbackEnd: original.lookbackEnd,
      snapshotCutoffAt: original.snapshotCutoffAt,
      activationStartsAt: original.activationStartsAt,
      activationEndsAt: original.activationEndsAt,
      retryGeneration: original.retryGeneration + 1,
      retryOfRunId: original.id,
    },
  });
  return { success: true, runId: created.id };
}
