import type { Prisma } from "@/app/generated/prisma/client";
import { z } from "zod";
import { contentHash } from "./canonical-json";
import { planPayloadSchema } from "./plan-contract";
import {
  ArtifactLoadError,
  getReviewedPolicyBundleContent,
  type ArtifactLoadRequest,
  withReviewedArtifactSetForCurrentClient,
} from "./artifacts/repository";
import { policyBundleContentSchema, type PolicyBundleContent } from "./artifacts/schema";

/**
 * T-1003 deterministic gate. Provenance must identify either the locked
 * synthetic fixture or server-validated current-client state; caller/model
 * provenance is never accepted.
 */
const provenanceSchema = z.enum([
  "SYNTHETIC_SERVER_FIXTURE",
  "SERVER_VALIDATED_CLIENT_STATE",
]);
const contraindicationStatusSchema = z.enum(["CLEAR", "EXCLUDED", "UNKNOWN"]);

export const nutritionSafetyEvaluationInputSchema = z
  .object({
    screening: z
      .object({
        instrumentId: z.string().min(1).max(160),
        result: z.enum(["CLEAR", "FLAGGED", "UNKNOWN"]),
        provenance: provenanceSchema,
      })
      .strict(),
    contraindications: z
      .object({
        AGE_ELIGIBILITY: contraindicationStatusSchema,
        PREGNANCY_POSTPARTUM: contraindicationStatusSchema,
        EATING_DISORDER_HISTORY_OR_CONCERN: contraindicationStatusSchema,
        TYPE_1_DIABETES: contraindicationStatusSchema,
        CARDIAC_CONDITION: contraindicationStatusSchema,
      })
      .strict(),
    proposal: z
      .object({
        proposedDailyEnergyKcal: z.number().positive().finite(),
        currentWeightKg: z.number().positive().finite().nullable(),
        projectedWeeklyWeightChangeKg: z.number().finite().nullable(),
        provenance: provenanceSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export type NutritionSafetyEvaluationInput = z.infer<typeof nutritionSafetyEvaluationInputSchema>;

export type NutritionSafetyPolicy = {
  screening: PolicyBundleContent["safetyControls"]["screening"];
  contraindications: PolicyBundleContent["safetyControls"]["contraindications"];
  nutritionLimits: PolicyBundleContent["safetyControls"]["nutritionLimits"] & {
    minimumDailyEnergyKcal: number;
    maximumWeeklyLossRatePercent: number;
  };
};

export type NutritionSafetyHistory = {
  currentDailyEnergyKcal: number | null;
  lastMaterialEnergyDirection: "REDUCTION" | "NON_REDUCTION" | "NONE" | "UNVERIFIABLE";
  sourcePlanVersionIds: string[];
};

export type NutritionSafetyDecision = {
  outcome: "PASS" | "HOLD" | "PAUSE_REFER";
  reasonCodes: string[];
  ruleIds: string[];
  escalationTemplateIds: string[];
};

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function decision(
  outcome: NutritionSafetyDecision["outcome"],
  reasonCodes: string[],
  ruleIds: string[],
  escalationTemplateIds: string[] = []
): NutritionSafetyDecision {
  return {
    outcome,
    reasonCodes: unique(reasonCodes),
    ruleIds: unique(ruleIds),
    escalationTemplateIds: unique(escalationTemplateIds),
  };
}

/** Resolves numeric hooks only from a strict reviewed-policy shape. */
export function resolveNutritionSafetyPolicy(raw: unknown): NutritionSafetyPolicy {
  const policy = policyBundleContentSchema.parse(raw);
  const controls = policy.safetyControls;
  const minimum = policy.numericParameters.find(
    (parameter) => parameter.id === controls.nutritionLimits.minimumDailyEnergyParameterId
  );
  const maximumRate = policy.numericParameters.find(
    (parameter) => parameter.id === controls.nutritionLimits.maximumWeeklyLossRateParameterId
  );
  if (
    !minimum ||
    minimum.unit !== "KCAL_PER_DAY" ||
    minimum.value <= 0 ||
    !minimum.applicabilityRuleIds.includes(controls.nutritionLimits.minimumDailyEnergyRuleId)
  ) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The reviewed minimum daily energy hook is missing or incompatible."
    );
  }
  if (
    !maximumRate ||
    maximumRate.unit !== "PERCENT_BODY_WEIGHT_PER_WEEK" ||
    maximumRate.value <= 0 ||
    !maximumRate.applicabilityRuleIds.includes(controls.nutritionLimits.maximumWeeklyLossRateRuleId)
  ) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The reviewed weekly loss-rate hook is missing or incompatible."
    );
  }
  return {
    screening: controls.screening,
    contraindications: controls.contraindications,
    nutritionLimits: {
      ...controls.nutritionLimits,
      minimumDailyEnergyKcal: minimum.value,
      maximumWeeklyLossRatePercent: maximumRate.value,
    },
  };
}

