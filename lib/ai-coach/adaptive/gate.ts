/**
 * S-23 — the fail-closed decision: is an adjustment justified at all.
 *
 * Absence of evidence produces NO change, never a small change. Every refusal
 * carries the one condition that failed, so "we did not adjust" is always
 * answerable; there is no bare refusal path out of this module.
 *
 * The five conditions, evaluated in order (the architecture's numbering):
 *
 *   1  observed history ≥ ADAPTIVE.WINDOW_DAYS
 *   2  completeness     ≥ ADAPTIVE.MIN_COMPLETENESS
 *   3  slope_ci         ≤ ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL
 *   4  |TDEE_obs − TDEE_current| > ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL
 *   5  and, asymmetrically, a DOWNWARD proposal additionally requires
 *      completeness ≥ ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION, which the
 *      resolver has already proved is strictly higher than condition 2's.
 *
 * WHY 5 IS NOT A PREFERENCE. Under-logging biases the intake mean downward,
 * which biases the estimate downward, which would cut a client's food because
 * they logged badly rather than because they burn less. Making a reduction
 * strictly harder to trigger than an increase means thin data can only ever
 * fail safe. The margin is the accountable owner's to set, so it is a
 * parameter, not a rule in code.
 *
 * This module PROPOSES. It cannot adjust anything: the proposal is an energy
 * value that phase 4 will hand to `weekly-controller.ts` at exactly the point
 * `weekly.energyReestimate` enters today, after which the step fraction,
 * tolerance, cooldown, cumulative limit, safety floors and autonomy gate all
 * still apply unchanged. Nothing in this ticket calls it.
 *
 * Pure: no I/O, no clock, no randomness.
 */

import type {
  AdaptiveConditionId,
  AdaptiveReasonCode,
  ResolvedAdaptiveParameters,
} from "./parameters";
import type { ExpenditureEstimate } from "./expenditure";

export type AdaptiveProposalDirection = "INCREASE" | "DECREASE";

export type AdaptiveGateDiagnostics = {
  observedExpenditureKcal: number | null;
  currentEnergyKcal: number;
  differenceKcal: number | null;
  completeness: number | null;
  slopeUncertaintyKcal: number | null;
  observedHistoryDays: number | null;
  ruleId: string;
  parameterSetDigest: string;
};

export type AdaptiveGateDecision =
  | ({
      decision: "PROPOSE";
      proposedExpenditureKcal: number;
      direction: AdaptiveProposalDirection;
    } & AdaptiveGateDiagnostics)
  | ({
      decision: "HOLD";
      reasonCode: Extract<AdaptiveReasonCode, "ADAPTIVE_INSUFFICIENT_EVIDENCE">;
      failedCondition: AdaptiveConditionId;
    } & AdaptiveGateDiagnostics);

export function evaluateAdaptiveGate(
  estimate: ExpenditureEstimate,
  currentEnergyKcal: number,
  parameters: ResolvedAdaptiveParameters
): AdaptiveGateDecision {
  const base = {
    currentEnergyKcal,
    ruleId: parameters.ruleId,
    parameterSetDigest: parameters.parameterSetDigest,
  };

  const hold = (
    failedCondition: AdaptiveConditionId,
    diagnostics: Omit<AdaptiveGateDiagnostics, "currentEnergyKcal" | "ruleId" | "parameterSetDigest">
  ): AdaptiveGateDecision => ({
    decision: "HOLD",
    reasonCode: "ADAPTIVE_INSUFFICIENT_EVIDENCE",
    failedCondition,
    ...base,
    ...diagnostics,
  });

  const empty = {
    observedExpenditureKcal: null,
    differenceKcal: null,
    completeness: null,
    slopeUncertaintyKcal: null,
    observedHistoryDays: null,
  };

  if (estimate.status === "UNAVAILABLE") return hold(estimate.failedCondition, empty);
  if (!Number.isFinite(currentEnergyKcal) || currentEnergyKcal <= 0) {
    return hold("CURRENT_ENERGY_NOT_POSITIVE", empty);
  }

  const difference = estimate.observedExpenditureKcal - currentEnergyKcal;
  const diagnostics = {
    observedExpenditureKcal: estimate.observedExpenditureKcal,
    differenceKcal: difference,
    completeness: estimate.completeness,
    slopeUncertaintyKcal: estimate.slopeUncertaintyKcal,
    observedHistoryDays: estimate.observedHistoryDays,
  };

  // 1 — enough history exists for the window to be a window.
  if (estimate.observedHistoryDays < parameters.windowDays) {
    return hold("WINDOW_HISTORY_INSUFFICIENT", diagnostics);
  }
  // 2 — the client logged enough of it.
  if (estimate.completeness < parameters.minCompleteness) {
    return hold("COMPLETENESS_BELOW_MINIMUM", diagnostics);
  }
  // 3 — the weight trend is distinguishable from no trend.
  if (estimate.slopeUncertaintyKcal > parameters.maxSlopeUncertaintyKcal) {
    return hold("SLOPE_UNCERTAINTY_ABOVE_MAXIMUM", diagnostics);
  }
  // 4 — the disagreement is worth acting on.
  if (Math.abs(difference) <= parameters.minMaterialDifferenceKcal) {
    return hold("DIFFERENCE_NOT_MATERIAL", diagnostics);
  }

  const direction: AdaptiveProposalDirection = difference > 0 ? "INCREASE" : "DECREASE";

  // 5 — asymmetric: a reduction needs the stricter completeness.
  if (direction === "DECREASE" && estimate.completeness < parameters.minCompletenessForReduction) {
    return hold("COMPLETENESS_BELOW_REDUCTION_MINIMUM", diagnostics);
  }

  return {
    decision: "PROPOSE",
    proposedExpenditureKcal: estimate.observedExpenditureKcal,
    direction,
    ...base,
    ...diagnostics,
  };
}
