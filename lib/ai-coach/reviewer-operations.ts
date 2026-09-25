import { db } from "@/lib/db";
import { AiCoachError, requireFixtureRuntime } from "./access";
import { getAcceptanceDeliveryState } from "./operations";
/** Bounded aggregate operational data, limited to explicitly assigned clients.
 * No prompts, health answers, personal messages or raw failure bodies. */
export async function getReviewerOperations(reviewerId: string) {
  requireFixtureRuntime();
  const grant = await db.aiCoachReviewerGrant.findUnique({ where: { userId: reviewerId }, include: { user: { select: { isDeactivated: true } } } });
  if (!grant || grant.revokedAt || grant.user.isDeactivated) throw new AiCoachError("FORBIDDEN", "An active reviewer capability is required.", 403);
  const now = new Date(); const recent = new Date(now.getTime() - 7 * 86400000);
  const owner = { clientId: { in: grant.clientIds, not: reviewerId }, client: { isDeactivated: false, aiCoachProfile: { isSynthetic: true } } };
  const open = { ...owner, status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] as ("QUEUED" | "RUNNING" | "RETRY_WAIT")[] } };
  // notificationDelivery comes from `getAcceptanceDeliveryState()`
  // (lib/ai-coach/operations.ts) — the same function the drain's own gate
  // calls — rather than a second, hand-rolled control-row check here. Two
  // independent implementations of "is delivery enabled" previously
  // disagreed in production with no ACCEPTANCE control row yet (T-502
  // review round 1, MAJOR 1); there is now exactly one.
  const [statuses, oldest, expiredLeases, retriedRuns, pendingNotifications, oldestNotification, closedPendingProposals, abandonedNotifications, retiredNotifications, notificationDelivery] = await Promise.all([
    db.aiCoachRun.groupBy({ by: ["status"], where: { ...owner, createdAt: { gte: recent } }, _count: { _all: true } }),
    db.aiCoachRun.findFirst({ where: open, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.aiCoachRun.count({ where: { ...owner, status: "RUNNING", leaseExpiresAt: { lte: now } } }),
    db.aiCoachRun.count({ where: { ...owner, createdAt: { gte: recent }, OR: [{ attempts: { gt: 1 } }, { retryGeneration: { gt: 0 } }] } }),
    db.aiPlanAcceptanceOutbox.count({ where: { ...owner, processedAt: null } }),
    db.aiPlanAcceptanceOutbox.findFirst({ where: { ...owner, processedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.aiPlanVersion.count({ where: { ...owner, status: "PROPOSED", reviewerStatus: "PENDING", activationEndsAt: { lte: now } } }),
    db.aiPlanAcceptanceOutbox.count({ where: { ...owner, deliveryOutcome: "ABANDONED" } }),
    // SUPPRESSED_STALE + SUPPRESSED_SUPERSEDED — terminal, never delivered,
    // and otherwise invisible: `pendingNotifications` drops them the moment
    // they're retired, and `abandonedNotifications` only counts ABANDONED.
    // Without this, the first flag-on sweep's pending count falling N→0
    // reads as "N delivered" when most of N may have been suppressed.
    db.aiPlanAcceptanceOutbox.count({ where: { ...owner, deliveryOutcome: { in: ["SUPPRESSED_STALE", "SUPPRESSED_SUPERSEDED"] } } }),
    getAcceptanceDeliveryState(),
  ]);
  const current = await db.aiCoachReviewerGrant.findUnique({ where: { id: grant.id }, include: { user: { select: { isDeactivated: true } } } });
  if (!current || current.revokedAt || current.user.isDeactivated || JSON.stringify(current.clientIds) !== JSON.stringify(grant.clientIds)) throw new AiCoachError("FORBIDDEN", "Reviewer assignments changed. Refresh to continue.", 403);
  return { sampledAt: now.toISOString(), periodStartsAt: recent.toISOString(), statuses: Object.fromEntries(statuses.map(s => [s.status, s._count._all])), oldestOpenRunAt: oldest?.createdAt.toISOString() ?? null, expiredLeases, retriedRuns, pendingNotifications, oldestNotificationAt: oldestNotification?.createdAt.toISOString() ?? null, closedPendingProposals, abandonedNotifications, retiredNotifications, notificationDelivery };
}