/**
 * Pure deterministic decision function. Extra JavaScript properties have no
 * authority; the server entry point below additionally rejects them strictly.
 */
export function evaluateNutritionSafety(
  policy: NutritionSafetyPolicy,
  input: NutritionSafetyEvaluationInput,
  history: NutritionSafetyHistory
): NutritionSafetyDecision {
  const pauseReasons: string[] = [];
  const pauseRules: string[] = [];
  const escalationTemplateIds: string[] = [];

  if (
    input.screening.instrumentId !== policy.screening.instrumentId ||
    input.screening.result === "UNKNOWN"
  ) {
    pauseReasons.push(policy.screening.unknownReasonCode);
    pauseRules.push(policy.screening.ruleId);
    escalationTemplateIds.push(policy.screening.escalationTemplateId);
  } else if (input.screening.result === "FLAGGED") {
    pauseReasons.push(policy.screening.flaggedReasonCode);
    pauseRules.push(policy.screening.ruleId);
    escalationTemplateIds.push(policy.screening.escalationTemplateId);
  }

  for (const binding of policy.contraindications) {
    const status = input.contraindications[binding.inputId];
    if (status !== "CLEAR") {
      pauseReasons.push(binding.reasonCode);
      pauseRules.push(binding.ruleId);
      escalationTemplateIds.push(binding.escalationTemplateId);
    }
  }
  if (pauseReasons.length > 0) {
    return decision("PAUSE_REFER", pauseReasons, pauseRules, escalationTemplateIds);
  }

  if (!input.proposal) return decision("PASS", [], []);

  const limits = policy.nutritionLimits;
  if (history.lastMaterialEnergyDirection === "UNVERIFIABLE") {
    return decision(
      "HOLD",
      [limits.unverifiableHistoryReasonCode],
      [limits.noConsecutiveDeficitRuleId]
    );
  }

  const holdReasons: string[] = [];
  const holdRules: string[] = [];
  if (input.proposal.proposedDailyEnergyKcal < limits.minimumDailyEnergyKcal) {
    holdReasons.push(limits.minimumDailyEnergyReasonCode);
    holdRules.push(limits.minimumDailyEnergyRuleId);
  }

  const { currentWeightKg, projectedWeeklyWeightChangeKg } = input.proposal;
  if (currentWeightKg === null || projectedWeeklyWeightChangeKg === null) {
    holdReasons.push(limits.missingRateInputReasonCode);
    holdRules.push(limits.maximumWeeklyLossRateRuleId);
  } else {
    const projectedWeeklyLossRatePercent =
      (Math.max(0, -projectedWeeklyWeightChangeKg) / currentWeightKg) * 100;
    if (projectedWeeklyLossRatePercent > limits.maximumWeeklyLossRatePercent) {
      holdReasons.push(limits.maximumWeeklyLossRateReasonCode);
      holdRules.push(limits.maximumWeeklyLossRateRuleId);
    }
  }

  if (
    history.currentDailyEnergyKcal !== null &&
    input.proposal.proposedDailyEnergyKcal < history.currentDailyEnergyKcal &&
    history.lastMaterialEnergyDirection === "REDUCTION"
  ) {
    holdReasons.push(limits.noConsecutiveDeficitReasonCode);
    holdRules.push(limits.noConsecutiveDeficitRuleId);
  }

  return holdReasons.length > 0
    ? decision("HOLD", holdReasons, holdRules)
    : decision("PASS", [], []);
}

