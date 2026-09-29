/**
 * S-23 — total resolver for the `ADAPTIVE.*` parameter set.
 *
 * T-2032 / `training/parameters.ts` pattern: it never throws, it returns the
 * sorted ids it could not satisfy, and it refuses as a whole rather than
 * producing a partially-populated parameter set. A feature whose constants are
 * half-present cannot half-exist.
 *
 * THERE ARE NO VALUES IN THIS FILE. The nine ids below are declarations of what
 * the accountable owner must sign, exactly like the training doses. Nothing in
 * this repository supplies a number for any of them, and the checked-in policy
 * bundle does not contain them, so today every call on a real bundle returns
 * `ADAPTIVE_PARAMETER_MISSING` listing all nine. That refusal is the correct
 * current behaviour and is asserted by a test.
 */

import type { PolicyBundleContent } from "@/lib/ai-coach/artifacts/schema";
import { contentHash } from "@/lib/ai-coach/canonical-json";

/**
 * Reason codes this feature can emit.
 *
 * `ADAPTIVE_PARAMETER_MISSING` and `ADAPTIVE_INSUFFICIENT_EVIDENCE` are the two
 * the architecture names. `ADAPTIVE_PARAMETER_INCOMPATIBLE` is a third, added
 * here deliberately and flagged for review: a signed parameter that is present
 * but carries the wrong unit, a non-finite value, or a value outside the range
 * the formula is defined on is a different fault from an absent one, and
 * reporting it as "missing" would send the owner looking for a value that is
 * already in the bundle. Before phase 4 wires any of this into a request path,
 * all three codes need a covering escalation template or the gate 503s (S-15).
 */
export type AdaptiveReasonCode =
  | "ADAPTIVE_PARAMETER_MISSING"
  | "ADAPTIVE_PARAMETER_INCOMPATIBLE"
  | "ADAPTIVE_INSUFFICIENT_EVIDENCE";

/**
 * The named conditions a HOLD can cite. The gate never returns a bare refusal:
 * every HOLD carries exactly one of these, so "we did not adjust" is always
 * answerable with "because of this".
 *
 * `WINDOW_HISTORY_INSUFFICIENT` .. `COMPLETENESS_BELOW_REDUCTION_MINIMUM` are
 * the architecture's five gate conditions, in order. The rest are data-shape
 * conditions that make an estimate undefined rather than merely unconvincing;
 * they are named for the same reason.
 */
export type AdaptiveConditionId =
  | "WINDOW_HISTORY_INSUFFICIENT"
  | "COMPLETENESS_BELOW_MINIMUM"
  | "SLOPE_UNCERTAINTY_ABOVE_MAXIMUM"
  | "DIFFERENCE_NOT_MATERIAL"
  | "COMPLETENESS_BELOW_REDUCTION_MINIMUM"
  | "WEIGHT_SERIES_DATE_INVALID"
  | "WEIGHT_SERIES_VALUE_INVALID"
  | "WEIGHT_SERIES_INSUFFICIENT"
  | "WEIGHT_SERIES_NOT_STRICTLY_INCREASING"
  | "WEIGHT_SPAN_INSUFFICIENT"
  | "INTAKE_SERIES_DATE_INVALID"
  | "INTAKE_SERIES_DUPLICATE_DAY"
  | "INTAKE_SERIES_VALUE_INVALID"
  | "INTAKE_WINDOW_NO_COMPLETE_DAYS"
  | "CURRENT_ENERGY_NOT_POSITIVE";

export const ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID = "ADAPTIVE.RULE.OBSERVED_EXPENDITURE.V1";

/**
 * How a present value is checked. `unit` must match the bundle's declared unit
 * exactly; `range` is the domain the formula is defined on, not a clinical
 * opinion about a plausible value.
 */
type ValueRange = "FINITE" | "POSITIVE" | "NON_NEGATIVE" | "POSITIVE_INTEGER" | "UNIT_FRACTION";

type ParameterSpec = {
  id: string;
  unit: string;
  range: ValueRange;
};

/**
 * Units.
 *
 * `KG2_PER_DAY3` is the spectral density of the constant-velocity model's
 * acceleration noise: integrating it over an interval gives the process-noise
 * covariance in `weight-trend.ts`. `KG2` is a variance on a single scale
 * reading. Both are Kalman modelling quantities, not measurements.
 */
export const ADAPTIVE_PARAMETER_SPECS: readonly ParameterSpec[] = [
  { id: "ADAPTIVE.KALMAN.PROCESS_NOISE", unit: "KG2_PER_DAY3", range: "NON_NEGATIVE" },
  { id: "ADAPTIVE.KALMAN.MEASUREMENT_NOISE", unit: "KG2", range: "POSITIVE" },
  { id: "ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG", unit: "KCAL_PER_KG", range: "POSITIVE" },
  { id: "ADAPTIVE.WINDOW_DAYS", unit: "DAYS", range: "POSITIVE_INTEGER" },
  { id: "ADAPTIVE.MIN_COMPLETENESS", unit: "FRACTION_OF_WINDOW_DAYS", range: "UNIT_FRACTION" },
  {
    id: "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION",
    unit: "FRACTION_OF_WINDOW_DAYS",
    range: "UNIT_FRACTION",
  },
  { id: "ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL", unit: "KCAL_PER_DAY", range: "NON_NEGATIVE" },
  { id: "ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL", unit: "KCAL_PER_DAY", range: "NON_NEGATIVE" },
];

