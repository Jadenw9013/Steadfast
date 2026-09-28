import type { PolicyBundleContent } from "@/lib/ai-coach/artifacts/schema";
import type {
  GoalPaceClass,
  PhysicalActivityCategory,
  PrescriptionReasonCode,
  ResistanceTrainingContext,
} from "./types";

/**
 * T-2032 — the frozen parameter ID catalogue (board/tickets/T-2003.md
 * "### Parameter ID scheme"). 75 numeric parameters plus 4 method/rule IDs.
 * Every coefficient, bound, g/kg value, tolerance and rounding rule the
 * engine uses is read from here — never a code constant. IDs are built from
 * string templates over closed, code-owned category lists (never a numeric
 * literal): the category lists themselves *are* the frozen structure
 * (population/activity/protein-context routing), not policy values.
 */

export const PRESCRIPTION_METHOD_STRUCTURE_ID = "NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1";
export const PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID =
  "MACRO.PROTEIN.WEIGHT_BASIS.CURRENT_BODY_WEIGHT.V1";
export const PRESCRIPTION_ROUNDING_ORDER_ID = "PRESCRIPTION.ROUNDING.ORDER.V1";
export const PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID = "GOAL.ADJUSTMENT.BOUNDED.V1";
/** T-2003 Amendment 1 §A1.3: the AMDR bounds and energy densities are a D05
 * macronutrient-method decision, not a display decision, and the RD signs
 * them separately from rounding/display. */
export const PRESCRIPTION_MACRO_COMPOSITION_ID = "MACRO.COMPOSITION.DRI_AMDR.V1";

export type PopulationWithCoefficients = "MALE_ADULT" | "FEMALE_ADULT";
const POPULATIONS_WITH_COEFFICIENTS: readonly PopulationWithCoefficients[] = [
  "MALE_ADULT",
  "FEMALE_ADULT",
];
const ACTIVITY_CATEGORIES: readonly PhysicalActivityCategory[] = [
  "INACTIVE",
  "LOW_ACTIVE",
  "ACTIVE",
  "VERY_ACTIVE",
];
const PROTEIN_CONTEXTS: readonly ResistanceTrainingContext[] = ["NONE", "OCCASIONAL", "REGULAR"];
const GOAL_INTENTS_WITH_PACE: readonly ("LOSE" | "GAIN")[] = ["LOSE", "GAIN"];
const GOAL_PACES_WITH_FRACTION: readonly ("GRADUAL" | "MODERATE")[] = ["GRADUAL", "MODERATE"];

const ENERGY_COEFFICIENT_SLOTS = [
  { key: "INTERCEPT", unit: "KCAL_PER_DAY" },
  { key: "AGE_COEFFICIENT", unit: "KCAL_PER_DAY_PER_YEAR" },
  { key: "WEIGHT_COEFFICIENT", unit: "KCAL_PER_DAY_PER_KG" },
  { key: "HEIGHT_COEFFICIENT", unit: "KCAL_PER_DAY_PER_METRE" },
  { key: "ACTIVITY_COEFFICIENT", unit: "RATIO" },
] as const;
type EnergyCoefficientSlotKey = (typeof ENERGY_COEFFICIENT_SLOTS)[number]["key"];

const INPUT_RANGE_DIMENSIONS = [
  { key: "AGE_YEARS", unit: "YEARS" },
  { key: "HEIGHT_CM", unit: "CENTIMETRES" },
  { key: "WEIGHT_KG", unit: "KILOGRAMS" },
] as const;
const BOUNDS = ["MIN", "MAX"] as const;
const PROTEIN_BOUNDS = ["MIN", "TARGET", "MAX"] as const;

export function energyCoefficientParameterId(
  population: PopulationWithCoefficients,
  activity: PhysicalActivityCategory,
  slot: EnergyCoefficientSlotKey
): string {
  return `ENERGY.EER.NASEM2023.${population}.${activity}.${slot}`;
}

