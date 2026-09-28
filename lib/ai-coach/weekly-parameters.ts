import { contentHash } from "./canonical-json";
import type { PolicyBundleContent } from "./artifacts/schema";
import { resolveNutritionSafetyPolicy } from "./nutrition-safety";
import { ROUNDING_MACRO_GRAMS_DECIMALS_ID } from "./prescription/parameters";
import { RULE_BOUNDED_TRAINING_ID } from "./training/parameters";
import { z } from "zod";

export type WeeklyReasonCode =
  | "WEEKLY_PARAMETER_MISSING"
  | "WEEKLY_PARAMETER_INCOMPATIBLE"
  | "WEEKLY_METHOD_UNSUPPORTED"
  | "WEEKLY_RULE_NOT_PERMITTED_FOR_LIVE_BUNDLE"
  | "WEEKLY_ARTIFACT_UNAVAILABLE";

export const WEEKLY_EVIDENCE_RULE_ID = "WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1";
export const WEEKLY_COOLDOWN_RULE_ID = "WEEKLY.RULE.COOLDOWN.V1";
export const WEEKLY_CUMULATIVE_RULE_ID = "WEEKLY.RULE.CUMULATIVE_LIMIT.V1";
export const WEEKLY_RELATIVE_STEP_RULE_ID = "WEEKLY.ADJUSTMENT.ENERGY.RELATIVE_STEP.V1";
export const WEEKLY_REESTIMATE_RULE_ID =
  "WEEKLY.ADJUSTMENT.ENERGY.REESTIMATE_FROM_CURRENT_WEIGHT.V1";
export const WEEKLY_RECOMPOSE_RULE_ID = "WEEKLY.RULE.SIMPLIFY_BY_RECOMPOSITION.V1";
export const WEEKLY_DROP_SESSION_RULE_ID = "WEEKLY.RULE.SIMPLIFY_BY_SESSION_DROP.V1";

export const WEEKLY_RULE_IDS = [
  WEEKLY_EVIDENCE_RULE_ID,
  WEEKLY_COOLDOWN_RULE_ID,
  WEEKLY_CUMULATIVE_RULE_ID,
  WEEKLY_RELATIVE_STEP_RULE_ID,
  WEEKLY_REESTIMATE_RULE_ID,
  WEEKLY_RECOMPOSE_RULE_ID,
  WEEKLY_DROP_SESSION_RULE_ID,
  RULE_BOUNDED_TRAINING_ID,
] as const;

type ParameterSpec = { id: string; unit: string; ruleId: string };

