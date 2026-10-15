import { db } from "@/lib/db";
import {
  deliverAiPlanAcceptanceNotification,
  type AiPlanNotificationResult,
} from "@/lib/notifications/ai-coach-plan";

/**
 * T-502 — bounded acceptance-notification drain, run as a phase of
 * `runExecutorSweep` (not its own cron entry — see executor.ts). Claims
 * each unprocessed `AiPlanAcceptanceOutbox` row with a single conditional
 * `updateMany` guarded on `attempts` (the optimistic-token pattern
 * `claimQueuedRun` / `sweepAccountDeletions` use), never a
 * read-then-write: pushing a client twice is not harmless the way
 * deleting a storage object twice is. No network I/O and no `send` call
 * happens inside a `db.$transaction` — there is no transaction in this
 * file at all.
 */

export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const DRAIN_BATCH_LIMIT = 20;
export const DRAIN_WALL_CLOCK_BUDGET_MS = 15_000;
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
export const CLAIM_LEASE_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000]; // index = attempts - 1, clamped

export interface AcceptanceNotificationDrainSummary {
  skipped: boolean;
  reason: "FLAG_OFF" | "PAUSED" | "ERRORED" | null;
  stale: number; // rows retired by the age cutoff this pass
  superseded: number; // older pending rows collapsed into a newer one for the same client
  claimed: number;
  delivered: number;
  suppressed: number; // preference / no device / account closed
  retried: number; // failed, still within budget
  abandoned: number; // failed, budget exhausted -> terminal
}

function zeroSummary(reason: AcceptanceNotificationDrainSummary["reason"]): AcceptanceNotificationDrainSummary {
  return {
    skipped: reason !== null,
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

export async function drainAcceptanceNotifications(options?: {
  now?: Date;
  limit?: number;
  send?: (clientId: string) => Promise<AiPlanNotificationResult>;
}): Promise<AcceptanceNotificationDrainSummary> {
  const startedAt = Date.now();
  const now = options?.now ?? new Date();
  const send = options?.send ?? deliverAiPlanAcceptanceNotification;
  const limit = options?.limit ?? DRAIN_BATCH_LIMIT;

  const summary = zeroSummary(null);

  // 1. Stale pass — rows old enough that a "your plan changed" push would
  // be describing something that happened days ago. Retired terminal,
  // never delivered. This is the whole answer to "no backfill".
  const staleResult = await db.aiPlanAcceptanceOutbox.updateMany({
    where: { processedAt: null, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
    data: { processedAt: now, deliveryOutcome: "SUPPRESSED_STALE", nextAttemptAt: null },
  });
  summary.stale = staleResult.count;

  // 2. Supersede pass — collapse multiple pending rows for one client
  // into the newest; older ones carry no meaning the newest doesn't.
  const pending = await db.aiPlanAcceptanceOutbox.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, clientId: true },
  });
  const seenClients = new Set<string>();
  const supersededIds: string[] = [];
  for (const row of pending) {
    if (seenClients.has(row.clientId)) {
      supersededIds.push(row.id);
    } else {
      seenClients.add(row.clientId);
    }
  }
  if (supersededIds.length > 0) {
    const supersedeResult = await db.aiPlanAcceptanceOutbox.updateMany({
      where: { id: { in: supersededIds }, processedAt: null },
      data: { processedAt: now, deliveryOutcome: "SUPPRESSED_SUPERSEDED", nextAttemptAt: null },
    });
    summary.superseded = supersedeResult.count;
  }

  // 3. Candidate select — oldest first, fair, bounded.
  const candidates = await db.aiPlanAcceptanceOutbox.findMany({
    where: {
      processedAt: null,
      attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  // Safety net for MAJOR 3 (T-502 review round 1): the bulk supersede pass
  // above only dedupes within its newest-200 window, so once more than 200
  // rows are pending, two rows for the same client can both fall outside
  // that window, both stay `processedAt: null`, and both be selected by
  // the candidate query below in the same pass — which would otherwise
  // claim and `send()` both, delivering two identical pushes to one
  // client. This loop is itself a second, independent dedupe: the first
  // row processed for a given client in this pass may be delivered (or
  // otherwise resolved); every later row for that same client in this
  // same pass is retired as `SUPPRESSED_SUPERSEDED` without ever calling
  // `send`, regardless of the 200-row window.
  const deliveredClientsThisPass = new Set<string>();

  for (const row of candidates) {
    if (Date.now() - startedAt > DRAIN_WALL_CLOCK_BUDGET_MS) break;

    // Claim — single conditional updateMany guarded on the row's captured
    // `attempts` value. Postgres serializes the two row updates under
    // concurrent sweeps; the loser's predicate no longer matches.
    const claim = await db.aiPlanAcceptanceOutbox.updateMany({
      where: { id: row.id, processedAt: null, attempts: row.attempts },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
    });
    if (claim.count === 0) continue; // another sweep won it
    summary.claimed++;

    // This row's client already got a push earlier in this same pass
    // (§ note above `deliveredClientsThisPass`) — retire it directly as
    // `SUPPRESSED_SUPERSEDED` without ever calling `send`.
    // `SUPPRESSED_SUPERSEDED` is an outbox-terminal state, not a member of
    // the seam's own `AiPlanNotificationOutcome` union, so this is handled
    // before `send` is invoked rather than synthesized as a fake result.
    if (deliveredClientsThisPass.has(row.clientId)) {
      await db.aiPlanAcceptanceOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: { processedAt: now, deliveryOutcome: "SUPPRESSED_SUPERSEDED", nextAttemptAt: null, lastErrorCode: null },
      });
      summary.superseded++;
      continue;
    }

    let result: AiPlanNotificationResult;
    try {
      result = await send(row.clientId);
    } catch {
      result = { status: "FAILED", errorCode: "UNKNOWN", budgetConsumed: true };
    }

    if (result.status === "RESOLVED") {
      await db.aiPlanAcceptanceOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: { processedAt: now, deliveryOutcome: result.outcome, nextAttemptAt: null, lastErrorCode: null },
      });
      if (result.outcome === "DELIVERED") {
        summary.delivered++;
        deliveredClientsThisPass.add(row.clientId);
      } else {
        summary.suppressed++;
      }
      continue;
    }

    const consumedAttempts = row.attempts + 1;
    if (consumedAttempts >= MAX_NOTIFICATION_ATTEMPTS && result.budgetConsumed) {
      await db.aiPlanAcceptanceOutbox.updateMany({
        where: { id: row.id, processedAt: null },
        data: {
          processedAt: now,
          deliveryOutcome: "ABANDONED",
          lastErrorCode: result.errorCode,
          nextAttemptAt: null,
        },
      });
      summary.abandoned++;
      continue;
    }

    const delayIndex = Math.min(row.attempts, RETRY_DELAYS_MS.length - 1);
    await db.aiPlanAcceptanceOutbox.updateMany({
      where: { id: row.id, processedAt: null },
      data: {
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[delayIndex]),
        lastErrorCode: result.errorCode,
        ...(result.budgetConsumed ? {} : { attempts: { decrement: 1 } }),
      },
    });
    summary.retried++;
  }

  return summary;
}