export function inputRangeParameterId(dimension: string, bound: "MIN" | "MAX"): string {
  return `ENERGY.EER.NASEM2023.INPUT_RANGE.${dimension}.${bound}`;
}

export function goalAdjustmentParameterId(
  intent: "LOSE" | "GAIN",
  pace: "GRADUAL" | "MODERATE"
): string {
  return `GOAL.ADJUSTMENT.${intent}.${pace}.ENERGY_DELTA_FRACTION`;
}

export function proteinParameterId(
  context: ResistanceTrainingContext,
  bound: "MIN" | "TARGET" | "MAX"
): string {
  return `MACRO.PROTEIN.G_PER_KG.${context}.${bound}`;
}

export function energyDensityParameterId(macro: "PROTEIN" | "CARBOHYDRATE" | "FAT"): string {
  return `MACRO.ENERGY_DENSITY.${macro}.KCAL_PER_G`;
}

/**
 * Reporting-only: builds the ID a (intent, pace) combination *would* have
 * used, even for a combination with no catalogue entry (e.g. LOSE +
 * MAINTAIN). Never used to resolve a value — `goalAdjustmentParameterId`
 * above is the only ID builder resolvePrescriptionParameters validates
 * against.
 */
export function goalAdjustmentParameterIdForReporting(
  intent: "LOSE" | "GAIN",
  pace: GoalPaceClass
): string {
  return `GOAL.ADJUSTMENT.${intent}.${pace}.ENERGY_DELTA_FRACTION`;
}

export const WEIGHT_MEASUREMENT_MAX_AGE_DAYS_ID = "ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS";
export const ENERGY_PER_KG_BODY_MASS_ID = "ENERGY.BODY_MASS.ENERGY_PER_KG";
export const GOAL_MAINTAIN_ANY_ID = "GOAL.ADJUSTMENT.MAINTAIN.ANY.ENERGY_DELTA_FRACTION";
export const GOAL_BOUND_MAX_REDUCTION_ID = "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION";
export const GOAL_BOUND_MAX_INCREASE_ID = "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION";
export const CARB_PERCENT_MIN_ID = "MACRO.CARBOHYDRATE.PERCENT_ENERGY.MIN";
export const CARB_PERCENT_MAX_ID = "MACRO.CARBOHYDRATE.PERCENT_ENERGY.MAX";
export const FAT_PERCENT_MIN_ID = "MACRO.FAT.PERCENT_ENERGY.MIN";
export const FAT_PERCENT_MAX_ID = "MACRO.FAT.PERCENT_ENERGY.MAX";
export const ROUNDING_ENERGY_STEP_ID = "ROUNDING.ENERGY_KCAL.STEP";
export const ROUNDING_MACRO_GRAMS_DECIMALS_ID = "ROUNDING.MACRO_GRAMS.DECIMALS";
export const ROUNDING_PROJECTED_WEEKLY_CHANGE_DECIMALS_ID =
  "ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS";
export const COMPOSITION_TOLERANCE_PERCENT_ID = "COMPOSITION.TOLERANCE_PERCENT";

type ParameterSpec = {
  id: string;
  unit: string;
  /**
   * The one of the four calculationMethodIds/adjustmentRuleIds this
   * parameter must carry in its own `applicabilityRuleIds` (mirrors
   * `resolveNutritionSafetyPolicy`'s `applicabilityRuleIds.includes(...)`
   * check, nutrition-safety.ts:110/121).
   */
  groupRuleId: string;
  /** Extra value-range validation beyond "finite", keyed by ID. */
  maxValue?: number;
  minValue?: number;
};

