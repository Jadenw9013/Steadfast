/**
 * S-23 — observed expenditure by energy-balance back-calculation.
 *
 * THE SIGN. Energy balance over a window is
 *
 *   intake − expenditure = energy stored = Δ body mass × ρ
 *
 * so
 *
 *   expenditure = intake − (Δ body mass × ρ) / days
 *
 * A client who LOST mass at a known intake burned MORE than they ate, so the
 * weight term is SUBTRACTED. `adaptive-energy-architecture.md` §Formulas and
 * `adaptive-energy-estimation.md` both write this with a `+`
 * (`TDEE_obs = mean(intake) + (trend_end − trend_start) × ρ / N`); that is an
 * error in the design documents, not a convention, and implementing it as
 * written would move every target in exactly the wrong direction. The
 * `recovers a controlled loss` vector in tests/unit/ai-coach-adaptive.test.ts
 * fails under the documents' sign and passes under this one.
 *
 * THE DENOMINATOR. The documents divide the weight term by `N`, the window
 * length. This divides by `spanDays`, the days actually elapsed between the
 * first and last smoothed weight point inside the window, because the intake
 * term is a per-day rate and the weight term must be the same per-day rate over
 * the same interval. With `N` in the denominator a client who weighed on day 20
 * and day 28 of a 28-day window would have their true 8-day rate reported as
 * 8/28 of itself. `spanDays ≤ N` always, and `spanDays = N` when the client
 * weighed on both window boundaries.
 *
 * THE CONFIDENCE. `slopeUncertaintyKcal = sqrt(P[1][1]) × ρ`. `P[1][1]` is the
 * variance of the velocity in (kg/day)², so its square root times ρ (kcal/kg)
 * is already kcal/day — the same unit as the answer and as
 * `ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL`. The documents' extra `/ N` on this
 * expression is dimensionally inconsistent (it would yield kcal/day²) and is
 * not applied; see the evidence file.
 *
 * ρ IS NOT 7700 AND IS NOT IN THIS FILE. It is the signed parameter
 * `ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG`, whose limitations (Hall 2008,
 * PMID 17848938) belong in the bundle beside the value the accountable owner
 * sets.
 *
 * Pure: no I/O, no clock, no randomness. The window end date is an input.
 */

import type { AdaptiveConditionId, ResolvedAdaptiveParameters } from "./parameters";
import { epochDayFromIsoDate } from "./dates";
import { computeIntakeWindow, type IntakeWindowResult, type NutritionLogDay } from "./intake-window";
import { computeWeightTrend, type WeightReading, type WeightTrendPoint } from "./weight-trend";

const TWO = 1 + 1;

export type ExpenditureEstimate =
  | {
      status: "AVAILABLE";
      /** `TDEE_obs`, kcal/day. */
      observedExpenditureKcal: number;
      /** Mean energy over the window's `FULL` days, kcal/day. */
      meanIntakeKcal: number;
      /** Smoothed mass at the last in-window point minus the first, kg. */
      weightChangeKg: number;
      /** `weightChangeKg / spanDays`, kg/day. */
      weightChangeKgPerDay: number;
      /** Days between the first and last smoothed weight point in the window. */
      spanDays: number;
      /** `sqrt(P[1][1]) × ρ`, kcal/day. */
      slopeUncertaintyKcal: number;
      /** `FULL days / windowDays`. */
      completeness: number;
      /**
       * Days from the earliest datum of any kind through the window end,
       * inclusive. Gate condition 1 compares this to `ADAPTIVE.WINDOW_DAYS`.
       */
      observedHistoryDays: number;
      trendStart: WeightTrendPoint;
      trendEnd: WeightTrendPoint;
      intake: Extract<IntakeWindowResult, { status: "AVAILABLE" }>;
    }
  | { status: "UNAVAILABLE"; failedCondition: AdaptiveConditionId };

export type ExpenditureInput = {
  weightReadings: readonly WeightReading[];
  nutritionLogs: readonly NutritionLogDay[];
  /** Last day of the window, inclusive, `YYYY-MM-DD`. */
  windowEndOn: string;
};

export function estimateObservedExpenditure(
  input: ExpenditureInput,
  parameters: ResolvedAdaptiveParameters
): ExpenditureEstimate {
  const windowEndDayIndex = epochDayFromIsoDate(input.windowEndOn);
  if (windowEndDayIndex === null) {
    return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_DATE_INVALID" };
  }
  const windowStartDayIndex = windowEndDayIndex - parameters.windowDays + 1;

  const intake = computeIntakeWindow(input.nutritionLogs, input.windowEndOn, parameters);
  if (intake.status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", failedCondition: intake.failedCondition };
  }

  // A reading dated after the window end must not inform the estimate.
  const usableReadings: WeightReading[] = [];
  let earliestDatumDayIndex: number | null = null;
  for (const reading of input.weightReadings) {
    const dayIndex = epochDayFromIsoDate(reading.measuredOn);
    if (dayIndex === null) {
      return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SERIES_DATE_INVALID" };
    }
    if (dayIndex > windowEndDayIndex) continue;
    usableReadings.push(reading);
    if (earliestDatumDayIndex === null || dayIndex < earliestDatumDayIndex) {
      earliestDatumDayIndex = dayIndex;
    }
  }
  for (const log of input.nutritionLogs) {
    const dayIndex = epochDayFromIsoDate(log.loggedOn);
    if (dayIndex === null) {
      return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_DATE_INVALID" };
    }
    if (dayIndex > windowEndDayIndex) continue;
    if (earliestDatumDayIndex === null || dayIndex < earliestDatumDayIndex) {
      earliestDatumDayIndex = dayIndex;
    }
  }

  const trend = computeWeightTrend(usableReadings, parameters);
  if (trend.status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", failedCondition: trend.failedCondition };
  }

  const inWindow = trend.points.filter(
    (point) => point.dayIndex >= windowStartDayIndex && point.dayIndex <= windowEndDayIndex
  );
  if (inWindow.length < TWO) {
    return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SPAN_INSUFFICIENT" };
  }
  const trendStart = inWindow[0];
  const trendEnd = inWindow[inWindow.length - 1];
  const spanDays = trendEnd.dayIndex - trendStart.dayIndex;
  if (spanDays <= 0) {
    return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SPAN_INSUFFICIENT" };
  }

  const density = parameters.energyDensityKcalPerKg;
  const weightChangeKg = trendEnd.trendKg - trendStart.trendKg;
  const weightChangeKgPerDay = weightChangeKg / spanDays;

  return {
    status: "AVAILABLE",
    observedExpenditureKcal: intake.meanIntakeKcal - weightChangeKgPerDay * density,
    meanIntakeKcal: intake.meanIntakeKcal,
    weightChangeKg,
    weightChangeKgPerDay,
    spanDays,
    slopeUncertaintyKcal: Math.sqrt(Math.max(trendEnd.velocityVariance, 0)) * density,
    completeness: intake.completeness,
    observedHistoryDays:
      earliestDatumDayIndex === null ? 0 : windowEndDayIndex - earliestDatumDayIndex + 1,
    trendStart,
    trendEnd,
    intake,
  };
}
