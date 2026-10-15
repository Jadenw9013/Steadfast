/**
 * T-2032 — pure prescription engine types.
 *
 * Contract frozen by the architect in board/tickets/T-2003.md "## Spec" ->
 * "### Contract (frozen)" -> "Shared service — lib/ai-coach/prescription/".
 * Do not add a field, reorder a union member or rename anything here without
 * re-opening that spec: iOS and the composer (T-2033) are built against the
 * exact shapes below.
 */

/** T-2002's method population-routing category. Never derived from `User.gender`. */
export type EnergyMethodPopulationCategory =
  | "MALE_ADULT"
  | "FEMALE_ADULT"
  | "PREGNANCY"
  | "LACTATION"
  | "NOT_LISTED";

/** The four DRI physical-activity categories (T-2002). */
export type PhysicalActivityCategory = "INACTIVE" | "LOW_ACTIVE" | "ACTIVE" | "VERY_ACTIVE";

export type BodyWeightIntent = "LOSE" | "MAINTAIN" | "GAIN" | "NO_PREFERENCE";

export type GoalPaceClass = "MAINTAIN" | "GRADUAL" | "MODERATE" | "UNDECIDED";

export type ResistanceTrainingContext = "NONE" | "OCCASIONAL" | "REGULAR";

export type DietaryPatternValue =
  | "OMNIVORE"
  | "LACTO_OVO_VEGETARIAN"
  | "VEGAN"
  | "PESCATARIAN"
  | "OTHER"
  | "NONE_DECLARED";

export type DietaryPatternReason =
  | "PREFERENCE"
  | "RELIGIOUS_OR_ETHICAL"
  | "MEDICAL_OR_CLINICIAN_DIRECTED"
  | "NOT_STATED";

/**
 * Every field is `| null`. `buildPrescriptionInput` (inputs.ts) maps a
 * `DECLINED`/`UNKNOWN` status *and* a missing value to `null`, so the engine
 * never has to know about intake statuses and a status/value disagreement
 * can never produce a number. The engine reads nothing else: no `goal`, no
 * free text, no `dislikes`, no `cuisinePreferences`, no allergen strings, no
 * account `gender` (T-2003 Decisions).
 */
export type PrescriptionInput = {
  intakeVersion: 2;
  ageYears: number | null;
  energyMethodPopulationCategory: EnergyMethodPopulationCategory | null;
  physicalActivityCategory: PhysicalActivityCategory | null;
  heightCm: number | null;
  weightKg: number | null;
  weightMeasuredOn: string | null; // YYYY-MM-DD
  evaluatedOn: string; // YYYY-MM-DD, server clock, passed in (engine stays pure)
  bodyWeightIntent: BodyWeightIntent | null;
  goalPaceClass: GoalPaceClass | null;
  resistanceTrainingContext: ResistanceTrainingContext | null;
  dietaryPattern: DietaryPatternValue | null;
  dietaryPatternReason: DietaryPatternReason | null;
};

export type PrescriptionReasonCode =
  | "PRESCRIPTION_INTAKE_VERSION_UNSUPPORTED"
  | "PRESCRIPTION_INPUT_MISSING"
  | "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE"
  | "PRESCRIPTION_WEIGHT_MEASUREMENT_STALE"
  | "PRESCRIPTION_POPULATION_UNSUPPORTED"
  | "PRESCRIPTION_GOAL_PACE_UNDECIDED"
  | "PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED"
  | "PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE"
  | "PRESCRIPTION_MAINTENANCE_BELOW_MINIMUM"
  | "PRESCRIPTION_MACRO_RANGES_INFEASIBLE"
  | "PRESCRIPTION_PARAMETER_MISSING"
  | "PRESCRIPTION_PARAMETER_INCOMPATIBLE"
  | "PRESCRIPTION_METHOD_UNSUPPORTED"
  | "PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE";

export type Prescription = {
  method: "REVIEWED_PRESCRIPTION_V1";
  energyMethodStructureId: string; // echoed from the bundle
  /**
   * contentHash of the *entire* resolved parameter set (T-2007/weekly-proof
   * replay key) — not only the 75 numeric values. It also covers the two
   * T-1003 safety floors and the reviewed explanation texts, so it changes
   * whenever any of those change too (T-2003 Amendment 1 §A1.5: a floor or a
   * reviewed-copy edit genuinely must invalidate a replay). Consequence for
   * callers: a mismatch here alone, with `targetEnergyKcal` unchanged, is a
   * stale-candidate signal, not proof the numeric prescription is wrong —
   * T-2033 must not treat it as an automatic hard failure.
   */
  parameterSetDigest: string;
  maintenanceEnergyKcal: number; // rounded, display precision
  targetEnergyKcal: number; // rounded, display precision
  proteinG: number;
  carbohydrateRangeG: { min: number; max: number };
  fatRangeG: { min: number; max: number };
  /** Feeds nutrition-safety.ts:196-206. Negative = loss. Null is impossible here. */
  projectedWeeklyWeightChangeKg: number;
  appliedBoundIds: string[]; // parameter/rule IDs that actually clamped the result
  tolerancePercent: number;
  assumptions: string[]; // reviewed strings, resolved from artifacts; never composed here
};

export type PrescriptionResult =
  | { status: "PRESCRIBED"; prescription: Prescription; reasonCodes: [] }
  | { status: "UNAVAILABLE"; prescription: null; reasonCodes: PrescriptionReasonCode[] };
