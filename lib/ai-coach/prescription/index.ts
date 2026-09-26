import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  computeMaintenanceEnergyKcalRaw,
  isPopulationWithCoefficients,
  lookupEnergyCoefficients,
  roundHalfAwayFromZero,
  roundToStep,
} from "./energy";
import {
  computeCarbohydrateRangeG,
  computeFatRangeG,
  computeProtein,
  macroRangesAreInfeasible,
} from "./macros";
import {
  GOAL_BOUND_MAX_INCREASE_ID,
  GOAL_BOUND_MAX_REDUCTION_ID,
  PRESCRIPTION_METHOD_STRUCTURE_ID,
  deepFreeze,
} from "./parameters";
import type { ResolvedPrescriptionParameters } from "./parameters";
import type { Prescription, PrescriptionInput, PrescriptionReasonCode, PrescriptionResult } from "./types";

export type { PrescriptionInput, PrescriptionReasonCode, PrescriptionResult, Prescription } from "./types";
export {
  resolvePrescriptionParameters,
  PRESCRIPTION_METHOD_STRUCTURE_ID,
  PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
  PRESCRIPTION_ROUNDING_ORDER_ID,
  PRESCRIPTION_MACRO_COMPOSITION_ID,
  PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  deepFreeze,
} from "./parameters";
export type {
  ResolvedPrescriptionParameters,
  ResolvePrescriptionParametersResult,
  PrescriptionSafetyFloors,
} from "./parameters";
export { buildPrescriptionInput } from "./inputs";
export type { BuildPrescriptionInputResult } from "./inputs";

/**
 * T-2032 — `computePrescription`, the 17-step frozen order
 * (board/tickets/T-2003.md "### Frozen computation and rounding order
 * (`PRESCRIPTION.ROUNDING.ORDER.V1`)"). Pure: no DB, no clock, no env, no
 * catalog access. `evaluatedOn` is a parameter of `input`, not read from the
 * system clock here.
 *
 * Numeric literals beyond "0/1/7/100" are frozen by T-2003 Amendment 1
 * §A1.2 at `{2, 10, 20, 100, 300, 86400000}`, each named below with the
 * structural reason it exists.
 */

const REQUIRED_INPUT_FIELDS: readonly (keyof PrescriptionInput)[] = [
  "ageYears",
  "energyMethodPopulationCategory",
  "physicalActivityCategory",
  "heightCm",
  "weightKg",
  "weightMeasuredOn",
  "bodyWeightIntent",
  "goalPaceClass",
  "resistanceTrainingContext",
];

/** Amendment 1 §A1.2: milliseconds in a calendar day, a calendar fact, not a bundle parameter. */
const MILLISECONDS_PER_DAY = 86400000;
const MAX_ASSUMPTIONS_ENTRIES = 10; // matches plan-contract.ts nutrition.assumptions.max(10)
const MAX_ASSUMPTION_CHARACTERS = 300; // matches plan-contract.ts z.string().max(300)

function unavailable(reasonCodes: readonly PrescriptionReasonCode[]): PrescriptionResult {
  return {
    status: "UNAVAILABLE",
    prescription: null,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}

/** `null` for anything that is not a real `YYYY-MM-DD` calendar date (inputs.ts
 * is the primary guard and maps a malformed string to `null` before this ever
 * runs; this stays finite-guarded regardless, belt-and-braces for any other
 * caller of the pure engine — T-2032 review r1 finding B2).
 *
 * `Date.parse` alone is not enough: it silently *rolls a calendar-invalid
 * date forward* rather than failing (`Date.parse("2026-09-31T00:00:00.000Z")`
 * parses as 2026-10-01, finite, no error) — the exact input the review used
 * for this finding. Round-tripping the parsed instant back through
 * `toISOString` and comparing to the original string catches that: a
 * genuine calendar date is its own fixed point under that round trip, a
 * rolled-over one is not. */
function parseCalendarDateUtcMs(value: string): number {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return NaN;
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  return roundTrip === value ? ms : NaN;
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (parseCalendarDateUtcMs(toDate) - parseCalendarDateUtcMs(fromDate)) / MILLISECONDS_PER_DAY
  );
}

