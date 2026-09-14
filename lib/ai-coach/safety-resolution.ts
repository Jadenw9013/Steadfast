import { z } from "zod";
import { db } from "@/lib/db";
import { AiCoachError, lockAiClient, requireFixtureRuntime } from "./access";
import { contentHash } from "./canonical-json";
import { invalidateAiProposals } from "./client-commands";
const domains = ["NUTRITION", "STRENGTH", "CARDIO"] as const;
const schema = z.object({ requestKey: z.string().uuid(), clientId: z.string().min(1).max(120), expectedSafetyRevision: z.number().int().nonnegative(), domains: z.array(z.enum(domains)).min(1).max(3), reviewReference: z.string().trim().min(1).max(200), rationale: z.string().trim().min(1).max(1000), confirmed: z.literal(true) }).strict();
export async function getSafetyCases(reviewerId: string) {
  requireFixtureRuntime();
  const grant = await db.aiCoachReviewerGrant.findUnique({ where: { userId: reviewerId }, include: { user: { select: { isDeactivated: true } } } });
  if (!grant || grant.revokedAt || grant.user.isDeactivated) throw new AiCoachError("FORBIDDEN", "Active reviewer access is required.", 403);
  // Cross-domain disclosures require all-domain scope before they are displayed.
  if (!domains.every(d => grant.domains.includes(d))) return [];
  const cases = await db.aiCoachProfile.findMany({ where: { clientId: { in: grant.clientIds, not: reviewerId }, isSynthetic: true, safetyDisposition: { not: "CLEAR" }, client: { isDeactivated: false } }, take: 50, orderBy: { updatedAt: "asc" }, select: { clientId: true, safetyRevision: true, safetyDisposition: true, nutritionPermission: true, strengthPermission: true, cardioPermission: true } });
  return Promise.all(cases.map(async c => ({ ...c, disclosures: await db.aiSafetyDisclosureEvent.findMany({ where: { clientId: c.clientId }, orderBy: { reportedAt: "desc" }, take: 5, select: { id: true, reportedAt: true, structuredAnswers: true, dispositionAfter: true } }) })));
}
export async function resolveAiSafety(reviewerId: string, raw: unknown) {
  requireFixtureRuntime();
  const input = schema.safeParse(raw);
  if (!input.success || new Set(input.data.domains).size !== input.data.domains.length) throw new AiCoachError("VALIDATION_ERROR", "Confirm domains, current revision, review reference and rationale.", 422);
  const { requestKey, clientId, ...decision } = input.data;
  return db.$transaction(async tx => {
    const { profile } = await lockAiClient(tx, clientId, false);
    await tx.$queryRaw`SELECT g."id" FROM "AiCoachReviewerGrant" g JOIN "User" u ON u."id" = g."userId" WHERE g."userId" = ${reviewerId} FOR UPDATE OF g, u`;
    const grant = await tx.aiCoachReviewerGrant.findUnique({ where: { userId: reviewerId }, include: { user: { select: { isDeactivated: true } } } });
    if (!grant || grant.revokedAt || grant.user.isDeactivated || reviewerId === clientId || !grant.clientIds.includes(clientId) || !decision.domains.every(d => grant.domains.includes(d))) throw new AiCoachError("FORBIDDEN", "You are not assigned and qualified to resolve these domains.", 403);
    const key = { clientId: reviewerId, operation: "SAFETY_RESOLUTION", requestKey }; const inputDigest = contentHash({ clientId, ...decision });
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) { if (receipt.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This request key was already used."); return receipt.result; }
    if (profile.safetyRevision !== decision.expectedSafetyRevision) throw new AiCoachError("REVISION_CONFLICT", "New safety information arrived. Review the latest disclosures before resolving.");
    const nutrition = decision.domains.includes("NUTRITION") ? "ALLOW" : profile.nutritionPermission;
    const strength = decision.domains.includes("STRENGTH") ? "ALLOW" : profile.strengthPermission;
    const cardio = decision.domains.includes("CARDIO") ? "ALLOW" : profile.cardioPermission;
    const disposition = [nutrition, strength, cardio].every(p => p === "ALLOW") ? "CLEAR" : profile.safetyDisposition === "URGENT" || profile.safetyDisposition === "REFER" ? profile.safetyDisposition : "RESTRICTED";
    await tx.aiCoachProfile.update({ where: { clientId }, data: { nutritionPermission: nutrition, strengthPermission: strength, cardioPermission: cardio, safetyDisposition: disposition, safetyRevision: { increment: 1 } } });
    await tx.aiSafetyDisclosureEvent.create({ data: { clientId, structuredAnswers: { source: "REVIEWED_RESOLUTION", reviewerGrantId: grant.id, domains: decision.domains, reviewReference: decision.reviewReference, rationale: decision.rationale }, dispositionAfter: disposition, nutritionPermissionAfter: nutrition, strengthPermissionAfter: strength, cardioPermissionAfter: cardio, safetyRevisionAfter: profile.safetyRevision + 1 } });
    await invalidateAiProposals(tx, clientId);
    const result = { clientId, safetyRevision: profile.safetyRevision + 1, disposition };
    await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } }); return result;
  });
}
