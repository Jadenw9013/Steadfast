import type { PolicyBundleContent } from "@/lib/ai-coach/artifacts/schema";
import {
  PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  PRESCRIPTION_MACRO_COMPOSITION_ID,
  PRESCRIPTION_METHOD_STRUCTURE_ID,
  PRESCRIPTION_PARAMETER_SPECS,
  PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
  PRESCRIPTION_ROUNDING_ORDER_ID,
  energyCoefficientParameterId,
  energyDensityParameterId,
  goalAdjustmentParameterId,
  inputRangeParameterId,
  proteinParameterId,
  type PrescriptionSafetyFloors,
} from "@/lib/ai-coach/prescription/parameters";

/**
 * *** SYNTHETIC FIXTURE VALUES — NOT APPROVED GUIDANCE ***
 *
 * T-2032 test-only bundle builder. Every numeric value below is a clearly
 * fake, non-standard placeholder chosen so the vectors in
 * tests/fixtures/ai-coach/prescription-vectors.json are reproducible by
 * hand. The RD signs the real values in a later ticket (T-2034), and these
 * are re-signed when real values land (D03-T01).
 *
 * T-2032 review r1 finding M4: the first version of this file used real
 * published figures (the 0.8 g/kg protein RDA, the 1.6-2.4 g/kg
 * resistance-training range, the 20/35 fat AMDR and 45 carb AMDR floor, the
 * 4/4/9 Atwater factors, and the three most-cited 1200 kcal / 1% / 7700
 * kcal-per-kg figures) under a label claiming they were not transcribed
 * guidance — they were, even though they came from memory rather than a
 * citation, which is exactly what "never from model recall" (T-2003
 * Decisions, GAP-N05's fail-closed line) forbids. Every macro/floor/rate
 * value below is deliberately shifted off the real one it might be mistaken
 * for. The energy coefficients (700, -5, 10, 500, ...) were already
 * genuinely fake and are unchanged.
 */

export const SYNTHETIC_MINIMUM_DAILY_ENERGY_PARAMETER_ID = "SYNTHETIC_PRESCRIPTION_MIN_DAILY_ENERGY";
export const SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_PARAMETER_ID =
  "SYNTHETIC_PRESCRIPTION_MAX_WEEKLY_LOSS_RATE";

export function buildSyntheticSafetyFloors(
  overrides: Partial<PrescriptionSafetyFloors> = {}
): PrescriptionSafetyFloors {
  return {
    minimumDailyEnergyKcal: 1000,
    minimumDailyEnergyParameterId: SYNTHETIC_MINIMUM_DAILY_ENERGY_PARAMETER_ID,
    maximumWeeklyLossRatePercent: 2,
    maximumWeeklyLossRateParameterId: SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_PARAMETER_ID,
    ...overrides,
  };
}

export function buildSyntheticExplanationTexts(): readonly string[] {
  return [
    "SYNTHETIC FIXTURE: this plan reflects a reviewed placeholder, not real guidance.",
    "SYNTHETIC FIXTURE: adjust with your coach before acting on these numbers.",
  ];
}

/** Per-population base coefficients; only `activityCoefficient` varies by activity. */
const ENERGY_BASE = {
  MALE_ADULT: { intercept: 700, ageCoefficient: -5, weightCoefficient: 10, heightCoefficient: 500 },
  FEMALE_ADULT: { intercept: 600, ageCoefficient: -5, weightCoefficient: 9, heightCoefficient: 450 },
} as const;
const ACTIVITY_MULTIPLIER: Record<"INACTIVE" | "LOW_ACTIVE" | "ACTIVE" | "VERY_ACTIVE", number> = {
  INACTIVE: 1,
  LOW_ACTIVE: 1.1,
  ACTIVE: 1.2,
  VERY_ACTIVE: 1.3,
};

const PROTEIN_BASE: Record<"NONE" | "OCCASIONAL" | "REGULAR", { min: number; target: number; max: number }> = {
  NONE: { min: 0.5, target: 1, max: 1.5 },
  OCCASIONAL: { min: 1, target: 1.5, max: 2 },
  REGULAR: { min: 1.5, target: 2.5, max: 3.5 },
};

function numericParameter(id: string, value: number, unit: string, applicabilityRuleIds: string[]) {
  return {
    id,
    value,
    unit,
    applicabilityRuleIds,
    evidenceClaimIds: ["SYNTHETIC_EVIDENCE_CLAIM"],
  };
}

