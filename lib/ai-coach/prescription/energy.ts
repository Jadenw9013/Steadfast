import type { EnergyCoefficientSet, PopulationWithCoefficients, ResolvedPrescriptionParameters } from "./parameters";
import type { EnergyMethodPopulationCategory, PhysicalActivityCategory } from "./types";

/**
 * T-2032 — the frozen NASEM 2023 adult EER linear form
 * (board/tickets/T-2003.md "### The frozen equation structure") and the
 * (population, activity) coefficient-set lookup. Every coefficient is a
 * bundle numeric parameter (parameters.ts); nothing here is a clinical
 * constant. Division by 100 for `heightM` is the one unit conversion in the
 * engine and it is structural (cm -> m), not policy.
 */

const POPULATIONS_WITH_COEFFICIENTS: readonly PopulationWithCoefficients[] = [
  "MALE_ADULT",
  "FEMALE_ADULT",
];

/**
 * Supported population is derived from "a coefficient set exists in the
 * bundle", never a hardcoded list beyond the two keys `parameters.ts`
 * resolves (`PREGNANCY`/`LACTATION`/`NOT_LISTED` never gain one, by design).
 */
export function lookupEnergyCoefficients(
  parameters: ResolvedPrescriptionParameters,
  population: EnergyMethodPopulationCategory,
  activity: PhysicalActivityCategory
): EnergyCoefficientSet | null {
  if (!isPopulationWithCoefficients(population)) return null;
  return parameters.energyCoefficients[population][activity];
}

/** Population support alone, independent of activity — used by the early,
 * independent-collector population check (M5) so a null `physicalActivityCategory`
 * does not block reporting an unsupported population in the same pass. */
export function isPopulationWithCoefficients(
  population: EnergyMethodPopulationCategory
): population is PopulationWithCoefficients {
  return (POPULATIONS_WITH_COEFFICIENTS as readonly string[]).includes(population);
}

/** `NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1`, full float precision (step 5). */
export function computeMaintenanceEnergyKcalRaw(
  coefficients: EnergyCoefficientSet,
  ageYears: number,
  heightCm: number,
  weightKg: number
): number {
  const heightM = heightCm / 100;
  return (
    coefficients.intercept +
    coefficients.ageCoefficient * ageYears +
    coefficients.activityCoefficient *
      (coefficients.weightCoefficient * weightKg + coefficients.heightCoefficient * heightM)
  );
}

/**
 * Rounds `value` to `decimals` places, half away from zero. `decimals`
 * defaults to whole numbers (0 is a permitted structural literal). The base
 * of our number system (10) is the one further exception to the
 * "0/1/7/100 only" rule, alongside the three fixed payload-envelope
 * constants documented in parameters.ts — see the source-grep test.
 */
export function roundHalfAwayFromZero(value: number, decimals: number = 0): number {
  const factor = 10 ** decimals;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  // Normalize -0 to 0: a value that rounds to exactly zero from a negative
  // input must not carry a sign bit into JSON/byte-identity comparisons.
  return rounded === 0 ? 0 : rounded;
}

export function ceilToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor) / factor;
}

export function floorToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}

/** Step 9/10: round to the bundle's kcal step granularity. */
export function roundToStep(value: number, step: number): number {
  return roundHalfAwayFromZero(value / step) * step;
}