async function readNutritionHistory(
  tx: Prisma.TransactionClient,
  clientId: string
): Promise<NutritionSafetyHistory> {
  const rows = await tx.aiPlanVersion.findMany({
    where: { clientId, acceptedAt: { not: null } },
    orderBy: [{ acceptedAt: "asc" }, { version: "asc" }],
    take: 501,
    select: { id: true, payload: true },
  });
  const sourcePlanVersionIds = rows.map((row) => row.id);
  if (rows.length > 500) {
    return {
      currentDailyEnergyKcal: null,
      lastMaterialEnergyDirection: "UNVERIFIABLE",
      sourcePlanVersionIds,
    };
  }

  let currentDailyEnergyKcal: number | null = null;
  let lastMaterialEnergyDirection: NutritionSafetyHistory["lastMaterialEnergyDirection"] = "NONE";
  for (const row of rows) {
    const parsed = planPayloadSchema.safeParse(row.payload);
    if (!parsed.success) {
      return {
        currentDailyEnergyKcal: null,
        lastMaterialEnergyDirection: "UNVERIFIABLE",
        sourcePlanVersionIds,
      };
    }
    const next = parsed.data.nutrition?.targets.energyKcal ?? null;
    if (next === null) continue;
    if (currentDailyEnergyKcal !== null && next !== currentDailyEnergyKcal) {
      lastMaterialEnergyDirection = next < currentDailyEnergyKcal ? "REDUCTION" : "NON_REDUCTION";
    }
    currentDailyEnergyKcal = next;
  }
  return { currentDailyEnergyKcal, lastMaterialEnergyDirection, sourcePlanVersionIds };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Server-only authenticated entry point. `artifactRequest` is deployment
 * configuration, never request payload. Account identity and synthetic/live
 * classification are resolved and locked inside the T-1005 repository.
 */
export async function evaluateCurrentClientNutritionSafety(
  artifactRequest: ArtifactLoadRequest,
  rawInput: unknown
) {
  const input = nutritionSafetyEvaluationInputSchema.parse(rawInput);
  return withReviewedArtifactSetForCurrentClient(
    artifactRequest,
    async ({ tx, clientId, artifacts }) => {
      const policyContent = getReviewedPolicyBundleContent(artifacts.policy);
      const policy = resolveNutritionSafetyPolicy(policyContent);
      const history = await readNutritionHistory(tx, clientId);
      const result = evaluateNutritionSafety(policy, input, history);
      const inputDigest = contentHash(input);
      const evaluationKey = contentHash({
        clientId,
        policyArtifactId: artifacts.policy.id,
        policyArtifactDigest: artifacts.policy.contentDigest,
        inputDigest,
        sourcePlanVersionIds: history.sourcePlanVersionIds,
      });
      const row = await tx.aiNutritionSafetyDecision.create({
        data: {
          clientId,
          evaluationKey,
          policyArtifactId: artifacts.policy.id,
          policyArtifactVersion: artifacts.policy.version,
          policyArtifactDigest: artifacts.policy.contentDigest,
          outcome: result.outcome,
          reasonCodes: result.reasonCodes,
          ruleIds: result.ruleIds,
          escalationTemplateIds: result.escalationTemplateIds,
          inputSnapshot: json(input),
          inputDigest,
          sourcePlanVersionIds: history.sourcePlanVersionIds,
        },
      });
      return { decisionId: row.id, ...result };
    }
  );
}