/** Builds the exact value + applicabilityRuleIds a real bundle would carry for `spec`. */
function valueForSpec(id: string): number {
  for (const population of ["MALE_ADULT", "FEMALE_ADULT"] as const) {
    for (const activity of ["INACTIVE", "LOW_ACTIVE", "ACTIVE", "VERY_ACTIVE"] as const) {
      const base = ENERGY_BASE[population];
      if (id === energyCoefficientParameterId(population, activity, "INTERCEPT")) return base.intercept;
      if (id === energyCoefficientParameterId(population, activity, "AGE_COEFFICIENT"))
        return base.ageCoefficient;
      if (id === energyCoefficientParameterId(population, activity, "WEIGHT_COEFFICIENT"))
        return base.weightCoefficient;
      if (id === energyCoefficientParameterId(population, activity, "HEIGHT_COEFFICIENT"))
        return base.heightCoefficient;
      if (id === energyCoefficientParameterId(population, activity, "ACTIVITY_COEFFICIENT"))
        return ACTIVITY_MULTIPLIER[activity];
    }
  }
  if (id === inputRangeParameterId("AGE_YEARS", "MIN")) return 18;
  if (id === inputRangeParameterId("AGE_YEARS", "MAX")) return 79;
  if (id === inputRangeParameterId("HEIGHT_CM", "MIN")) return 140;
  if (id === inputRangeParameterId("HEIGHT_CM", "MAX")) return 220;
  if (id === inputRangeParameterId("WEIGHT_KG", "MIN")) return 40;
  if (id === inputRangeParameterId("WEIGHT_KG", "MAX")) return 200;
  if (id === "ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS") return 14;
  if (id === "ENERGY.BODY_MASS.ENERGY_PER_KG") return 5000;
  if (id === goalAdjustmentParameterId("LOSE", "GRADUAL")) return -0.1;
  if (id === goalAdjustmentParameterId("LOSE", "MODERATE")) return -0.2;
  if (id === goalAdjustmentParameterId("GAIN", "GRADUAL")) return 0.1;
  if (id === goalAdjustmentParameterId("GAIN", "MODERATE")) return 0.2;
  if (id === "GOAL.ADJUSTMENT.MAINTAIN.ANY.ENERGY_DELTA_FRACTION") return 0;
  if (id === "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION") return 0.25;
  if (id === "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION") return 0.25;
  for (const context of ["NONE", "OCCASIONAL", "REGULAR"] as const) {
    const base = PROTEIN_BASE[context];
    if (id === proteinParameterId(context, "MIN")) return base.min;
    if (id === proteinParameterId(context, "TARGET")) return base.target;
    if (id === proteinParameterId(context, "MAX")) return base.max;
  }
  if (id === "MACRO.CARBOHYDRATE.PERCENT_ENERGY.MIN") return 38;
  if (id === "MACRO.CARBOHYDRATE.PERCENT_ENERGY.MAX") return 66;
  if (id === "MACRO.FAT.PERCENT_ENERGY.MIN") return 12;
  if (id === "MACRO.FAT.PERCENT_ENERGY.MAX") return 30;
  if (id === energyDensityParameterId("PROTEIN")) return 5;
  if (id === energyDensityParameterId("CARBOHYDRATE")) return 5;
  if (id === energyDensityParameterId("FAT")) return 10;
  if (id === "ROUNDING.ENERGY_KCAL.STEP") return 10;
  if (id === "ROUNDING.MACRO_GRAMS.DECIMALS") return 0;
  if (id === "ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS") return 2;
  if (id === "COMPOSITION.TOLERANCE_PERCENT") return 10;
  throw new Error(`No synthetic value defined for prescription parameter ${id}`);
}

export type BuildBundleOptions = {
  /** Extra numericParameters entries beyond the 75 (e.g. the T-1003 floors). */
  extraNumericParameters?: PolicyBundleContent["numericParameters"];
};