function buildParameterSpecs(): ParameterSpec[] {
  const specs: ParameterSpec[] = [];

  for (const population of POPULATIONS_WITH_COEFFICIENTS) {
    for (const activity of ACTIVITY_CATEGORIES) {
      for (const slot of ENERGY_COEFFICIENT_SLOTS) {
        specs.push({
          id: energyCoefficientParameterId(population, activity, slot.key),
          unit: slot.unit,
          groupRuleId: PRESCRIPTION_METHOD_STRUCTURE_ID,
        });
      }
    }
  }

  for (const dimension of INPUT_RANGE_DIMENSIONS) {
    for (const bound of BOUNDS) {
      specs.push({
        id: inputRangeParameterId(dimension.key, bound),
        unit: dimension.unit,
        groupRuleId: PRESCRIPTION_METHOD_STRUCTURE_ID,
      });
    }
  }

  specs.push({
    id: WEIGHT_MEASUREMENT_MAX_AGE_DAYS_ID,
    unit: "DAYS",
    groupRuleId: PRESCRIPTION_METHOD_STRUCTURE_ID,
  });

  specs.push({
    id: ENERGY_PER_KG_BODY_MASS_ID,
    unit: "KCAL_PER_KG_BODY_MASS",
    groupRuleId: PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  });

  for (const intent of GOAL_INTENTS_WITH_PACE) {
    for (const pace of GOAL_PACES_WITH_FRACTION) {
      specs.push({
        id: goalAdjustmentParameterId(intent, pace),
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
        groupRuleId: PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
      });
    }
  }
  specs.push({
    id: GOAL_MAINTAIN_ANY_ID,
    unit: "FRACTION_OF_MAINTENANCE_ENERGY",
    groupRuleId: PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  });
  specs.push({
    id: GOAL_BOUND_MAX_REDUCTION_ID,
    unit: "FRACTION_OF_MAINTENANCE_ENERGY",
    groupRuleId: PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  });
  specs.push({
    id: GOAL_BOUND_MAX_INCREASE_ID,
    unit: "FRACTION_OF_MAINTENANCE_ENERGY",
    groupRuleId: PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  });

  for (const context of PROTEIN_CONTEXTS) {
    for (const bound of PROTEIN_BOUNDS) {
      specs.push({
        id: proteinParameterId(context, bound),
        unit: "G_PER_KG_BODY_WEIGHT_PER_DAY",
        groupRuleId: PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
      });
    }
  }

  // Macro-composition group (T-2003 Amendment 1 §A1.3): AMDR bounds and
  // energy densities are the D05 macronutrient method, signed separately
  // from the rounding/display rule below.
  specs.push({
    id: CARB_PERCENT_MIN_ID,
    unit: "PERCENT_OF_TOTAL_ENERGY",
    groupRuleId: PRESCRIPTION_MACRO_COMPOSITION_ID,
  });
  specs.push({
    id: CARB_PERCENT_MAX_ID,
    unit: "PERCENT_OF_TOTAL_ENERGY",
    groupRuleId: PRESCRIPTION_MACRO_COMPOSITION_ID,
  });
  specs.push({
    id: FAT_PERCENT_MIN_ID,
    unit: "PERCENT_OF_TOTAL_ENERGY",
    groupRuleId: PRESCRIPTION_MACRO_COMPOSITION_ID,
  });
  specs.push({
    id: FAT_PERCENT_MAX_ID,
    unit: "PERCENT_OF_TOTAL_ENERGY",
    groupRuleId: PRESCRIPTION_MACRO_COMPOSITION_ID,
  });
  for (const macro of ["PROTEIN", "CARBOHYDRATE", "FAT"] as const) {
    specs.push({
      id: energyDensityParameterId(macro),
      unit: "KCAL_PER_GRAM",
      groupRuleId: PRESCRIPTION_MACRO_COMPOSITION_ID,
    });
  }
  // Rounding/display group. COMPOSITION.TOLERANCE_PERCENT additionally
  // matches plan-contract.ts's `nutrition.tolerancePercent` bound (0..20) so
  // a resolved bundle can never produce a payload the plan contract would
  // reject; that literal, and the two below it (10 entries / 300 characters,
  // matching plan-contract.ts's `assumptions` field), are the one named,
  // documented exception to the "no literal other than 0/1/7/100" rule —
  // see the source-grep test in ai-coach-prescription.test.ts for the exact
  // allow-list, frozen by T-2003 Amendment 1 §A1.2.
  specs.push({
    id: ROUNDING_ENERGY_STEP_ID,
    unit: "KCAL_PER_DAY",
    groupRuleId: PRESCRIPTION_ROUNDING_ORDER_ID,
  });
  specs.push({
    id: ROUNDING_MACRO_GRAMS_DECIMALS_ID,
    unit: "DECIMAL_PLACES",
    groupRuleId: PRESCRIPTION_ROUNDING_ORDER_ID,
  });
  specs.push({
    id: ROUNDING_PROJECTED_WEEKLY_CHANGE_DECIMALS_ID,
    unit: "DECIMAL_PLACES",
    groupRuleId: PRESCRIPTION_ROUNDING_ORDER_ID,
  });
  specs.push({
    id: COMPOSITION_TOLERANCE_PERCENT_ID,
    unit: "PERCENT",
    groupRuleId: PRESCRIPTION_ROUNDING_ORDER_ID,
    minValue: 0,
    maxValue: 20,
  });

  return specs;
}

