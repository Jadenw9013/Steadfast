import { weeklyCandidateIsValid } from "@/lib/ai-coach/weekly-proof";
import { evidenceIsCurrent } from "@/lib/ai-coach/evidence-snapshot";
import { Prisma } from "@/app/generated/prisma/client";
import { intakeAnswersSchema } from "@/lib/ai-coach/intake";
import { availableSubstitutions, isTargetPreserving } from "@/lib/ai-coach/representation";
import { db } from "@/lib/db";
import { lockAiClient } from "@/lib/ai-coach/access";
import {
  approvalStateHash,
  grantCoversPlan,
  validatedManagedPayload,
} from "@/lib/ai-coach/validated-plan";
import { decisionSchema } from "@/lib/ai-coach/plan-contract";
import { checkPolicyVersionUsable } from "@/lib/ai-coach/policy/policy-version";
import { contentHash } from "@/lib/ai-coach/canonical-json";

/** Shared authorized read for web and native. Unapproved proposals expose status
 * only; paused domains never return actionable instructions. No raw run inputs,
 * checkpoint/provider errors, reviewer rationale or grant notes enter this DTO.
 */
export async function getAiWorkspace(clientId: string) {
  return db.$transaction(async (tx) => {
    const { context, profile, liveRelease } = await lockAiClient(tx, clientId, false);
    const active = profile.activePlanVersionId
      ? await tx.aiPlanVersion.findFirst({
          where: { id: profile.activePlanVersionId, clientId, acceptedAt: { not: null } },
        })
      : null;
    const allowed = context?.mode === "AI" && !context.resolutionRequired;
    const activePayload =
      active && allowed && checkPolicyVersionUsable(active.policyVersion).usable
        ? validatedManagedPayload(active)
        : null;
    const proposals = await tx.aiPlanVersion.findMany({
      where: { clientId, status: "PROPOSED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        approval: {
          include: { reviewerGrant: { include: { user: { select: { isDeactivated: true } } } } },
        },
      },
    });
    const proposalIds = proposals.map((proposal) => proposal.id);
    const automaticApprovals = await tx.aiAutomaticPlanApproval.findMany({
      where: { clientId, planVersionId: { in: proposalIds } },
    });
    const automaticByPlan = new Map(
      automaticApprovals.map((approval) => [approval.planVersionId, approval])
    );
    const gateDecisions = await tx.aiAutonomyGateDecision.findMany({
      where: { clientId, evaluatedPlanVersionId: { in: proposalIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const gateById = new Map(gateDecisions.map((gate) => [gate.id, gate]));
    const latestGateByPlan = new Map<string, (typeof gateDecisions)[number]>();
    for (const gate of gateDecisions) {
      if (gate.evaluatedPlanVersionId && !latestGateByPlan.has(gate.evaluatedPlanVersionId)) {
        latestGateByPlan.set(gate.evaluatedPlanVersionId, gate);
      }
    }
    const providerAudits = await tx.aiProviderBoundaryAudit.findMany({
      where: { clientId, preGateDecisionId: { in: gateDecisions.map((gate) => gate.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const latestProviderByPlan = new Map<string, (typeof providerAudits)[number]>();
    for (const audit of providerAudits) {
      const planId = gateById.get(audit.preGateDecisionId)?.evaluatedPlanVersionId;
      if (planId && !latestProviderByPlan.has(planId)) latestProviderByPlan.set(planId, audit);
    }
    const runs = await tx.aiCoachRun.findMany({
      where: { clientId, inputSnapshot: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const draft = await tx.aiIntakeDraft.findUnique({ where: { clientId } });
    const confirmed = intakeAnswersSchema.safeParse(profile.confirmedIntake);
    const substitutions =
      activePayload &&
      confirmed.success &&
      [profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].every(
        (p) => p === "ALLOW"
      )
        ? availableSubstitutions(activePayload, confirmed.data)
        : [];
    return {
      substitutions,
      schemaVersion: 1 as const,
      // Capability field (T-2002/T-2024): a client newer than this backend
      // can detect the intake schema versions this server understands and
      // degrade instead of eating an opaque 422. `schemaVersion` itself
      // stays 1 — the shipped iOS build hard-fails on anything else.
      intakeSchemaVersions: [1, 2] as const,
      experience: profile.isSynthetic
        ? { mode: "SYNTHETIC" as const, disclosure: null }
        : {
            mode: "LIVE" as const,
            disclosure: {
              locale: liveRelease!.runtimeConfiguration.discovery.locale,
              serviceLabel: liveRelease!.runtimeConfiguration.discovery.serviceLabel,
              headline: liveRelease!.runtimeConfiguration.discovery.headline,
              summary: liveRelease!.runtimeConfiguration.discovery.summary,
              informationHeading: liveRelease!.runtimeConfiguration.discovery.informationHeading,
              disclosureParagraphs:
                liveRelease!.runtimeConfiguration.discovery.disclosureParagraphs,
              privacyNoticeVersion:
                liveRelease!.runtimeConfiguration.discovery.privacyNoticeVersion,
              privacyNoticeUrl: liveRelease!.runtimeConfiguration.discovery.privacyNoticeUrl,
              consentLabel: liveRelease!.runtimeConfiguration.discovery.consentLabel,
              confirmLabel: liveRelease!.runtimeConfiguration.discovery.confirmLabel,
              privacyNoticeLabel: liveRelease!.runtimeConfiguration.discovery.privacyNoticeLabel,
              configurationId: liveRelease!.runtimeConfiguration.discovery.configurationId,
              configurationVersion: liveRelease!.runtimeConfiguration.discovery.version,
              consentTextDigest: contentHash(liveRelease!.runtimeConfiguration.discovery),
            },
          },
      origin: context?.mode ?? "NONE",
      contextRevision: context?.revision ?? 0,
      profileRevision: profile.profileRevision,
      observationRevision: profile.observationRevision,
      safetyRevision: profile.safetyRevision,
      confirmedIntake: profile.confirmedIntake,
      draft: draft?.answers ?? null,
      reviewTimezone: profile.reviewTimezone,
      permissions: {
        nutrition: profile.nutritionPermission,
        strength: profile.strengthPermission,
        cardio: profile.cardioPermission,
      },
      safetyDisposition: profile.safetyDisposition,
      activePlan:
        activePayload && active
          ? {
              id: active.id,
              acceptedAt: active.acceptedAt!.toISOString(),
              payload: {
                ...activePayload,
                nutrition:
                  profile.nutritionPermission === "PAUSED" ? null : activePayload.nutrition,
                meals: profile.nutritionPermission === "PAUSED" ? null : activePayload.meals,
                strength: profile.strengthPermission === "PAUSED" ? [] : activePayload.strength,
                cardio: profile.cardioPermission === "PAUSED" ? [] : activePayload.cardio,
              },
            }
          : null,
      proposals: await Promise.all(
        proposals.map(async (candidate) => {
          const fresh =
            (await weeklyCandidateIsValid(tx, candidate)) &&
            (await evidenceIsCurrent(tx, clientId, candidate.sourceRefs)) &&
            allowed &&
            candidate.contextRevision === context?.revision &&
            candidate.profileRevision === profile.profileRevision &&
            candidate.observationRevision === profile.observationRevision &&
            candidate.safetyRevision === profile.safetyRevision &&
            candidate.baseVersionId === profile.activePlanVersionId &&
            (!candidate.activationEndsAt || candidate.activationEndsAt > new Date()) &&
            [
              profile.nutritionPermission,
              profile.strengthPermission,
              profile.cardioPermission,
            ].every((p) => p === "ALLOW");
          const approved =
            candidate.reviewerStatus === "APPROVED" &&
            candidate.approval?.approved &&
            candidate.approval.approvedHash === candidate.payloadHash &&
            !candidate.approval.reviewerGrant.user.isDeactivated &&
            grantCoversPlan(candidate.approval.reviewerGrant, clientId, candidate.payload) &&
            candidate.approval.stateHash === approvalStateHash(candidate);
          const checked = validatedManagedPayload(candidate);
          const intake = intakeAnswersSchema.safeParse(profile.confirmedIntake);
          const equivalent =
            candidate.changeClass === "TARGET_PRESERVING" &&
            candidate.reviewerStatus === "NOT_REQUIRED" &&
            activePayload &&
            checked &&
            intake.success &&
            isTargetPreserving(activePayload, checked, intake.data);
          const automatic = automaticByPlan.get(candidate.id);
          const providerAudit = automatic
            ? providerAudits.find((audit) => audit.id === automatic.providerBoundaryAuditId)
            : null;
          const automaticState = automatic
            ? {
                clientId: automatic.clientId,
                planVersionId: automatic.planVersionId,
                gateDecisionId: automatic.gateDecisionId,
                providerBoundaryAuditId: automatic.providerBoundaryAuditId,
                evaluationKey: automatic.evaluationKey,
                candidatePayloadHash: automatic.candidatePayloadHash,
                artifactRequest: automatic.artifactRequest,
                artifactRefs: automatic.artifactRefs,
                sourceRefs: automatic.sourceRefs,
                gateInput: automatic.gateInput,
                providerSelection: automatic.providerSelection,
              }
            : null;
          const automaticApproved = Boolean(
            automatic &&
            automaticState &&
            contentHash(automaticState) === automatic.stateDigest &&
            automatic.candidatePayloadHash === candidate.payloadHash &&
            providerAudit?.boundaryOutcome === "VALIDATED" &&
            providerAudit.resultOutcome === "APPROVE_AUTOMATICALLY" &&
            providerAudit.finalGateDecisionId === automatic.gateDecisionId
          );
          const legacyAuthorized = candidate.validationReport === null && (approved || equivalent);
          const payload =
            fresh &&
            (automaticApproved || legacyAuthorized) &&
            checkPolicyVersionUsable(candidate.policyVersion).usable
              ? checked
              : null;
          const providerOutcome = latestProviderByPlan.get(candidate.id)?.resultOutcome;
          const gateOutcome = latestGateByPlan.get(candidate.id)?.outcome;
          const outcome = providerOutcome ?? gateOutcome ?? null;
          const status = !fresh
            ? "STALE"
            : payload
              ? "READY"
              : outcome === "PAUSE_REFER"
                ? "PAUSE_REFER"
                : outcome === "FOCUSED_CLARIFICATION"
                  ? "FOCUSED_CLARIFICATION"
                  : outcome === "HOLD"
                    ? "HOLD"
                    : "PENDING_FINALIZATION";
          return {
            id: candidate.id,
            status,
            payload,
            authorization: {
              outcome,
              reasonCodes: latestProviderByPlan.get(candidate.id)
                ? [latestProviderByPlan.get(candidate.id)!.failureCode].filter(
                    (value): value is string => Boolean(value)
                  )
                : (latestGateByPlan.get(candidate.id)?.orderedReasonCodes ?? []),
              nextActionTemplateId:
                latestGateByPlan.get(candidate.id)?.nextActionTemplateId ?? null,
              interpretation: automaticApproved ? (automatic?.providerSelection ?? null) : null,
            },
            expectedBaseVersionId: candidate.baseVersionId,
            expectedContextRevision: candidate.contextRevision,
            expectedProfileRevision: candidate.profileRevision,
            expectedObservationRevision: candidate.observationRevision,
            expectedSafetyRevision: candidate.safetyRevision,
          };
        })
      ),
      runs: runs.map((run) => {
        const decision = decisionSchema.safeParse(run.resultDecision);
        return {
          id: run.id,
          kind: run.kind,
          status: run.status,
          createdAt: run.createdAt.toISOString(),
          resultPlanVersionId: run.resultPlanVersionId,
          decision: decision.success ? decision.data : null,
          failureMessage:
            run.status === "FAILED"
              ? "Preparation could not finish. Your current plan has not been replaced."
              : null,
        };
      }),
    };
  });
}
export type AiWorkspace = Awaited<ReturnType<typeof getAiWorkspace>>;