/** A full, schema-shaped PolicyBundleContent carrying all 75 prescription parameters. */
export function buildSyntheticPrescriptionBundle(
  options: BuildBundleOptions = {}
): PolicyBundleContent {
  const numericParameters = PRESCRIPTION_PARAMETER_SPECS.map((spec) =>
    numericParameter(spec.id, valueForSpec(spec.id), spec.unit, [spec.groupRuleId])
  );

  const floors = buildSyntheticSafetyFloors();
  numericParameters.push(
    numericParameter(floors.minimumDailyEnergyParameterId, floors.minimumDailyEnergyKcal, "KCAL_PER_DAY", [
      "SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE",
    ]),
    numericParameter(
      floors.maximumWeeklyLossRateParameterId,
      floors.maximumWeeklyLossRatePercent,
      "PERCENT_BODY_WEIGHT_PER_WEEK",
      ["SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE"]
    ),
    ...(options.extraNumericParameters ?? [])
  );

  return {
    artifactKey: "synthetic-prescription-policy-bundle",
    version: 1,
    supportedPopulation: "Synthetic test subjects only.",
    supportedGoals: ["SYNTHETIC_GENERAL_FITNESS"],
    requiredInputIds: ["SYNTHETIC_SCREEN_RESULT", "AGE_ELIGIBILITY", "PREGNANCY_POSTPARTUM", "EATING_DISORDER_HISTORY_OR_CONCERN", "TYPE_1_DIABETES", "CARDIAC_CONDITION"],
    ruleIds: [
      PRESCRIPTION_METHOD_STRUCTURE_ID,
      PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
      PRESCRIPTION_ROUNDING_ORDER_ID,
      PRESCRIPTION_MACRO_COMPOSITION_ID,
      PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
      "SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE",
      "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE",
      "SYNTHETIC_NO_CONSECUTIVE_DEFICIT_RULE",
      "SYNTHETIC_INTAKE_SCREEN_RULE",
      "SYNTHETIC_CONTRAINDICATION_RULE",
      "SYNTHETIC_EVIDENCE_RULE",
      "SYNTHETIC_COOLDOWN_RULE",
      "SYNTHETIC_CUMULATIVE_LIMIT_RULE",
    ],
    calculationMethodIds: [
      PRESCRIPTION_METHOD_STRUCTURE_ID,
      PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
      PRESCRIPTION_ROUNDING_ORDER_ID,
      PRESCRIPTION_MACRO_COMPOSITION_ID,
    ],
    adjustmentRuleIds: [PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID],
    cooldownRuleIds: ["SYNTHETIC_COOLDOWN_RULE"],
    cumulativeLimitRuleIds: ["SYNTHETIC_CUMULATIVE_LIMIT_RULE"],
    contraindicationRuleIds: ["SYNTHETIC_CONTRAINDICATION_RULE"],
    evidenceRuleIds: ["SYNTHETIC_EVIDENCE_RULE"],
    escalationTemplateIds: ["synthetic-pause-refer-template"],
    explanationTemplateIds: ["SYNTHETIC_EXPLANATION_TEMPLATE"],
    safetyControls: {
      schemaVersion: 1,
      screening: {
        instrumentId: "SYNTHETIC_SCREENING_INSTRUMENT_NOT_FOR_LIVE_USE",
        resultInputId: "SYNTHETIC_SCREEN_RESULT",
        ruleId: "SYNTHETIC_INTAKE_SCREEN_RULE",
        flaggedReasonCode: "SYNTHETIC_SCREEN_FLAGGED",
        unknownReasonCode: "SYNTHETIC_SCREEN_UNKNOWN",
        escalationTemplateId: "synthetic-pause-refer-template",
      },
      contraindications: (
        [
          "AGE_ELIGIBILITY",
          "PREGNANCY_POSTPARTUM",
          "EATING_DISORDER_HISTORY_OR_CONCERN",
          "TYPE_1_DIABETES",
          "CARDIAC_CONDITION",
        ] as const
      ).map((inputId) => ({
        inputId,
        ruleId: "SYNTHETIC_CONTRAINDICATION_RULE",
        reasonCode: "SYNTHETIC_CONTRAINDICATION",
        escalationTemplateId: "synthetic-pause-refer-template",
      })),
      nutritionLimits: {
        minimumDailyEnergyParameterId: floors.minimumDailyEnergyParameterId,
        maximumWeeklyLossRateParameterId: floors.maximumWeeklyLossRateParameterId,
        minimumDailyEnergyRuleId: "SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE",
        maximumWeeklyLossRateRuleId: "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE",
        noConsecutiveDeficitRuleId: "SYNTHETIC_NO_CONSECUTIVE_DEFICIT_RULE",
        minimumDailyEnergyReasonCode: "SYNTHETIC_MINIMUM_DAILY_ENERGY_LIMIT",
        maximumWeeklyLossRateReasonCode: "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_LIMIT",
        noConsecutiveDeficitReasonCode: "SYNTHETIC_CONSECUTIVE_DEFICIT_BLOCKED",
        missingRateInputReasonCode: "SYNTHETIC_RATE_INPUT_MISSING",
        unverifiableHistoryReasonCode: "SYNTHETIC_HISTORY_UNVERIFIABLE",
      },
    },
    numericParameters,
    unknownAnswerBehavior: "FAIL_CLOSED",
    outOfScopeOutcome: "PAUSE_REFER",
  };
}

/** Returns a bundle with the numeric parameter `id` removed entirely. */
export function omitPrescriptionParameter(
  bundle: PolicyBundleContent,
  id: string
): PolicyBundleContent {
  return {
    ...bundle,
    numericParameters: bundle.numericParameters.filter((parameter) => parameter.id !== id),
  };
}

/** Returns a bundle with the numeric parameter `id` mutated via `mutate`. */
export function corruptPrescriptionParameter(
  bundle: PolicyBundleContent,
  id: string,
  mutate: (parameter: PolicyBundleContent["numericParameters"][number]) => PolicyBundleContent["numericParameters"][number]
): PolicyBundleContent {
  return {
    ...bundle,
    numericParameters: bundle.numericParameters.map((parameter) =>
      parameter.id === id ? mutate(parameter) : parameter
    ),
  };
}
