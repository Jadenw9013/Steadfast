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
 * meaning" for the floors) and §A1.4's "do not swallow `ArtifactLoadError`
 * here": this function does not catch anything `resolveNutritionSafetyPolicy`
 * or `getReviewedPolicyBundleContent` throw. A bundle with broken T-1003
 * hooks must fail the run, never yield a prescription computed without
 * floors. Review r1 NIT: the callers' existing `ArtifactLoadError` try/catch
 * blocks wrap only their `loadReviewedArtifactSet` call, **not** this one, so
 * a throw from here propagates uncaught — in `managed-executor.ts` to
 * `processManagedRun`'s catch (the run is recorded as a failed attempt) and
 * in `finalization.ts` out through `aiHttp` as a 503 anomaly. That is the
 * pre-existing behaviour of the `evaluateCurrentClientNutritionSafety` path
 * this reuses and is still the correct fail-closed outcome; it is documented
 * here so nobody reads this comment as a guarantee it does not make.
 */
export function resolvePrescriptionParametersForArtifacts(
  artifacts: ReviewedArtifactSet
): ResolvePrescriptionParametersForArtifactsResult {
  const policy = getReviewedPolicyBundleContent(artifacts.policy);
  const safety = resolveNutritionSafetyPolicy(policy);
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