/** Frozen: exactly 75 numeric parameters (board/tickets/T-2003.md). */
export const PRESCRIPTION_PARAMETER_SPECS: readonly ParameterSpec[] = buildParameterSpecs();

export type EnergyCoefficientSet = {
  intercept: number;
  ageCoefficient: number;
  weightCoefficient: number;
  heightCoefficient: number;
  activityCoefficient: number;
};

export type ResolvedPrescriptionParameters = {
  energyCoefficients: Record<
    PopulationWithCoefficients,
    Record<PhysicalActivityCategory, EnergyCoefficientSet>
  >;
  inputRanges: {
    ageYears: { min: number; max: number };
    heightCm: { min: number; max: number };
    weightKg: { min: number; max: number };
  };
  weightMeasurementMaxAgeDays: number;
  energyPerKgBodyMass: number;
  goalAdjustment: {
    LOSE: { GRADUAL: number; MODERATE: number };
    GAIN: { GRADUAL: number; MODERATE: number };
    MAINTAIN_ANY: number;
  };
  goalBound: { maxReductionFraction: number; maxIncreaseFraction: number };
  protein: Record<ResistanceTrainingContext, { min: number; target: number; max: number }>;
  carbohydratePercentEnergy: { min: number; max: number };
  fatPercentEnergy: { min: number; max: number };
  energyDensityKcalPerG: { protein: number; carbohydrate: number; fat: number };
  rounding: {
    energyKcalStep: number;
    macroGramsDecimals: number;
    projectedWeeklyChangeKgDecimals: number;
  };
  compositionTolerancePercent: number;
  /** T-1003 floors, resolved once by the caller via resolveNutritionSafetyPolicy
   * (nutrition-safety.ts:97-137) and passed in verbatim — "one reader, one
   * meaning" (T-2003 spec). This module never imports nutrition-safety.ts:
   * that file's own import graph reaches `@/lib/db`, which would break the
   * "no DB" purity constraint transitively. */
  safetyFloors: PrescriptionSafetyFloors;
  /** Pre-resolved ESCALATION_TEMPLATES `nextStepText` values, in
   * `policy.prescriptionExplanationTemplateIds` order, unbounded — computePrescription
   * (step 16) applies the count/length caps. */
  explanationTexts: readonly string[];
};

export type PrescriptionSafetyFloors = {
  minimumDailyEnergyKcal: number;
  minimumDailyEnergyParameterId: string;
  maximumWeeklyLossRatePercent: number;
  maximumWeeklyLossRateParameterId: string;
};