export const WEEKLY_PARAMETER_SPECS: readonly ParameterSpec[] = [
  { id: "WEEKLY.EVIDENCE.MIN_CONSECUTIVE_WEEKS", unit: "WEEKS", ruleId: WEEKLY_EVIDENCE_RULE_ID },
  { id: "WEEKLY.EVIDENCE.MAX_MISSING_WEEKS", unit: "WEEKS", ruleId: WEEKLY_EVIDENCE_RULE_ID },
  {
    id: "WEEKLY.EVIDENCE.MIN_COMPLETE_CHECK_INS_PER_WEEK",
    unit: "CHECK_INS_PER_WEEK",
    ruleId: WEEKLY_EVIDENCE_RULE_ID,
  },
  {
    id: "WEEKLY.EVIDENCE.MIN_PLAN_FOLLOWING_DAYS",
    unit: "DAYS_PER_WEEK",
    ruleId: WEEKLY_EVIDENCE_RULE_ID,
  },
  {
    id: "WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_PER_WEEK",
    unit: "OBSERVATIONS_PER_WEEK",
    ruleId: WEEKLY_EVIDENCE_RULE_ID,
  },
  {
    id: "WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_TOTAL",
    unit: "OBSERVATIONS",
    ruleId: WEEKLY_EVIDENCE_RULE_ID,
  },
  {
    id: "WEEKLY.EVIDENCE.MAX_COMPARABLE_SPREAD_FRACTION",
    unit: "FRACTION_OF_MEDIAN_BODY_WEIGHT",
    ruleId: WEEKLY_EVIDENCE_RULE_ID,
  },
  {
    id: "WEEKLY.EVIDENCE.PLATEAU_MAX_RELATIVE_CHANGE",
    unit: "FRACTION_OF_BODY_WEIGHT",
    ruleId: WEEKLY_EVIDENCE_RULE_ID,
  },
  {
    id: "WEEKLY.ADJUSTMENT.ENERGY.STEP_FRACTION",
    unit: "FRACTION_OF_CURRENT_ENERGY",
    ruleId: WEEKLY_RELATIVE_STEP_RULE_ID,
  },
  {
    id: "WEEKLY.ADJUSTMENT.ENERGY.STEP_TOLERANCE_KCAL",
    unit: "KCAL_PER_DAY",
    ruleId: WEEKLY_RELATIVE_STEP_RULE_ID,
  },
  {
    id: "WEEKLY.COOLDOWN.MIN_DAYS_BETWEEN_MATERIAL_CHANGES",
    unit: "DAYS",
    ruleId: WEEKLY_COOLDOWN_RULE_ID,
  },
  { id: "WEEKLY.CUMULATIVE.WINDOW_DAYS", unit: "DAYS", ruleId: WEEKLY_CUMULATIVE_RULE_ID },
  {
    id: "WEEKLY.CUMULATIVE.MAX_MATERIAL_CHANGES_PER_WINDOW",
    unit: "CHANGES_PER_WINDOW",
    ruleId: WEEKLY_CUMULATIVE_RULE_ID,
  },
  {
    id: "WEEKLY.CUMULATIVE.ENERGY.MAX_REDUCTION_FRACTION",
    unit: "FRACTION_OF_BASELINE_ENERGY",
    ruleId: WEEKLY_CUMULATIVE_RULE_ID,
  },
  {
    id: "WEEKLY.CUMULATIVE.MAX_CHANGED_DOMAINS_PER_REVIEW",
    unit: "DOMAINS_PER_REVIEW",
    ruleId: WEEKLY_CUMULATIVE_RULE_ID,
  },
  {
    id: "WEEKLY.SIMPLIFY.TRAINING_DAYS.DECREMENT",
    unit: "SESSIONS_PER_WEEK",
    ruleId: WEEKLY_DROP_SESSION_RULE_ID,
  },
  {
    id: "WEEKLY.SIMPLIFY.CARDIO.MINUTES.DECREMENT",
    unit: "MINUTES_PER_SESSION",
    ruleId: WEEKLY_DROP_SESSION_RULE_ID,
  },
  {
    id: "WEEKLY.SIMPLIFY.CARDIO.MINUTES.FLOOR",
    unit: "MINUTES_PER_SESSION",
    ruleId: WEEKLY_DROP_SESSION_RULE_ID,
  },
];

export const WEEKLY_PARAMETER_IDS = WEEKLY_PARAMETER_SPECS.map((spec) => spec.id);

