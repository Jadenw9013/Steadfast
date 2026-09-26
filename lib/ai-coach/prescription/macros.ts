import { ceilToDecimals, floorToDecimals, roundHalfAwayFromZero } from "./energy";
import { proteinParameterId } from "./parameters";
import type { ResolvedPrescriptionParameters } from "./parameters";
import type { ResistanceTrainingContext } from "./types";

/**
 * T-2032 — protein from g/kg by `resistanceTrainingContext`, carbohydrate
 * and fat AMDR-compatible gram ranges rounded inward, and the step-14
 * feasibility check (board/tickets/T-2003.md steps 11-14).
 */

export type ProteinResult = { proteinG: number; appliedBoundIds: string[] };

/** Step 11: clamp at full precision into [MIN,MAX]*weightKg, then round. */
export function computeProtein(
  parameters: ResolvedPrescriptionParameters,
  context: ResistanceTrainingContext,
  weightKg: number
): ProteinResult {
  const bounds = parameters.protein[context];
  const rawTarget = weightKg * bounds.target;
  const minG = weightKg * bounds.min;
  const maxG = weightKg * bounds.max;
  const appliedBoundIds: string[] = [];
  let clamped = rawTarget;
  if (clamped < minG) {
    clamped = minG;
    appliedBoundIds.push(proteinParameterId(context, "MIN"));
  } else if (clamped > maxG) {
    clamped = maxG;
    appliedBoundIds.push(proteinParameterId(context, "MAX"));
  }
  const proteinG = roundHalfAwayFromZero(clamped, parameters.rounding.macroGramsDecimals);
  return { proteinG, appliedBoundIds };
}

export type MacroRange = { min: number; max: number };

/** Step 13: AMDR-compatible gram ranges, rounded inward (min ceils, max floors). */
export function computeCarbohydrateRangeG(
  parameters: ResolvedPrescriptionParameters,
  targetEnergyKcal: number
): MacroRange {
  const { min, max } = parameters.carbohydratePercentEnergy;
  const kcalPerG = parameters.energyDensityKcalPerG.carbohydrate;
  const decimals = parameters.rounding.macroGramsDecimals;
  return {
    min: ceilToDecimals((targetEnergyKcal * (min / 100)) / kcalPerG, decimals),
    max: floorToDecimals((targetEnergyKcal * (max / 100)) / kcalPerG, decimals),
  };
}

export function computeFatRangeG(
  parameters: ResolvedPrescriptionParameters,
  targetEnergyKcal: number
): MacroRange {
  const { min, max } = parameters.fatPercentEnergy;
  const kcalPerG = parameters.energyDensityKcalPerG.fat;
  const decimals = parameters.rounding.macroGramsDecimals;
  return {
    min: ceilToDecimals((targetEnergyKcal * (min / 100)) / kcalPerG, decimals),
    max: floorToDecimals((targetEnergyKcal * (max / 100)) / kcalPerG, decimals),
  };
}

/** Step 14 (GAP-N05 §5): true when no gram split can satisfy every macro range at once. */
export function macroRangesAreInfeasible(
  parameters: ResolvedPrescriptionParameters,
  targetEnergyKcal: number,
  proteinEnergyKcal: number,
  carbRange: MacroRange,
  fatRange: MacroRange
): boolean {
  const kcalPerGCarb = parameters.energyDensityKcalPerG.carbohydrate;
  const kcalPerGFat = parameters.energyDensityKcalPerG.fat;
  if (carbRange.min > carbRange.max) return true;
  if (fatRange.min > fatRange.max) return true;
  const minPossible =
    proteinEnergyKcal + carbRange.min * kcalPerGCarb + fatRange.min * kcalPerGFat;
  const maxPossible =
    proteinEnergyKcal + carbRange.max * kcalPerGCarb + fatRange.max * kcalPerGFat;
  if (minPossible > targetEnergyKcal) return true;
  if (maxPossible < targetEnergyKcal) return true;
  return false;
}