export type ResolvePrescriptionParametersResult =
  | { ok: true; parameters: ResolvedPrescriptionParameters }
  | { ok: false; reasonCodes: PrescriptionReasonCode[]; missingParameterIds: string[] };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Recursively freezes plain objects/arrays. Shared by `resolvePrescriptionParameters`
 * (the resolved parameter set, whose digest is a replay key) and `computePrescription`
 * (the returned `PrescriptionResult`) — one implementation, not two. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Total function, never throws. Mirrors the validation style of
 * `resolveNutritionSafetyPolicy` (nutrition-safety.ts:97-137): unit must
 * match exactly, value must be finite, and each parameter's
 * `applicabilityRuleIds` must contain its group's declared rule ID.
 *
 * `safetyFloors` carries the already-resolved T-1003 floor values (see
 * `PrescriptionSafetyFloors` above for why they are a plain argument rather
 * than an import).
 */
export function resolvePrescriptionParameters(
  policy: PolicyBundleContent,
  explanationTexts: readonly string[],
  safetyFloors: PrescriptionSafetyFloors
): ResolvePrescriptionParametersResult {
  const missingIds: string[] = [];
  const incompatibleIds: string[] = [];
  const byId = new Map(policy.numericParameters.map((parameter) => [parameter.id, parameter]));

  for (const spec of PRESCRIPTION_PARAMETER_SPECS) {
    const found = byId.get(spec.id);
    if (!found) {
      missingIds.push(spec.id);
      continue;
    }
    const withinRange =
      (spec.minValue === undefined || found.value >= spec.minValue) &&
      (spec.maxValue === undefined || found.value <= spec.maxValue);
    if (
      found.unit !== spec.unit ||
      !Number.isFinite(found.value) ||
      !withinRange ||
      !found.applicabilityRuleIds.includes(spec.groupRuleId)
    ) {
      incompatibleIds.push(spec.id);
    }
  }

  const methodDeclared = policy.calculationMethodIds.includes(PRESCRIPTION_METHOD_STRUCTURE_ID);
  const proteinBasisDeclared = policy.calculationMethodIds.includes(
    PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID
  );
  const roundingOrderDeclared = policy.calculationMethodIds.includes(
    PRESCRIPTION_ROUNDING_ORDER_ID
  );
  const macroCompositionDeclared = policy.calculationMethodIds.includes(
    PRESCRIPTION_MACRO_COMPOSITION_ID
  );
  const goalAdjustmentDeclared = policy.adjustmentRuleIds.includes(
    PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID
  );
  const methodUnsupported =
    !methodDeclared ||
    !proteinBasisDeclared ||
    !roundingOrderDeclared ||
    !macroCompositionDeclared ||
    !goalAdjustmentDeclared;

  if (methodUnsupported) {
    return { ok: false, reasonCodes: ["PRESCRIPTION_METHOD_UNSUPPORTED"], missingParameterIds: [] };
  }

  if (missingIds.length > 0 || incompatibleIds.length > 0) {
    const reasonCodes: PrescriptionReasonCode[] = [];
    if (missingIds.length > 0) reasonCodes.push("PRESCRIPTION_PARAMETER_MISSING");
    if (incompatibleIds.length > 0) reasonCodes.push("PRESCRIPTION_PARAMETER_INCOMPATIBLE");
    return {
      ok: false,
      reasonCodes,
      missingParameterIds: unique([...missingIds, ...incompatibleIds]),
    };
  }

  const value = (id: string): number => {
    const found = byId.get(id);
    // Unreachable: every id above passed the loop's presence/validity check.
    return found ? found.value : 0;
  };

  const energyCoefficients = {} as ResolvedPrescriptionParameters["energyCoefficients"];
  for (const population of POPULATIONS_WITH_COEFFICIENTS) {
    energyCoefficients[population] = {} as Record<PhysicalActivityCategory, EnergyCoefficientSet>;
    for (const activity of ACTIVITY_CATEGORIES) {
      energyCoefficients[population][activity] = {
        intercept: value(energyCoefficientParameterId(population, activity, "INTERCEPT")),
        ageCoefficient: value(
          energyCoefficientParameterId(population, activity, "AGE_COEFFICIENT")
        ),
        weightCoefficient: value(
          energyCoefficientParameterId(population, activity, "WEIGHT_COEFFICIENT")
        ),
        heightCoefficient: value(
          energyCoefficientParameterId(population, activity, "HEIGHT_COEFFICIENT")
        ),
        activityCoefficient: value(
          energyCoefficientParameterId(population, activity, "ACTIVITY_COEFFICIENT")
        ),
      };
    }
  }

  const protein = {} as ResolvedPrescriptionParameters["protein"];
  for (const context of PROTEIN_CONTEXTS) {
    protein[context] = {
      min: value(proteinParameterId(context, "MIN")),
      target: value(proteinParameterId(context, "TARGET")),
      max: value(proteinParameterId(context, "MAX")),
    };
  }

  const parameters: ResolvedPrescriptionParameters = {
    energyCoefficients,
    inputRanges: {
      ageYears: {
        min: value(inputRangeParameterId("AGE_YEARS", "MIN")),
        max: value(inputRangeParameterId("AGE_YEARS", "MAX")),
      },
      heightCm: {
        min: value(inputRangeParameterId("HEIGHT_CM", "MIN")),
        max: value(inputRangeParameterId("HEIGHT_CM", "MAX")),
      },
      weightKg: {
        min: value(inputRangeParameterId("WEIGHT_KG", "MIN")),
        max: value(inputRangeParameterId("WEIGHT_KG", "MAX")),
      },
    },
    weightMeasurementMaxAgeDays: value(WEIGHT_MEASUREMENT_MAX_AGE_DAYS_ID),
    energyPerKgBodyMass: value(ENERGY_PER_KG_BODY_MASS_ID),
    goalAdjustment: {
      LOSE: {
        GRADUAL: value(goalAdjustmentParameterId("LOSE", "GRADUAL")),
        MODERATE: value(goalAdjustmentParameterId("LOSE", "MODERATE")),
      },
      GAIN: {
        GRADUAL: value(goalAdjustmentParameterId("GAIN", "GRADUAL")),
        MODERATE: value(goalAdjustmentParameterId("GAIN", "MODERATE")),
      },
      MAINTAIN_ANY: value(GOAL_MAINTAIN_ANY_ID),
    },
    goalBound: {
      maxReductionFraction: value(GOAL_BOUND_MAX_REDUCTION_ID),
      maxIncreaseFraction: value(GOAL_BOUND_MAX_INCREASE_ID),
    },
    protein,
    carbohydratePercentEnergy: {
      min: value(CARB_PERCENT_MIN_ID),
      max: value(CARB_PERCENT_MAX_ID),
    },
    fatPercentEnergy: {
      min: value(FAT_PERCENT_MIN_ID),
      max: value(FAT_PERCENT_MAX_ID),
    },
    energyDensityKcalPerG: {
      protein: value(energyDensityParameterId("PROTEIN")),
      carbohydrate: value(energyDensityParameterId("CARBOHYDRATE")),
      fat: value(energyDensityParameterId("FAT")),
    },
    rounding: {
      energyKcalStep: value(ROUNDING_ENERGY_STEP_ID),
      macroGramsDecimals: value(ROUNDING_MACRO_GRAMS_DECIMALS_ID),
      projectedWeeklyChangeKgDecimals: value(ROUNDING_PROJECTED_WEEKLY_CHANGE_DECIMALS_ID),
    },
    compositionTolerancePercent: value(COMPOSITION_TOLERANCE_PERCENT_ID),
    safetyFloors,
    explanationTexts,
  };

  return { ok: true, parameters: deepFreeze(parameters) };
}