export const WEEKLY_CONSUMED_PROGRESSION_PARAMETER_SPECS: readonly ParameterSpec[] = [
  {
    id: "PROGRESSION.STRENGTH.REPS.INCREMENT",
    unit: "REPETITIONS",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL",
    unit: "REPETITIONS",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  { id: "PROGRESSION.STRENGTH.SETS.INCREMENT", unit: "SETS", ruleId: RULE_BOUNDED_TRAINING_ID },
  {
    id: "PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL",
    unit: "SETS",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.CARDIO.MINUTES.INCREMENT",
    unit: "MINUTES_PER_SESSION",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.CARDIO.MINUTES.MAX_ABOVE_INITIAL",
    unit: "MINUTES_PER_SESSION",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS",
    unit: "WEEKS",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION",
    unit: "FRACTION_OF_PRESCRIBED_SETS",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.EVIDENCE.MAX_EFFORT_RATING",
    unit: "RPE_POINTS",
    ruleId: RULE_BOUNDED_TRAINING_ID,
  },
  {
    id: "PROGRESSION.WINDOW.MIN_DAYS_BETWEEN_INCREASES",
    unit: "DAYS",
    ruleId: WEEKLY_COOLDOWN_RULE_ID,
  },
];

export const WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS =
  WEEKLY_CONSUMED_PROGRESSION_PARAMETER_SPECS.map((spec) => spec.id);

export const resolvedWeeklyParametersSchema = z
  .object({
    evidence: z
      .object({
        minConsecutiveWeeks: z.number().int().positive(),
        maxMissingWeeks: z.number().int().nonnegative(),
        minCompleteCheckInsPerWeek: z.number().int().positive(),
        minPlanFollowingDays: z.number().int().min(0).max(7),
        minComparableWeighInsPerWeek: z.number().int().nonnegative(),
        minComparableWeighInsTotal: z.number().int().nonnegative(),
        maxComparableSpreadFraction: z.number().finite().nonnegative(),
        plateauMaxRelativeChange: z.number().finite().nonnegative(),
      })
      .strict(),
    adjustment: z
      .object({
        energyMethod: z.enum(["RELATIVE_STEP", "REESTIMATE_FROM_CURRENT_WEIGHT"]),
        energyStepFraction: z.number().finite().nonnegative(),
        energyStepToleranceKcal: z.number().finite().nonnegative(),
        macroGramDecimals: z.number().int().min(0).max(6),
      })
      .strict(),
    cooldown: z
      .object({ minDaysBetweenMaterialChanges: z.number().finite().nonnegative() })
      .strict(),
    cumulative: z
      .object({
        windowDays: z.number().finite().positive(),
        maxMaterialChangesPerWindow: z.number().int().positive(),
        maxEnergyReductionFraction: z.number().finite().nonnegative(),
        maxChangedDomainsPerReview: z.number().int().positive(),
      })
      .strict(),
    simplify: z
      .object({
        method: z.enum(["RECOMPOSE_AT_FEWER_DAYS", "DROP_LAST_SESSION"]),
        trainingDaysDecrement: z.number().int().positive(),
        cardioMinutesDecrement: z.number().finite().nonnegative(),
        cardioMinutesFloor: z.number().finite().nonnegative(),
      })
      .strict(),
    progression: z
      .object({
        repsIncrement: z.number().int().nonnegative(),
        repsMaxAboveInitial: z.number().int().nonnegative(),
        setsIncrement: z.number().int().nonnegative(),
        setsMaxAboveInitial: z.number().int().nonnegative(),
        cardioMinutesIncrement: z.number().finite().nonnegative(),
        cardioMinutesMaxAboveInitial: z.number().finite().nonnegative(),
        minCompleteSessionWeeks: z.number().int().positive(),
        minCompleteSetsFraction: z.number().finite().min(0).max(1),
        maxEffortRating: z.number().finite().nonnegative(),
        minDaysBetweenIncreases: z.number().finite().nonnegative(),
      })
      .strict(),
    floors: z
      .object({
        minimumDailyEnergyKcal: z.number().finite().positive(),
        maximumWeeklyLossRatePercent: z.number().finite().positive(),
      })
      .strict(),
    ruleIds: z
      .object({
        evidence: z.string(),
        cooldown: z.string(),
        cumulative: z.string(),
        adjustment: z.string(),
        simplify: z.string(),
        progression: z.string(),
      })
      .strict(),
  })
  .strict();

export type ResolvedWeeklyParameters = z.infer<typeof resolvedWeeklyParametersSchema>;

type ResolveResult =
  | { ok: true; parameters: ResolvedWeeklyParameters; parameterSetDigest: string }
  | { ok: false; reasonCodes: WeeklyReasonCode[]; missingParameterIds: string[] };

function parameterValueIsCompatible(id: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const positiveIntegers = new Set([
    "WEEKLY.EVIDENCE.MIN_CONSECUTIVE_WEEKS",
    "WEEKLY.EVIDENCE.MIN_COMPLETE_CHECK_INS_PER_WEEK",
    "WEEKLY.CUMULATIVE.MAX_MATERIAL_CHANGES_PER_WINDOW",
    "WEEKLY.CUMULATIVE.MAX_CHANGED_DOMAINS_PER_REVIEW",
    "WEEKLY.SIMPLIFY.TRAINING_DAYS.DECREMENT",
    "PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS",
  ]);
  const nonnegativeIntegers = new Set([
    "WEEKLY.EVIDENCE.MAX_MISSING_WEEKS",
    "WEEKLY.EVIDENCE.MIN_PLAN_FOLLOWING_DAYS",
    "WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_PER_WEEK",
    "WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_TOTAL",
    "PROGRESSION.STRENGTH.REPS.INCREMENT",
    "PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL",
    "PROGRESSION.STRENGTH.SETS.INCREMENT",
    "PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL",
    ROUNDING_MACRO_GRAMS_DECIMALS_ID,
  ]);
  if (positiveIntegers.has(id)) return Number.isInteger(value) && value > 0;
  if (nonnegativeIntegers.has(id)) {
    if (!Number.isInteger(value) || value < 0) return false;
    if (id === "WEEKLY.EVIDENCE.MIN_PLAN_FOLLOWING_DAYS") return value <= 7;
    if (id === ROUNDING_MACRO_GRAMS_DECIMALS_ID) return value <= 6;
    return true;
  }
  if (id === "WEEKLY.CUMULATIVE.WINDOW_DAYS") return value > 0;
  if (id === "PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION")
    return value >= 0 && value <= 1;
  return value >= 0;
}

export function resolveWeeklyParameters(
  policy: PolicyBundleContent,
  artifact: { synthetic: boolean }
): ResolveResult {
  const has = (
    id: string,
    field: keyof Pick<
      PolicyBundleContent,
      | "ruleIds"
      | "adjustmentRuleIds"
      | "cooldownRuleIds"
      | "cumulativeLimitRuleIds"
      | "evidenceRuleIds"
    >
  ) => policy.ruleIds.includes(id) && policy[field].includes(id);
  const baseRules =
    has(WEEKLY_EVIDENCE_RULE_ID, "evidenceRuleIds") &&
    has(WEEKLY_COOLDOWN_RULE_ID, "cooldownRuleIds") &&
    has(WEEKLY_CUMULATIVE_RULE_ID, "cumulativeLimitRuleIds") &&
    has(RULE_BOUNDED_TRAINING_ID, "adjustmentRuleIds");
  const adjustmentRules = [WEEKLY_RELATIVE_STEP_RULE_ID, WEEKLY_REESTIMATE_RULE_ID].filter((id) =>
    has(id, "adjustmentRuleIds")
  );
  const simplifyRules = [WEEKLY_RECOMPOSE_RULE_ID, WEEKLY_DROP_SESSION_RULE_ID].filter((id) =>
    has(id, "adjustmentRuleIds")
  );
  if (!baseRules || adjustmentRules.length !== 1 || simplifyRules.length !== 1) {
    return { ok: false, reasonCodes: ["WEEKLY_METHOD_UNSUPPORTED"], missingParameterIds: [] };
  }
  if (simplifyRules[0] === WEEKLY_DROP_SESSION_RULE_ID && !artifact.synthetic) {
    return {
      ok: false,
      reasonCodes: ["WEEKLY_RULE_NOT_PERMITTED_FOR_LIVE_BUNDLE"],
      missingParameterIds: [],
    };
  }

  const byId = new Map(policy.numericParameters.map((parameter) => [parameter.id, parameter]));
  const selectedAdjustmentRule = adjustmentRules[0];
  const selectedSimplifyRule = simplifyRules[0];
  const allSpecs: ParameterSpec[] = [
    ...WEEKLY_PARAMETER_SPECS.map((spec) => ({
      ...spec,
      ruleId: spec.id.startsWith("WEEKLY.ADJUSTMENT.")
        ? selectedAdjustmentRule
        : spec.id.startsWith("WEEKLY.SIMPLIFY.")
          ? selectedSimplifyRule
          : spec.ruleId,
    })),
    ...WEEKLY_CONSUMED_PROGRESSION_PARAMETER_SPECS,
    {
      id: ROUNDING_MACRO_GRAMS_DECIMALS_ID,
      unit: "DECIMAL_PLACES",
      ruleId: "PRESCRIPTION.ROUNDING.ORDER.V1",
    },
  ];
  const missing: string[] = [];
  const incompatible: string[] = [];
  for (const spec of allSpecs) {
    const parameter = byId.get(spec.id);
    if (!parameter) missing.push(spec.id);
    else if (
      parameter.unit !== spec.unit ||
      !parameterValueIsCompatible(spec.id, parameter.value) ||
      !parameter.applicabilityRuleIds.includes(spec.ruleId)
    )
      incompatible.push(spec.id);
  }
  if (missing.length || incompatible.length) {
    return {
      ok: false,
      reasonCodes: [
        ...(missing.length ? (["WEEKLY_PARAMETER_MISSING"] as const) : []),
        ...(incompatible.length ? (["WEEKLY_PARAMETER_INCOMPATIBLE"] as const) : []),
      ],
      missingParameterIds: [...new Set([...missing, ...incompatible])].sort(),
    };
  }
  let floors;
  try {
    const safetyPolicy = resolveNutritionSafetyPolicy(policy);
    if (safetyPolicy.resolutionStatus !== "RESOLVED") {
      return {
        ok: false,
        reasonCodes: ["WEEKLY_PARAMETER_MISSING"],
        missingParameterIds: safetyPolicy.pendingParameterIds,
      };
    }
    floors = safetyPolicy.nutritionLimits;
  } catch {
    return { ok: false, reasonCodes: ["WEEKLY_PARAMETER_INCOMPATIBLE"], missingParameterIds: [] };
  }
  const value = (id: string) => byId.get(id)!.value;
  const parsed = resolvedWeeklyParametersSchema.safeParse({
    evidence: {
      minConsecutiveWeeks: value("WEEKLY.EVIDENCE.MIN_CONSECUTIVE_WEEKS"),
      maxMissingWeeks: value("WEEKLY.EVIDENCE.MAX_MISSING_WEEKS"),
      minCompleteCheckInsPerWeek: value("WEEKLY.EVIDENCE.MIN_COMPLETE_CHECK_INS_PER_WEEK"),
      minPlanFollowingDays: value("WEEKLY.EVIDENCE.MIN_PLAN_FOLLOWING_DAYS"),
      minComparableWeighInsPerWeek: value("WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_PER_WEEK"),
      minComparableWeighInsTotal: value("WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_TOTAL"),
      maxComparableSpreadFraction: value("WEEKLY.EVIDENCE.MAX_COMPARABLE_SPREAD_FRACTION"),
      plateauMaxRelativeChange: value("WEEKLY.EVIDENCE.PLATEAU_MAX_RELATIVE_CHANGE"),
    },
    adjustment: {
      energyMethod:
        selectedAdjustmentRule === WEEKLY_RELATIVE_STEP_RULE_ID
          ? "RELATIVE_STEP"
          : "REESTIMATE_FROM_CURRENT_WEIGHT",
      energyStepFraction: value("WEEKLY.ADJUSTMENT.ENERGY.STEP_FRACTION"),
      energyStepToleranceKcal: value("WEEKLY.ADJUSTMENT.ENERGY.STEP_TOLERANCE_KCAL"),
      macroGramDecimals: value(ROUNDING_MACRO_GRAMS_DECIMALS_ID),
    },
    cooldown: {
      minDaysBetweenMaterialChanges: value("WEEKLY.COOLDOWN.MIN_DAYS_BETWEEN_MATERIAL_CHANGES"),
    },
    cumulative: {
      windowDays: value("WEEKLY.CUMULATIVE.WINDOW_DAYS"),
      maxMaterialChangesPerWindow: value("WEEKLY.CUMULATIVE.MAX_MATERIAL_CHANGES_PER_WINDOW"),
      maxEnergyReductionFraction: value("WEEKLY.CUMULATIVE.ENERGY.MAX_REDUCTION_FRACTION"),
      maxChangedDomainsPerReview: value("WEEKLY.CUMULATIVE.MAX_CHANGED_DOMAINS_PER_REVIEW"),
    },
    simplify: {
      method:
        selectedSimplifyRule === WEEKLY_DROP_SESSION_RULE_ID
          ? "DROP_LAST_SESSION"
          : "RECOMPOSE_AT_FEWER_DAYS",
      trainingDaysDecrement: value("WEEKLY.SIMPLIFY.TRAINING_DAYS.DECREMENT"),
      cardioMinutesDecrement: value("WEEKLY.SIMPLIFY.CARDIO.MINUTES.DECREMENT"),
      cardioMinutesFloor: value("WEEKLY.SIMPLIFY.CARDIO.MINUTES.FLOOR"),
    },
    progression: {
      repsIncrement: value("PROGRESSION.STRENGTH.REPS.INCREMENT"),
      repsMaxAboveInitial: value("PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL"),
      setsIncrement: value("PROGRESSION.STRENGTH.SETS.INCREMENT"),
      setsMaxAboveInitial: value("PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL"),
      cardioMinutesIncrement: value("PROGRESSION.CARDIO.MINUTES.INCREMENT"),
      cardioMinutesMaxAboveInitial: value("PROGRESSION.CARDIO.MINUTES.MAX_ABOVE_INITIAL"),
      minCompleteSessionWeeks: value("PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS"),
      minCompleteSetsFraction: value("PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION"),
      maxEffortRating: value("PROGRESSION.EVIDENCE.MAX_EFFORT_RATING"),
      minDaysBetweenIncreases: value("PROGRESSION.WINDOW.MIN_DAYS_BETWEEN_INCREASES"),
    },
    floors: {
      minimumDailyEnergyKcal: floors.minimumDailyEnergyKcal,
      maximumWeeklyLossRatePercent: floors.maximumWeeklyLossRatePercent,
    },
    ruleIds: {
      evidence: WEEKLY_EVIDENCE_RULE_ID,
      cooldown: WEEKLY_COOLDOWN_RULE_ID,
      cumulative: WEEKLY_CUMULATIVE_RULE_ID,
      adjustment: selectedAdjustmentRule,
      simplify: selectedSimplifyRule,
      progression: RULE_BOUNDED_TRAINING_ID,
    },
  });
  if (!parsed.success) {
    return {
      ok: false,
      reasonCodes: ["WEEKLY_PARAMETER_INCOMPATIBLE"],
      missingParameterIds: [],
    };
  }
  const parameters = parsed.data;
  return { ok: true, parameters, parameterSetDigest: contentHash(parameters) };
}