/** The nine ids on the accountable owner's worksheet: eight values and the rule. */
export const ADAPTIVE_PARAMETER_IDS: readonly string[] = [
  ...ADAPTIVE_PARAMETER_SPECS.map((spec) => spec.id),
  ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID,
].sort();

export type ResolvedAdaptiveParameters = {
  kalmanProcessNoise: number;
  kalmanMeasurementNoise: number;
  energyDensityKcalPerKg: number;
  windowDays: number;
  minCompleteness: number;
  minCompletenessForReduction: number;
  maxSlopeUncertaintyKcal: number;
  minMaterialDifferenceKcal: number;
  ruleId: string;
  parameterSetDigest: string;
};

export type ResolveAdaptiveParametersResult =
  | { ok: true; parameters: ResolvedAdaptiveParameters }
  | { ok: false; reasonCodes: AdaptiveReasonCode[]; missingParameterIds: string[] };

function valueIsInRange(range: ValueRange, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (range === "POSITIVE") return value > 0;
  if (range === "NON_NEGATIVE") return value >= 0;
  if (range === "POSITIVE_INTEGER") return Number.isInteger(value) && value > 0;
  if (range === "UNIT_FRACTION") return value >= 0 && value <= 1;
  return true;
}

/**
 * Resolves the whole `ADAPTIVE.*` set from a policy bundle, or refuses.
 *
 * Never throws. On refusal `missingParameterIds` is sorted and de-duplicated so
 * the output is a stable worksheet the accountable owner can work from.
 */
export function resolveAdaptiveParameters(
  policy: PolicyBundleContent
): ResolveAdaptiveParametersResult {
  const missing: string[] = [];
  const incompatible: string[] = [];

  const ruleDeclared =
    policy.ruleIds.includes(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID) &&
    policy.adjustmentRuleIds.includes(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);
  if (!ruleDeclared) missing.push(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);

  const byId = new Map(policy.numericParameters.map((parameter) => [parameter.id, parameter]));
  for (const spec of ADAPTIVE_PARAMETER_SPECS) {
    const found = byId.get(spec.id);
    if (!found) {
      missing.push(spec.id);
      continue;
    }
    const compatible =
      found.unit === spec.unit &&
      valueIsInRange(spec.range, found.value) &&
      found.applicabilityRuleIds.includes(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);
    if (!compatible) incompatible.push(spec.id);
  }

  const value = (id: string): number => byId.get(id)?.value ?? 0;

  // The asymmetry is a safety property, not a preference: a reduction must be
  // strictly harder to trigger than an increase. A bundle whose two
  // completeness thresholds do not express that is refused rather than applied
  // in whichever direction the numbers happen to fall.
  if (missing.length === 0 && incompatible.length === 0) {
    const minCompleteness = value("ADAPTIVE.MIN_COMPLETENESS");
    const minForReduction = value("ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION");
    if (!(minForReduction > minCompleteness)) {
      incompatible.push("ADAPTIVE.MIN_COMPLETENESS", "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION");
    }
  }

  if (missing.length > 0 || incompatible.length > 0) {
    const reasonCodes: AdaptiveReasonCode[] = [];
    if (missing.length > 0) reasonCodes.push("ADAPTIVE_PARAMETER_MISSING");
    if (incompatible.length > 0) reasonCodes.push("ADAPTIVE_PARAMETER_INCOMPATIBLE");
    return {
      ok: false,
      reasonCodes,
      missingParameterIds: [...new Set([...missing, ...incompatible])].sort(),
    };
  }

  const rawValues: Record<string, number> = {};
  for (const spec of ADAPTIVE_PARAMETER_SPECS) rawValues[spec.id] = value(spec.id);

  return {
    ok: true,
    parameters: {
      kalmanProcessNoise: value("ADAPTIVE.KALMAN.PROCESS_NOISE"),
      kalmanMeasurementNoise: value("ADAPTIVE.KALMAN.MEASUREMENT_NOISE"),
      energyDensityKcalPerKg: value("ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG"),
      windowDays: value("ADAPTIVE.WINDOW_DAYS"),
      minCompleteness: value("ADAPTIVE.MIN_COMPLETENESS"),
      minCompletenessForReduction: value("ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION"),
      maxSlopeUncertaintyKcal: value("ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL"),
      minMaterialDifferenceKcal: value("ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL"),
      ruleId: ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID,
      parameterSetDigest: contentHash({ rawValues, ruleId: ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID }),
    },
  };
}
