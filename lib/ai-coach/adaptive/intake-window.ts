/**
 * S-23 — the rolling window over the client's own nutrition log.
 *
 * Produces the two things the estimator needs: the mean daily energy over the
 * days the client declared FULLY logged, and the completeness of the window.
 *
 * THE DISTINCTION THIS MODULE EXISTS TO PRESERVE. A day the client marked
 * `SKIPPED` / `NONE` is a statement ("I did not log that day"); a day with no
 * row at all is the absence of a statement. They are counted separately and
 * both are reported, so no consumer can collapse them by accident. Only `FULL`
 * days count toward completeness and only `FULL` days enter the mean, exactly
 * as the architecture specifies — a `PARTIAL` day's number is real but is an
 * under-count by the client's own admission, and averaging it in would bias the
 * estimate downward, which is the failure mode the asymmetric gate exists to
 * prevent.
 *
 * Completeness is `FULL days / windowDays`, i.e. it is measured against the
 * whole window, so absent days count against it. That is deliberate: the
 * denominator must not shrink to whatever the client happened to submit.
 *
 * Pure: no I/O, no clock, no randomness. The window end date is an input.
 */

import type { AdaptiveConditionId, ResolvedAdaptiveParameters } from "./parameters";
import { epochDayFromIsoDate } from "./dates";

export type NutritionLogSource = "PLAN_AS_WRITTEN" | "PLAN_WITH_EDITS" | "MANUAL" | "SKIPPED";
export type NutritionLogCompleteness = "FULL" | "PARTIAL" | "NONE";

export type NutritionLogDay = {
  /** `YYYY-MM-DD`. */
  loggedOn: string;
  /** Null exactly when the client declared no coverage for the day. */
  energyKcal: number | null;
  source: NutritionLogSource;
  completeness: NutritionLogCompleteness;
};

export type IntakeWindowCounts = {
  /** Days in the window with a stored row of any kind. */
  declaredDays: number;
  /** Days in the window with no row at all — the absence of a statement. */
  absentDays: number;
  fullDays: number;
  partialDays: number;
  /** Days the client declared as having no coverage. */
  noneDays: number;
  /** Days whose source is `SKIPPED`. */
  skippedDays: number;
};

export type IntakeWindowResult =
  | {
      status: "AVAILABLE";
      windowStartDayIndex: number;
      windowEndDayIndex: number;
      windowDays: number;
      /** Mean `energyKcal` over the window's `FULL` days, kcal/day. */
      meanIntakeKcal: number;
      /** `fullDays / windowDays`. */
      completeness: number;
      counts: IntakeWindowCounts;
    }
  | { status: "UNAVAILABLE"; failedCondition: AdaptiveConditionId };

/**
 * @param logs the client's nutrition log rows; rows outside the window are
 *   ignored, so a caller may pass a longer history than the window needs.
 * @param windowEndOn the last day of the window, inclusive, as `YYYY-MM-DD`.
 */
export function computeIntakeWindow(
  logs: readonly NutritionLogDay[],
  windowEndOn: string,
  parameters: ResolvedAdaptiveParameters
): IntakeWindowResult {
  const windowEndDayIndex = epochDayFromIsoDate(windowEndOn);
  if (windowEndDayIndex === null) {
    return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_DATE_INVALID" };
  }
  const windowDays = parameters.windowDays;
  const windowStartDayIndex = windowEndDayIndex - windowDays + 1;

  const seenDays = new Set<number>();
  const counts: IntakeWindowCounts = {
    declaredDays: 0,
    absentDays: 0,
    fullDays: 0,
    partialDays: 0,
    noneDays: 0,
    skippedDays: 0,
  };
  let fullEnergyTotal = 0;

  for (const log of logs) {
    const dayIndex = epochDayFromIsoDate(log.loggedOn);
    if (dayIndex === null) {
      return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_DATE_INVALID" };
    }

    // The same invariants the table's CHECK constraints hold, re-asserted here
    // so a synthesized row cannot enter the estimator in a state the database
    // would have refused.
    const declaresCoverage = log.completeness !== "NONE";
    if (declaresCoverage) {
      if (log.energyKcal === null || !Number.isFinite(log.energyKcal) || log.energyKcal < 0) {
        return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_VALUE_INVALID" };
      }
    } else if (log.energyKcal !== null) {
      return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_VALUE_INVALID" };
    }

    if (dayIndex < windowStartDayIndex || dayIndex > windowEndDayIndex) continue;
    if (seenDays.has(dayIndex)) {
      return { status: "UNAVAILABLE", failedCondition: "INTAKE_SERIES_DUPLICATE_DAY" };
    }
    seenDays.add(dayIndex);

    counts.declaredDays += 1;
    if (log.source === "SKIPPED") counts.skippedDays += 1;
    if (log.completeness === "FULL") {
      counts.fullDays += 1;
      fullEnergyTotal += log.energyKcal ?? 0;
    } else if (log.completeness === "PARTIAL") {
      counts.partialDays += 1;
    } else {
      counts.noneDays += 1;
    }
  }

  counts.absentDays = windowDays - counts.declaredDays;

  if (counts.fullDays === 0) {
    return { status: "UNAVAILABLE", failedCondition: "INTAKE_WINDOW_NO_COMPLETE_DAYS" };
  }

  return {
    status: "AVAILABLE",
    windowStartDayIndex,
    windowEndDayIndex,
    windowDays,
    meanIntakeKcal: fullEnergyTotal / counts.fullDays,
    completeness: counts.fullDays / windowDays,
    counts,
  };
}
