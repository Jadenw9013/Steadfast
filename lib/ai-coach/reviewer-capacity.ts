import type { Prisma } from "@/app/generated/prisma/client";
import { AiCoachError } from "./access";
export const FIXTURE_REVIEW_CAPACITY = 50;
/** Caller holds client authority lock. Grant locks serialize capacity reservation
 * across assigned clients; queued jobs count before they produce proposals. */
export async function requireReviewerCapacity(tx: Prisma.TransactionClient, clientId: string, enrollment = false) {
  await tx.$queryRaw`SELECT g."id" FROM "AiCoachReviewerGrant" g JOIN "User" u ON u."id" = g."userId" WHERE ${clientId} = ANY(g."clientIds") ORDER BY g."id" FOR UPDATE OF g, u`;
  const grants = await tx.aiCoachReviewerGrant.findMany({ where: { clientIds: { has: clientId }, revokedAt: null, userId: { not: clientId }, user: { isDeactivated: false } }, orderBy: { id: "asc" } });
  const qualified = grants.filter(g => ["NUTRITION", "STRENGTH", "CARDIO"].every(d => g.domains.includes(d)));
  if (!qualified.length) throw new AiCoachError("REVIEWER_UNAVAILABLE", "An assigned qualified reviewer is required before enrollment or preparing a numerical proposal.", 503);
  for (const grant of qualified) {
    const where = { clientId: { in: grant.clientIds }, OR: [{ activationEndsAt: null }, { activationEndsAt: { gt: new Date() } }] };
    const pending = await tx.aiPlanVersion.count({ where: { ...where, status: "PROPOSED", reviewerStatus: "PENDING" } });
    const running = await tx.aiCoachRun.count({ where: { ...where, kind: { not: "REPRESENTATION" }, status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] } } });
    const enrolled = enrollment ? await tx.aiCoachProfile.count({ where: { clientId: { in: grant.clientIds, not: clientId }, consentedAt: { not: null }, client: { coachingContext: { mode: "AI" } } } }) : 0;
    if (pending + running < FIXTURE_REVIEW_CAPACITY && enrolled < FIXTURE_REVIEW_CAPACITY) return;
  }
  throw new AiCoachError("REVIEWER_CAPACITY", "Assigned review capacity is full. Please try again when capacity is restored.", 503);
}
