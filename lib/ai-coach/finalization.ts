import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireFixtureRuntime, AiCoachError } from "./access";
import {
  getReviewedPolicyBundleContent,
  loadReviewedArtifactSet,
  type ArtifactLoadRequest,
} from "./artifacts/repository";
import { SYNTHETIC_ARTIFACT_ENGINE_VERSION } from "./artifacts/synthetic-fixtures";
import { contentHash } from "./canonical-json";
import { evaluateCurrentClientNutritionSafety } from "./nutrition-safety";
import { assertAiCoachOperationEnabled } from "./operations";
import { runConstrainedProviderBoundary } from "./provider/constrained-boundary";
import { SyntheticConstrainedProvider } from "./provider/synthetic-provider";
import { sourceRefSchema } from "./plan-contract";
import { safetyDisclosureSchema, type TriState } from "./safety";
import { validatedManagedPayload } from "./validated-plan";

const RUNTIME_POLICY_KEY = "policy-fixture-v1";

export function syntheticRuntimeArtifactRequest(): ArtifactLoadRequest {
  return {
    engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    policyArtifactKey: RUNTIME_POLICY_KEY,
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function status(value: TriState | undefined): "CLEAR" | "EXCLUDED" | "UNKNOWN" {
  if (value === "NO") return "CLEAR";
  if (value === "YES") return "EXCLUDED";
  return "UNKNOWN";
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * T-1008 synthetic-only finalization. The caller supplies only the owned plan
 * identifier. Identity, safety answers, policy, evidence, revisions, catalog
 * candidates and provider implementation are all selected by the server.
 */
export async function finalizeCurrentClientPlan(planVersionId: string) {
  requireFixtureRuntime();
  await assertAiCoachOperationEnabled("FINALIZATION");
  await assertAiCoachOperationEnabled("PROVIDER");
  const user = await getCurrentDbUser();
  const candidate = await db.aiPlanVersion.findFirst({
    where: { id: planVersionId, clientId: user.id, status: "PROPOSED" },
  });
  if (!candidate) throw new AiCoachError("NOT_FOUND", "Plan proposal not found.", 404);
  const payload = validatedManagedPayload(candidate);
  if (!payload || candidate.policyVersion !== RUNTIME_POLICY_KEY) {
    throw new AiCoachError(
      "VALIDATION_ERROR",
      "The proposal is not a valid synthetic candidate.",
      422
    );
  }
  const [profile, disclosure] = await Promise.all([
    db.aiCoachProfile.findUnique({ where: { clientId: user.id } }),
    db.aiSafetyDisclosureEvent.findFirst({
      where: { clientId: user.id },
      orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  if (!profile?.isSynthetic) {
    throw new AiCoachError(
      "FORBIDDEN",
      "Automatic finalization is limited to persisted synthetic accounts.",
      403
    );
  }
  const answers = safetyDisclosureSchema.safeParse(disclosure?.structuredAnswers);
  const allAnswered =
    answers.success &&
    [
      answers.data.ageEligibilityConcern,
      answers.data.eatingDisorderHistoryOrConcern,
      answers.data.type1Diabetes,
    ].every(Boolean);
  const screeningValues = answers.success ? Object.values(answers.data) : [];
  const screeningResult =
    !answers.success || !allAnswered
      ? "UNKNOWN"
      : screeningValues.includes("YES")
        ? "FLAGGED"
        : screeningValues.includes("UNSURE")
          ? "UNKNOWN"
          : "CLEAR";
  const request = syntheticRuntimeArtifactRequest();
  await evaluateCurrentClientNutritionSafety(request, {
    screening: {
      instrumentId: "SYNTHETIC_SCREENING_INSTRUMENT_NOT_FOR_LIVE_USE",
      result: screeningResult,
      provenance: "SYNTHETIC_SERVER_FIXTURE",
    },
    contraindications: {
      AGE_ELIGIBILITY: status(answers.success ? answers.data.ageEligibilityConcern : undefined),
      PREGNANCY_POSTPARTUM: status(answers.success ? answers.data.pregnantOrPostpartum : undefined),
      EATING_DISORDER_HISTORY_OR_CONCERN: status(
        answers.success ? answers.data.eatingDisorderHistoryOrConcern : undefined
      ),
      TYPE_1_DIABETES: status(answers.success ? answers.data.type1Diabetes : undefined),
      CARDIAC_CONDITION: status(answers.success ? answers.data.heartCondition : undefined),
    },
    proposal: payload.nutrition
      ? {
          proposedDailyEnergyKcal: payload.nutrition.targets.energyKcal,
          currentWeightKg:
            typeof (profile.confirmedIntake as { weightKg?: unknown } | null)?.weightKg === "number"
              ? (profile.confirmedIntake as { weightKg: number }).weightKg
              : null,
          // Neutral synthetic fixture value; not a live estimate or client-facing claim.
          projectedWeeklyWeightChangeKg: 0,
          provenance: "SYNTHETIC_SERVER_FIXTURE",
        }
      : null,
  });
  const artifacts = await loadReviewedArtifactSet(request);
  const policy = getReviewedPolicyBundleContent(artifacts.policy);
  const sourceRefs = z.array(sourceRefSchema).parse(candidate.sourceRefs ?? []);
  const requiredInputs = policy.requiredInputIds.map((id) => ({
    id,
    status:
      id === "SYNTHETIC_REQUIRED_INPUT"
        ? profile.confirmedIntake
          ? ("CONFIRMED" as const)
          : ("UNKNOWN" as const)
        : id === "SYNTHETIC_SCREEN_RESULT"
          ? screeningResult === "CLEAR"
            ? ("CONFIRMED" as const)
            : ("UNKNOWN" as const)
          : ("CONFIRMED" as const),
  }));
  const requestedDomains = distinct(
    [
      payload.nutrition ? "NUTRITION" : null,
      payload.strength.length ? "STRENGTH" : null,
      payload.cardio.length ? "CARDIO" : null,
    ].filter((value): value is "NUTRITION" | "STRENGTH" | "CARDIO" => value !== null)
  );
  const gateInput = {
    requestedScopeClasses: distinct([
      ...(payload.nutrition ? ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION" as const] : []),
      ...(payload.strength.length || payload.cardio.length
        ? ["GENERAL_FITNESS_PROGRAMMING" as const]
        : []),
    ]),
    requestedDomains,
    requiredInputs,
    evidence: policy.evidenceRuleIds.map((ruleId) => ({
      ruleId,
      status: "SUFFICIENT" as const,
      sourceRefs,
    })),
    candidatePlanVersionId: candidate.id,
  };
  const eligibleOptions = distinct([
    ...(payload.meals?.days.flatMap((day) =>
      day.meals.flatMap((meal) => meal.ingredients.map((item) => `FOOD:${item.foodId}`))
    ) ?? []),
    ...payload.strength.flatMap((session) =>
      session.exercises.map((item) => `EXERCISE:${item.exerciseId}`)
    ),
    ...payload.cardio.map((item) => `EXERCISE:${item.exerciseId}`),
  ]).map((reference) => {
    const [kind, id] = reference.split(":", 2);
    return { kind: kind as "FOOD" | "EXERCISE", id };
  });
  const result = await runConstrainedProviderBoundary(
    request,
    {
      languageSourceRefs: sourceRefs.filter((ref) => ref.kind === "CHECK_IN").slice(0, 5),
      eligibleOptions,
      gateInput,
    },
    new SyntheticConstrainedProvider()
  );
  if (result.outcome !== "APPROVE_AUTOMATICALLY" || !result.providerSelection) {
    return {
      outcome: result.outcome,
      reasonCodes: result.orderedReasonCodes,
      nextAction: result.nextAction,
      clarificationId: result.clarificationId ?? null,
    };
  }
  const audit = await db.aiProviderBoundaryAudit.findFirst({
    where: { id: result.auditId, clientId: user.id },
  });
  if (!audit?.finalGateDecisionId || audit.resultOutcome !== "APPROVE_AUTOMATICALLY") {
    throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Finalization could not be verified.", 503);
  }
  const gate = await db.aiAutonomyGateDecision.findFirst({
    where: { id: audit.finalGateDecisionId, clientId: user.id },
  });
  if (
    !gate ||
    gate.outcome !== "APPROVE_AUTOMATICALLY" ||
    gate.approvedPlanVersionId !== candidate.id ||
    gate.candidatePayloadHash !== candidate.payloadHash
  ) {
    throw new AiCoachError(
      "TEMPORARILY_UNAVAILABLE",
      "The deterministic gate did not authorize this proposal.",
      503
    );
  }
  const state = {
    clientId: user.id,
    planVersionId: candidate.id,
    gateDecisionId: gate.id,
    providerBoundaryAuditId: audit.id,
    evaluationKey: gate.evaluationKey,
    candidatePayloadHash: candidate.payloadHash,
    artifactRequest: request,
    artifactRefs: gate.artifactRefs,
    sourceRefs: gate.sourceRefs,
    gateInput,
    providerSelection: result.providerSelection,
  };
  const existing = await db.aiAutomaticPlanApproval.findUnique({
    where: { planVersionId: candidate.id },
  });
  const stateDigest = contentHash(state);
  if (existing) {
    if (existing.stateDigest !== stateDigest) {
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "The proposal was finalized against different state.",
        409
      );
    }
    return {
      outcome: result.outcome,
      approvalId: existing.id,
      reasonCodes: result.orderedReasonCodes,
    };
  }
  const approval = await db.aiAutomaticPlanApproval.create({
    data: {
      ...state,
      artifactRequest: json(request),
      artifactRefs: json(gate.artifactRefs),
      sourceRefs: json(gate.sourceRefs),
      gateInput: json(gateInput),
      providerSelection: json(result.providerSelection),
      stateDigest,
    },
  });
  return {
    outcome: result.outcome,
    approvalId: approval.id,
    reasonCodes: result.orderedReasonCodes,
  };
}