/** Product rule, not a clinical rule: which goals need an energy target at all. */
export function nutritionRequiredForGoal(input: Pick<PrescriptionInput, "bodyWeightIntent">): boolean {
  return input.bodyWeightIntent === "LOSE" || input.bodyWeightIntent === "GAIN";
}

/**
 * Epsilon-tolerant "greater than": a bound is clamped to a value via one
 * closed-form formula (e.g. the exact energy that produces the maximum
 * permitted rate) and then re-checked by recomputing the same quantity via
 * its inverse formula; floating-point round-trip error can land that
 * recomputed value a hair past the boundary even though the two are
 * mathematically equal. `Number.EPSILON`-scaled tolerance absorbs that noise
 * without weakening a genuine violation, which in the ranges this engine
 * operates in is always many orders of magnitude larger than the tolerance.
 * Permissive-only and bounded: it can only make `exceeds` return `false` a
 * hair later than a mathematically-exact comparison would (never earlier),
 * and the tolerance it grants scales with the compared magnitudes, not with
 * the ticket's structural constants — so it cannot mask a real breach,
 * whose size in this engine is always ≥1e-2 in whatever unit is compared,
 * ten-plus orders of magnitude above the tolerance (T-2032 review r2
 * finding m14).
 */
function exceeds(value: number, bound: number): boolean {
  return value > bound + Number.EPSILON * Math.max(Math.abs(value), Math.abs(bound), 1);
}

type BoundsPass = { targetRaw: number; clampedIds: string[] };

function evaluateBoundsOnce(
  parameters: ResolvedPrescriptionParameters,
  targetRaw: number,
  maintenanceKcalRaw: number,
  weightKg: number
): BoundsPass {
  let t = targetRaw;
  const clampedIds: string[] = [];

  // a. relative bound
  const lowerRelative = maintenanceKcalRaw * (1 - parameters.goalBound.maxReductionFraction);
  const upperRelative = maintenanceKcalRaw * (1 + parameters.goalBound.maxIncreaseFraction);
  if (exceeds(lowerRelative, t)) {
    t = lowerRelative;
    clampedIds.push(GOAL_BOUND_MAX_REDUCTION_ID);
  } else if (exceeds(t, upperRelative)) {
    t = upperRelative;
    clampedIds.push(GOAL_BOUND_MAX_INCREASE_ID);
  }

  // b. absolute floor (T-1003)
  if (exceeds(parameters.safetyFloors.minimumDailyEnergyKcal, t)) {
    t = parameters.safetyFloors.minimumDailyEnergyKcal;
    clampedIds.push(parameters.safetyFloors.minimumDailyEnergyParameterId);
  }

  // c. rate (T-1003). Compared as an energy deficit against the exact
  // permitted deficit, not converted to a rate percentage first: `t` and
  // `maintenanceKcalRaw` are both ~maintenance-energy magnitude (order
  // 1e3-1e4), so their difference carries no more absolute error than a
  // handful of ULPs of that magnitude — but converting that difference to a
  // percentage (dividing by weightKg, multiplying by 100) amplifies the same
  // absolute error relative to the now much smaller compared value (a rate
  // percentage of order 1). Comparing the two ~1e3-1e4-magnitude deficits
  // directly keeps `exceeds`'s epsilon scaled to the right domain
  // (T-2032 review r2 finding m14).
  const deficitKcal = maintenanceKcalRaw - t; // positive = below maintenance
  if (deficitKcal > 0) {
    const maxDeficitKcal =
      (parameters.safetyFloors.maximumWeeklyLossRatePercent * parameters.energyPerKgBodyMass * weightKg) /
      (7 * 100);
    if (exceeds(deficitKcal, maxDeficitKcal)) {
      t = maintenanceKcalRaw - maxDeficitKcal;
      clampedIds.push(parameters.safetyFloors.maximumWeeklyLossRateParameterId);
    }
  }

  return { targetRaw: t, clampedIds };
}

