import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { lockAiClient } from "@/lib/ai-coach/access";
import { approvalStateHash, grantCoversPlan, validatedManagedPayload } from "@/lib/ai-coach/validated-plan";
import { decisionSchema } from "@/lib/ai-coach/plan-contract";
import { checkPolicyVersionUsable } from "@/lib/ai-coach/policy/policy-version";

/** Shared authorized read for web and native. Unapproved proposals expose status
 * only; paused domains never return actionable instructions. No raw run inputs,
 * checkpoint/provider errors, reviewer rationale or grant notes enter this DTO.
 */
export async function getAiWorkspace(clientId: string) {
  return db.$transaction(async tx => {
    const { context, profile } = await lockAiClient(tx, clientId, false);
    const active = profile.activePlanVersionId ? await tx.aiPlanVersion.findFirst({ where: { id: profile.activePlanVersionId, clientId, acceptedAt: { not: null } } }) : null;
    const allowed = context?.mode === "AI" && !context.resolutionRequired;
    const activePayload = active && allowed && checkPolicyVersionUsable(active.policyVersion).usable ? validatedManagedPayload(active) : null;
    const proposals = await tx.aiPlanVersion.findMany({ where: { clientId, status: "PROPOSED" }, orderBy: { createdAt: "desc" }, take: 20, include: { approval: { include: { reviewerGrant: { include: { user: { select: { isDeactivated: true } } } } } } } });
    const runs = await tx.aiCoachRun.findMany({ where: { clientId, inputSnapshot: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, take: 30 });
    const draft = await tx.aiIntakeDraft.findUnique({ where: { clientId } });
    return {
      schemaVersion: 1 as const, origin: context?.mode ?? "NONE", contextRevision: context?.revision ?? 0,
      profileRevision: profile.profileRevision, observationRevision: profile.observationRevision, safetyRevision: profile.safetyRevision,
      confirmedIntake: profile.confirmedIntake, draft: draft?.answers ?? null, reviewTimezone: profile.reviewTimezone,
      permissions: { nutrition: profile.nutritionPermission, strength: profile.strengthPermission, cardio: profile.cardioPermission },
      safetyDisposition: profile.safetyDisposition,
      activePlan: activePayload && active ? { id: active.id, acceptedAt: active.acceptedAt!.toISOString(), payload: {
        ...activePayload,
        nutrition: profile.nutritionPermission === "PAUSED" ? null : activePayload.nutrition,
        meals: profile.nutritionPermission === "PAUSED" ? null : activePayload.meals,
        strength: profile.strengthPermission === "PAUSED" ? [] : activePayload.strength,
        cardio: profile.cardioPermission === "PAUSED" ? [] : activePayload.cardio,
      } } : null,
      proposals: proposals.map(candidate => {
        const fresh = allowed && candidate.contextRevision === context?.revision && candidate.profileRevision === profile.profileRevision && candidate.observationRevision === profile.observationRevision && candidate.safetyRevision === profile.safetyRevision && candidate.baseVersionId === profile.activePlanVersionId && (!candidate.activationEndsAt || candidate.activationEndsAt > new Date()) && [profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].every(p => p === "ALLOW");
        const approved = candidate.reviewerStatus === "APPROVED" && candidate.approval?.approved && candidate.approval.approvedHash === candidate.payloadHash && !candidate.approval.reviewerGrant.user.isDeactivated && grantCoversPlan(candidate.approval.reviewerGrant, clientId, candidate.payload) && candidate.approval.stateHash === approvalStateHash(candidate);
        const payload = fresh && approved && checkPolicyVersionUsable(candidate.policyVersion).usable ? validatedManagedPayload(candidate) : null;
        return { id: candidate.id, status: !fresh ? "STALE" : payload ? "READY" : "PENDING_REVIEW", payload,
          expectedBaseVersionId: candidate.baseVersionId, expectedContextRevision: candidate.contextRevision, expectedProfileRevision: candidate.profileRevision, expectedObservationRevision: candidate.observationRevision, expectedSafetyRevision: candidate.safetyRevision };
      }),
      runs: runs.map(run => {
        const decision = decisionSchema.safeParse(run.resultDecision);
        return { id: run.id, kind: run.kind, status: run.status, createdAt: run.createdAt.toISOString(), resultPlanVersionId: run.resultPlanVersionId, decision: decision.success ? decision.data : null, failureMessage: run.status === "FAILED" ? "Preparation could not finish. Your current plan has not been replaced." : null };
      }),
    };
  });
}
export type AiWorkspace = Awaited<ReturnType<typeof getAiWorkspace>>;
