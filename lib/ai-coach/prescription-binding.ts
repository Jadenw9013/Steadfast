import type { ReviewedArtifactSet } from "./artifacts/repository";
import {
  getReviewedPolicyBundleContent,
  resolveReviewedPrescriptionExplanationTexts,
} from "./artifacts/repository";
import { resolveNutritionSafetyPolicy } from "./nutrition-safety";
import {
  resolvePrescriptionParameters,
  type PrescriptionReasonCode,
  type ResolvedPrescriptionParameters,
} from "./prescription";

export type ResolvePrescriptionParametersForArtifactsResult =
  | { ok: true; parameters: ResolvedPrescriptionParameters }
  | { ok: false; reasonCodes: PrescriptionReasonCode[] };

/**
 * T-2033 — one reader for "resolve this run's engine parameters from the
 * artifact set it is bound to". Both `managed-executor.ts` (generation) and
 * `finalization.ts` (recomputing a candidate's prescription for the
 * digest/target check) call this instead of each re-deriving the mapping
 * (CLAUDE.md rule 1).
 *
 * Reuses `resolveNutritionSafetyPolicy` for the T-1003 floors — the same
 * call `evaluateCurrentClientNutritionSafety` makes internally
 * (nutrition-safety.ts:280) — per T-2003 Amendment 1 §A1.1 ("one reader, one
 * meaning" for the floors). Genuinely broken T-1003 hooks still throw.
 * Explicit PENDING_RD_DECISION hooks are an expected review state: the
 * safety resolver supplies a HOLD disposition and this binding returns the
 * existing policy-not-ready code instead of turning that state into a failed
 * run or HTTP 503.
 */
export function resolvePrescriptionParametersForArtifacts(
  artifacts: ReviewedArtifactSet
): ResolvePrescriptionParametersForArtifactsResult {
  const policy = getReviewedPolicyBundleContent(artifacts.policy);
  const safety = resolveNutritionSafetyPolicy(policy);
  if (safety.resolutionStatus === "PENDING") {
    return { ok: false, reasonCodes: ["PRESCRIPTION_PARAMETER_MISSING"] };
  }
  const explanationTexts = resolveReviewedPrescriptionExplanationTexts(artifacts, policy);
  const resolved = resolvePrescriptionParameters(policy, explanationTexts, {
    minimumDailyEnergyKcal: safety.nutritionLimits.minimumDailyEnergyKcal,
    minimumDailyEnergyParameterId: safety.nutritionLimits.minimumDailyEnergyParameterId,
    maximumWeeklyLossRatePercent: safety.nutritionLimits.maximumWeeklyLossRatePercent,
    maximumWeeklyLossRateParameterId: safety.nutritionLimits.maximumWeeklyLossRateParameterId,
  });
  if (!resolved.ok) return { ok: false, reasonCodes: resolved.reasonCodes };
  return { ok: true, parameters: resolved.parameters };
}