/**
 * Which of bounds a/b/c `t` violates, if any. Shared by step 8's re-check
 * pass and step 9's post-rounding re-assertion (T-2032 review r1 finding B1)
 * — one predicate, not two.
 *
 * The rate check here (only) uses the **rounded, published**
 * `projectedWeeklyWeightChangeKg` — the same `roundHalfAwayFromZero(...,
 * ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS)` step 15 applies — instead
 * of the unrounded float `evaluateBoundsOnce` (step 8) uses. Step 15 rounds
 * *after* step 9's loop converges, so a `t` whose unrounded rate satisfies
 * the cap can still round to a published value whose rate does not: review
 * r1's checked-in `maximum-weekly-loss-rate-exact` vector had cap 0.91%,
 * unrounded-at-2070 rate 0.9100% (not exceeded, loop exits), but the
 * *published* `-0.73` kg (rounded from `-0.728`) recomputes to 0.9125% >
 * 0.91% the way `nutrition-safety.ts:196-203` (and any other consumer)
 * necessarily does, since that function only ever sees the rounded, stored
 * value — it has no access to the engine's internal float (T-2032 review r2
 * finding B1). Checking the rounded value here means step 15's later
 * rounding can never again produce a number this loop has not already
 * verified.
 */
function boundViolationIds(
  parameters: ResolvedPrescriptionParameters,
  t: number,
  maintenanceKcalRaw: number,
  weightKg: number
): string[] {
  const ids: string[] = [];
  const lowerRelative = maintenanceKcalRaw * (1 - parameters.goalBound.maxReductionFraction);
  const upperRelative = maintenanceKcalRaw * (1 + parameters.goalBound.maxIncreaseFraction);
  if (exceeds(lowerRelative, t)) ids.push(GOAL_BOUND_MAX_REDUCTION_ID);
  if (exceeds(t, upperRelative)) ids.push(GOAL_BOUND_MAX_INCREASE_ID);
  if (exceeds(parameters.safetyFloors.minimumDailyEnergyKcal, t)) {
    ids.push(parameters.safetyFloors.minimumDailyEnergyParameterId);
  }
  const projectedRaw = ((t - maintenanceKcalRaw) * 7) / parameters.energyPerKgBodyMass;
  const publishedProjectedKg = roundHalfAwayFromZero(
    projectedRaw,
    parameters.rounding.projectedWeeklyChangeKgDecimals
  );
  if (publishedProjectedKg < 0) {
    // Deficit compared in kg, not converted to a rate percentage first:
    // `publishedProjectedKg` is already a clean rounded decimal (its
    // representation error is bounded by one ULP of a number ≤2 decimal
    // places, utterly negligible against a 0.01 kg rounding granularity),
    // so — unlike the unrounded rate check in `evaluateBoundsOnce` — no
    // domain change is needed to avoid amplifying cancellation error here.
    const maxDeficitKg = (parameters.safetyFloors.maximumWeeklyLossRatePercent * weightKg) / 100;
    if (exceeds(-publishedProjectedKg, maxDeficitKg)) {
      ids.push(parameters.safetyFloors.maximumWeeklyLossRateParameterId);
    }
  }
  return ids;
}

