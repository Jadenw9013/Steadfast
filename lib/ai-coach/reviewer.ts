import { weeklyCandidateIsValid } from "./weekly-proof";
import { evidenceIsCurrent } from "./evidence-snapshot";
import { z } from "zod";
import { db } from "@/lib/db";
import { AiCoachError, lockAiClient, requireFixtureRuntime } from "./access";
import { approvalStateHash, grantCoversPlan, validatedManagedPayload } from "./validated-plan";
import { contentHash } from "./canonical-json";
import { checkPolicyVersionUsable } from "./policy/policy-version";

export async function getReviewerQueue(reviewerId: string) {
  requireFixtureRuntime();
  const grant = await db.aiCoachReviewerGrant.findUnique({ where: { userId: reviewerId }, include: { user: { select: { isDeactivated: true } } } });
  if (!grant || grant.revokedAt || grant.user.isDeactivated) throw new AiCoachError("FORBIDDEN", "An active reviewer capability is required.", 403);
  const where = { clientId: { in: grant.clientIds, not: reviewerId }, status: "PROPOSED" as const, reviewerStatus: "PENDING" as const, client: { isDeactivated: false, aiCoachProfile: { isSynthetic: true } } };
  const candidates = await db.aiPlanVersion.findMany({ where, orderBy: { createdAt: "asc" }, take: 50 });
  const backlog = await db.aiPlanVersion.count({ where });
  return { backlog, capacity: 50, capacityReached: backlog >= 50, oldestPendingAt: candidates[0]?.createdAt.toISOString() ?? null,
    candidates: candidates.filter(c => grantCoversPlan(grant, c.clientId, c.payload)).flatMap(candidate => {
      const payload = validatedManagedPayload(candidate);
      return payload ? [{ id: candidate.id, clientId: candidate.clientId, createdAt: candidate.createdAt.toISOString(), payload, stateHash: approvalStateHash(candidate), changeClass: candidate.changeClass }] : [];
    }),
  };
}
const reviewInputSchema = z.object({ requestKey: z.string().uuid(), expectedStateHash: z.string().length(64), approved: z.boolean(), rationale: z.string().trim().min(1).max(1000) }).strict();
export async function reviewAiPlan(reviewerId: string, planId: string, raw: unknown) {
  requireFixtureRuntime();
  const parsed = reviewInputSchema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "A decision, reason and exact plan state are required.", 422);
  const input = parsed.data;
  const owner = await db.aiPlanVersion.findUnique({ where: { id: planId }, select: { clientId: true } });
  if (!owner) throw new AiCoachError("NOT_FOUND", "Proposal not found.", 404);
  return db.$transaction(async tx => {
    const { profile, context } = await lockAiClient(tx, owner.clientId);
    await tx.$queryRaw`SELECT "id" FROM "AiPlanVersion" WHERE "id" = ${planId} FOR UPDATE`;
    await tx.$queryRaw`SELECT g."id" FROM "AiCoachReviewerGrant" g JOIN "User" u ON u."id" = g."userId" WHERE g."userId" = ${reviewerId} FOR UPDATE OF g, u`;
    const grant = await tx.aiCoachReviewerGrant.findUnique({ where: { userId: reviewerId }, include: { user: { select: { isDeactivated: true } } } });
    const candidate = await tx.aiPlanVersion.findUniqueOrThrow({ where: { id: planId } });
    if (!grant || grant.user.isDeactivated || !grantCoversPlan(grant, owner.clientId, candidate.payload)) throw new AiCoachError("FORBIDDEN", "You are not assigned and qualified to review this proposal.", 403);
    const key = { clientId: reviewerId, operation: "REVIEW", requestKey: input.requestKey };
    const inputDigest = contentHash({ planId, ...input });
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) {
      if (receipt.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This request key was already used.");
      return receipt.result;
    }
    if (!await weeklyCandidateIsValid(tx, candidate) || !await evidenceIsCurrent(tx, owner.clientId, candidate.sourceRefs)) throw new AiCoachError("STALE_PROPOSAL", "Source evidence changed. A new review is required.");
    if (!validatedManagedPayload(candidate) || !checkPolicyVersionUsable(candidate.policyVersion).usable || approvalStateHash(candidate) !== input.expectedStateHash) throw new AiCoachError("STALE_PROPOSAL", "The proposal content or policy changed. Refresh before reviewing.");
    if (candidate.status !== "PROPOSED" || candidate.reviewerStatus !== "PENDING" || candidate.contextRevision !== context!.revision || candidate.profileRevision !== profile.profileRevision || candidate.observationRevision !== profile.observationRevision || candidate.safetyRevision !== profile.safetyRevision || candidate.baseVersionId !== profile.activePlanVersionId || (candidate.activationEndsAt && candidate.activationEndsAt <= new Date())) throw new AiCoachError("STALE_PROPOSAL", "The proposal is no longer awaiting review in this state.");
    await tx.aiPlanReviewerApproval.create({ data: { planVersionId: planId, reviewerGrantId: grant.id, approvedHash: candidate.payloadHash, stateHash: input.expectedStateHash, approved: input.approved, rationale: input.rationale } });
    await tx.aiPlanVersion.update({ where: { id: planId }, data: { reviewerStatus: input.approved ? "APPROVED" : "REJECTED" } });
    const result = { planId, approved: input.approved };
    await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } });
    return result;
  });
}