export function computePrescription(
  parameters: ResolvedPrescriptionParameters,
  input: PrescriptionInput
): PrescriptionResult {
  // Steps 1-4 plus the population check are independent collectors: each
  // evaluates whatever it can from the raw input regardless of what else is
  // wrong, so the gate's PAUSE_REFER > HOLD > FOCUSED_CLARIFICATION
  // precedence sees every applicable class in one pass instead of one
  // clarification round at a time (T-2032 review r1 finding M5). Steps
  // 5-16 stay sequential: each needs the previous step's validated
  // arithmetic.
  const earlyReasonCodes: PrescriptionReasonCode[] = [];

  // Step 1: collect every null required input, not just the first.
  const missingFields = REQUIRED_INPUT_FIELDS.filter((field) => input[field] === null);
  if (missingFields.length > 0) {
    earlyReasonCodes.push("PRESCRIPTION_INPUT_MISSING");
  }

  // Step 2: inclusive range checks, only for fields actually present.
  const ageOutOfRange =
    input.ageYears !== null &&
    (input.ageYears < parameters.inputRanges.ageYears.min ||
      input.ageYears > parameters.inputRanges.ageYears.max);
  const heightOutOfRange =
    input.heightCm !== null &&
    (input.heightCm < parameters.inputRanges.heightCm.min ||
      input.heightCm > parameters.inputRanges.heightCm.max);
  const weightOutOfRange =
    input.weightKg !== null &&
    (input.weightKg < parameters.inputRanges.weightKg.min ||
      input.weightKg > parameters.inputRanges.weightKg.max);
  if (ageOutOfRange || heightOutOfRange || weightOutOfRange) {
    earlyReasonCodes.push("PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE");
  }

  // Step 3: staleness, only evaluable if a measurement date is present. A
  // future weightMeasuredOn is also stale (never negative-days-valid); a
  // non-finite day count fails closed the same way (B2 belt-and-braces —
  // inputs.ts is the primary guard against a malformed date string).
  if (input.weightMeasuredOn !== null) {
    const days = daysBetween(input.weightMeasuredOn, input.evaluatedOn);
    if (!Number.isFinite(days) || days > parameters.weightMeasurementMaxAgeDays || days < 0) {
      earlyReasonCodes.push("PRESCRIPTION_WEIGHT_MEASUREMENT_STALE");
    }
  }

  // Step 4: dietary pattern scope. `null` (declined/unknown status) is
  // treated the same as an explicit NONE_DECLARED: no pattern constraint,
  // prescription proceeds, never PAUSE_REFER (lead ruling on review r1
  // finding M6, T-2032.md Log 2026-09-25). `dietaryPatternReason` is still
  // checked regardless of pattern, including when pattern is null.
  const supportedDietaryPatterns = ["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "NONE_DECLARED"];
  if (input.dietaryPattern !== null && !supportedDietaryPatterns.includes(input.dietaryPattern)) {
    earlyReasonCodes.push("PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED");
  }
  if (input.dietaryPatternReason === "MEDICAL_OR_CLINICIAN_DIRECTED") {
    earlyReasonCodes.push("PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE");
  }

  // Population support: "a coefficient set exists in the bundle", never a
  // hardcoded list. Only evaluable if the field is present; independent of
  // `physicalActivityCategory` so a null activity does not mask an
  // unsupported population in the same pass.
  if (
    input.energyMethodPopulationCategory !== null &&
    !isPopulationWithCoefficients(input.energyMethodPopulationCategory)
  ) {
    earlyReasonCodes.push("PRESCRIPTION_POPULATION_UNSUPPORTED");
  }

  if (earlyReasonCodes.length > 0) {
    return unavailable(earlyReasonCodes);
  }

  // Every required field is present, in range, fresh; dietary pattern is in
  // scope; population is supported. Steps 5-16 proceed sequentially.
  const ageYears = input.ageYears as number;
  const heightCm = input.heightCm as number;
  const weightKg = input.weightKg as number;
  const population = input.energyMethodPopulationCategory as NonNullable<
    PrescriptionInput["energyMethodPopulationCategory"]
  >;
  const activity = input.physicalActivityCategory as NonNullable<
    PrescriptionInput["physicalActivityCategory"]
  >;
  const bodyWeightIntent = input.bodyWeightIntent as NonNullable<PrescriptionInput["bodyWeightIntent"]>;
  const goalPaceClass = input.goalPaceClass as NonNullable<PrescriptionInput["goalPaceClass"]>;
  const resistanceTrainingContext = input.resistanceTrainingContext as NonNullable<
    PrescriptionInput["resistanceTrainingContext"]
  >;

  // Unreachable: population support was already asserted above.
  const coefficients = lookupEnergyCoefficients(parameters, population, activity);
  if (!coefficients) {
    return unavailable(["PRESCRIPTION_POPULATION_UNSUPPORTED"]);
  }

  // Step 5.
  const maintenanceKcalRaw = computeMaintenanceEnergyKcalRaw(coefficients, ageYears, heightCm, weightKg);

  // Step 6.
  if (maintenanceKcalRaw < parameters.safetyFloors.minimumDailyEnergyKcal) {
    return unavailable(["PRESCRIPTION_MAINTENANCE_BELOW_MINIMUM"]);
  }

  // Step 7: goal adjustment.
  if (goalPaceClass === "UNDECIDED") {
    return unavailable(["PRESCRIPTION_GOAL_PACE_UNDECIDED"]);
  }
  let fraction: number;
  if (bodyWeightIntent === "MAINTAIN" || bodyWeightIntent === "NO_PREFERENCE") {
    fraction = parameters.goalAdjustment.MAINTAIN_ANY;
  } else if (goalPaceClass === "GRADUAL" || goalPaceClass === "MODERATE") {
    fraction = parameters.goalAdjustment[bodyWeightIntent][goalPaceClass];
  } else {
    // e.g. LOSE + MAINTAIN: a real (intent, pace) combination with no bundle
    // parameter. A1.6 ratified leaving this unreported in the frozen result
    // shape (no per-instance ID field exists on PrescriptionResult).
    return unavailable(["PRESCRIPTION_PARAMETER_MISSING"]);
  }
  const targetRawBeforeBounds = maintenanceKcalRaw * (1 + fraction);

  // Step 8: bound, most protective wins, re-checked once.
  const pass1 = evaluateBoundsOnce(parameters, targetRawBeforeBounds, maintenanceKcalRaw, weightKg);
  const pass2 = evaluateBoundsOnce(parameters, pass1.targetRaw, maintenanceKcalRaw, weightKg);
  if (pass2.clampedIds.length > 0) {
    return unavailable(["PRESCRIPTION_PARAMETER_INCOMPATIBLE"]);
  }
  const targetRaw = pass1.targetRaw;
  const appliedBoundIds = [...pass1.clampedIds];

  // Step 9: round to step, then re-assert every bound (a, b, c) against the
  // *rounded* target — rounding can cross a bound the unrounded clamp
  // satisfied (T-2032 review r1 finding B1; proven by the checked-in
  // `maximum-weekly-loss-rate-exact` vector). Step **toward whichever bound
  // is currently violated** one step at a time while any bound is violated,
  // recording every ID that was the reason: a global "toward maintenance"
  // direction chosen once from the sign of the pre-rounding target is wrong
  // exactly at the point that matters — a MAINTAIN goal has `targetRaw ===
  // maintenanceKcalRaw` (equality), so a fixed single direction guesses
  // wrong for whichever side rounding happened to cross (T-2032 review r2
  // finding m15). `GOAL_BOUND_MAX_INCREASE_ID` is the only violation that
  // means "too high" (step down); every other violation
  // (`GOAL_BOUND_MAX_REDUCTION_ID`, the floor, the rate) means "too low"
  // (step up) — the two sides are mutually exclusive, so this is a total,
  // correct direction choice regardless of goal direction. `maintenanceKcalRaw`
  // itself always satisfies every bound (zero relative deviation, zero rate,
  // and it already passed the step-6 floor check), so stepping toward
  // whichever side is violated is guaranteed to reach a satisfying value at
  // or before it, for a deficit *or* a surplus goal; `maxIterations` is a
  // defensive cap against a malformed (non-positive) step, not a reachable
  // path for a valid bundle.
  const step = parameters.rounding.energyKcalStep;
  let targetEnergyKcal = roundToStep(targetRaw, step);
  const maxIterations = Math.ceil(Math.abs(maintenanceKcalRaw - targetEnergyKcal) / step) + 1;
  if (!Number.isFinite(maxIterations) || step <= 0) {
    return unavailable(["PRESCRIPTION_PARAMETER_INCOMPATIBLE"]);
  }
  let iterations = 0;
  let roundingViolations = boundViolationIds(parameters, targetEnergyKcal, maintenanceKcalRaw, weightKg);
  while (roundingViolations.length > 0) {
    appliedBoundIds.push(...roundingViolations);
    targetEnergyKcal += roundingViolations.includes(GOAL_BOUND_MAX_INCREASE_ID) ? -step : step;
    iterations += 1;
    if (iterations > maxIterations) {
      return unavailable(["PRESCRIPTION_PARAMETER_INCOMPATIBLE"]);
    }
    roundingViolations = boundViolationIds(parameters, targetEnergyKcal, maintenanceKcalRaw, weightKg);
  }

  // Step 10: display-only maintenance rounding.
  const maintenanceEnergyKcal = roundToStep(maintenanceKcalRaw, step);

  // Step 11/12: protein.
  const protein = computeProtein(parameters, resistanceTrainingContext, weightKg);
  appliedBoundIds.push(...protein.appliedBoundIds);
  const proteinEnergyKcal = protein.proteinG * parameters.energyDensityKcalPerG.protein;

  // Step 13: carbohydrate/fat ranges, rounded inward.
  const carbohydrateRangeG = computeCarbohydrateRangeG(parameters, targetEnergyKcal);
  const fatRangeG = computeFatRangeG(parameters, targetEnergyKcal);

  // Step 14: feasibility (GAP-N05 §5). Never silently reduces protein.
  if (
    macroRangesAreInfeasible(parameters, targetEnergyKcal, proteinEnergyKcal, carbohydrateRangeG, fatRangeG)
  ) {
    return unavailable(["PRESCRIPTION_MACRO_RANGES_INFEASIBLE"]);
  }

  // Step 15: from the rounded target, unrounded maintenance.
  const projectedWeeklyWeightChangeKg = roundHalfAwayFromZero(
    ((targetEnergyKcal - maintenanceKcalRaw) * 7) / parameters.energyPerKgBodyMass,
    parameters.rounding.projectedWeeklyChangeKgDecimals
  );

  // Step 16: reviewed explanation copy, never composed here.
  if (parameters.explanationTexts.length === 0) {
    return unavailable(["PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE"]);
  }
  const assumptions = parameters.explanationTexts
    .slice(0, MAX_ASSUMPTIONS_ENTRIES)
    .map((text) => (text.length > MAX_ASSUMPTION_CHARACTERS ? text.slice(0, MAX_ASSUMPTION_CHARACTERS) : text));

  // Step 17. Scope: the whole resolved parameter set, not only the 75
  // numeric values — see `Prescription.parameterSetDigest`'s own doc
  // comment (types.ts) for why the T-1003 floors and the explanation texts
  // are deliberately included (T-2003 Amendment 1 §A1.5).
  const parameterSetDigest = contentHash(parameters);

  const prescription: Prescription = {
    method: "REVIEWED_PRESCRIPTION_V1",
    energyMethodStructureId: PRESCRIPTION_METHOD_STRUCTURE_ID,
    parameterSetDigest,
    maintenanceEnergyKcal,
    targetEnergyKcal,
    proteinG: protein.proteinG,
    carbohydrateRangeG,
    fatRangeG,
    projectedWeeklyWeightChangeKg,
    appliedBoundIds: [...new Set(appliedBoundIds)].sort(),
    tolerancePercent: parameters.compositionTolerancePercent,
    assumptions,
  };

  return deepFreeze({ status: "PRESCRIBED", prescription, reasonCodes: [] });
}
