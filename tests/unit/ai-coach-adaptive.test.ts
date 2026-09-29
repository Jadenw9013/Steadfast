/**
 * S-23 — adaptive energy estimation, phases 1 and 2 plus the pure estimator.
 *
 * NOTHING IN `lib/ai-coach/adaptive/` IS WIRED TO ANYTHING. Section 7 proves
 * that with a source scan: no module outside tests and the validation harness
 * imports the folder, and the weekly controller's `energyMethod` enum still has
 * exactly its two existing values. Phase 4 is a separate ticket.
 *
 * EVERY PARAMETER VALUE IN THIS FILE IS A SYNTHETIC TEST VALUE. ρ is 1000
 * kcal/kg here precisely so that nobody can mistake it for a clinical figure;
 * the real `ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG` is the accountable owner's to
 * sign and this repository supplies no value for it. The numbers below exercise
 * arithmetic, not physiology.
 *
 * THE GOLDEN VECTORS (sections 2 and 4) were computed by an independent
 * re-statement of the architecture's algebra, not by the module under test; the
 * script and its raw output are in `board/evidence/S-23-adaptive.md`. Each one
 * carries its derivation in a comment so a reviewer can re-derive it by hand.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { PolicyBundleContent } from "@/lib/ai-coach/artifacts/schema";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { resolvedWeeklyParametersSchema } from "@/lib/ai-coach/weekly-parameters";
import {
  ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID,
  ADAPTIVE_PARAMETER_IDS,
  resolveAdaptiveParameters,
  type ResolvedAdaptiveParameters,
} from "@/lib/ai-coach/adaptive/parameters";
import { computeWeightTrend, type WeightReading } from "@/lib/ai-coach/adaptive/weight-trend";
import {
  computeIntakeWindow,
  type NutritionLogDay,
} from "@/lib/ai-coach/adaptive/intake-window";
import { estimateObservedExpenditure } from "@/lib/ai-coach/adaptive/expenditure";
import { evaluateAdaptiveGate } from "@/lib/ai-coach/adaptive/gate";

const REPO_ROOT = path.resolve(__dirname, "../..");
const ADAPTIVE_DIR = path.resolve(REPO_ROOT, "lib/ai-coach/adaptive");

/* --------------------------------------------------------------- fixtures */

/** SYNTHETIC test values. Not clinical constants. See the file header. */
const SYNTHETIC_ADAPTIVE_VALUES: Record<string, { value: number; unit: string }> = {
  "ADAPTIVE.KALMAN.PROCESS_NOISE": { value: 0.0004, unit: "KG2_PER_DAY3" },
  "ADAPTIVE.KALMAN.MEASUREMENT_NOISE": { value: 0.25, unit: "KG2" },
  "ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG": { value: 1000, unit: "KCAL_PER_KG" },
  "ADAPTIVE.WINDOW_DAYS": { value: 28, unit: "DAYS" },
  "ADAPTIVE.MIN_COMPLETENESS": { value: 0.5, unit: "FRACTION_OF_WINDOW_DAYS" },
  "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION": { value: 0.8, unit: "FRACTION_OF_WINDOW_DAYS" },
  "ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL": { value: 60, unit: "KCAL_PER_DAY" },
  "ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL": { value: 25, unit: "KCAL_PER_DAY" },
};

function bundleWithoutAdaptive(): PolicyBundleContent {
  const set = buildSyntheticArtifactSet("s23-adaptive");
  return structuredClone(set.policyBundle.content) as PolicyBundleContent;
}

function bundleWithAdaptive(
  overrides: Record<string, Partial<{ value: number; unit: string; omit: boolean }>> = {},
  options: { declareRule?: boolean } = {}
): PolicyBundleContent {
  const policy = bundleWithoutAdaptive();
  if (options.declareRule !== false) {
    policy.ruleIds.push(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);
    policy.adjustmentRuleIds.push(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);
  }
  for (const [id, spec] of Object.entries(SYNTHETIC_ADAPTIVE_VALUES)) {
    const override = overrides[id] ?? {};
    if (override.omit) continue;
    policy.numericParameters.push({
      id,
      value: override.value ?? spec.value,
      unit: override.unit ?? spec.unit,
      applicabilityRuleIds: [ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID],
      evidenceClaimIds: ["synthetic-evidence-claim"],
    });
  }
  return policy;
}

function syntheticParameters(
  overrides: Record<string, Partial<{ value: number; unit: string }>> = {}
): ResolvedAdaptiveParameters {
  const resolved = resolveAdaptiveParameters(bundleWithAdaptive(overrides));
  if (!resolved.ok) throw new Error(`fixture did not resolve: ${resolved.missingParameterIds}`);
  return resolved.parameters;
}

/** Relative comparison so a pinned 17-significant-digit vector stays exact. */
function expectPinned(actual: number, pinned: number, relativeTolerance = 1e-12): void {
  const denominator = Math.abs(pinned) === 0 ? 1 : Math.abs(pinned);
  expect(Math.abs(actual - pinned) / denominator).toBeLessThan(relativeTolerance);
}

function isoDay(offsetDays: number): string {
  // Day 0 is 2026-01-01. Pure: no clock is read.
  return new Date(Date.UTC(2026, 0, 1) + offsetDays * 86400000).toISOString().slice(0, 10);
}

function flatWeights(days: number[], kg: number): WeightReading[] {
  return days.map((day) => ({ measuredOn: isoDay(day), weightKg: kg }));
}

function linearWeights(startKg: number, ratePerDay: number, days: number): WeightReading[] {
  return Array.from({ length: days }, (_unused, day) => ({
    measuredOn: isoDay(day),
    weightKg: startKg + ratePerDay * day,
  }));
}

function fullLogs(energyKcal: number, days: number, fromDay = 0): NutritionLogDay[] {
  return Array.from({ length: days }, (_unused, index) => ({
    loggedOn: isoDay(fromDay + index),
    energyKcal,
    source: "PLAN_AS_WRITTEN" as const,
    completeness: "FULL" as const,
  }));
}

/* ------------------------------------------------------ 1. the resolver */

describe("S-23 §1 — ADAPTIVE parameter resolver (T-2032 total-resolver pattern)", () => {
  it("declares exactly the nine ids on the accountable owner's worksheet", () => {
    expect(ADAPTIVE_PARAMETER_IDS).toEqual([
      "ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG",
      "ADAPTIVE.KALMAN.MEASUREMENT_NOISE",
      "ADAPTIVE.KALMAN.PROCESS_NOISE",
      "ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL",
      "ADAPTIVE.MIN_COMPLETENESS",
      "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION",
      "ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL",
      "ADAPTIVE.RULE.OBSERVED_EXPENDITURE.V1",
      "ADAPTIVE.WINDOW_DAYS",
    ]);
    expect(ADAPTIVE_PARAMETER_IDS.length).toBe(9);
  });

  it("refuses, listing all nine sorted ids, against a bundle that does not contain them — which is every bundle in this repository today", () => {
    const result = resolveAdaptiveParameters(bundleWithoutAdaptive());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reasonCodes).toEqual(["ADAPTIVE_PARAMETER_MISSING"]);
    expect(result.missingParameterIds).toEqual([...ADAPTIVE_PARAMETER_IDS]);
    expect(result.missingParameterIds).toEqual([...result.missingParameterIds].sort());
  });

  it("supplies no value of its own: the resolver source declares ids and units only", () => {
    const source = fs.readFileSync(path.join(ADAPTIVE_DIR, "parameters.ts"), "utf8");
    for (const id of Object.keys(SYNTHETIC_ADAPTIVE_VALUES)) {
      expect(source).toContain(id);
    }
    // The purity scan in §8 is the general form of this: no numeric literal
    // other than 0, 1 and 7 exists anywhere in the folder, so there is nowhere
    // a default value could hide.
    expect(source).not.toContain("7700");
  });

  it("refuses when a single parameter is absent, and names only that one plus nothing else", () => {
    const result = resolveAdaptiveParameters(
      bundleWithAdaptive({ "ADAPTIVE.WINDOW_DAYS": { omit: true } })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.missingParameterIds).toEqual(["ADAPTIVE.WINDOW_DAYS"]);
  });

  it("refuses when the rule id is not declared as an adjustment rule", () => {
    const result = resolveAdaptiveParameters(bundleWithAdaptive({}, { declareRule: false }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.missingParameterIds).toContain(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);
  });

  it("separates a present-but-wrong value from an absent one", () => {
    const result = resolveAdaptiveParameters(
      bundleWithAdaptive({ "ADAPTIVE.KALMAN.MEASUREMENT_NOISE": { unit: "KG" } })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reasonCodes).toEqual(["ADAPTIVE_PARAMETER_INCOMPATIBLE"]);
    expect(result.missingParameterIds).toEqual(["ADAPTIVE.KALMAN.MEASUREMENT_NOISE"]);
  });

  it("refuses a bundle whose reduction threshold is not strictly stricter — the asymmetry is an invariant, not a preference", () => {
    for (const reductionValue of [0.5, 0.4]) {
      const result = resolveAdaptiveParameters(
        bundleWithAdaptive({ "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION": { value: reductionValue } })
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reasonCodes).toEqual(["ADAPTIVE_PARAMETER_INCOMPATIBLE"]);
      expect(result.missingParameterIds).toEqual([
        "ADAPTIVE.MIN_COMPLETENESS",
        "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION",
      ]);
    }
  });

  it("never throws, whatever the bundle contains", () => {
    const wrecked = bundleWithAdaptive();
    wrecked.numericParameters = [];
    wrecked.ruleIds = [];
    wrecked.adjustmentRuleIds = [];
    expect(() => resolveAdaptiveParameters(wrecked)).not.toThrow();
  });

  it("resolves a complete bundle and digests the parameter set", () => {
    const first = syntheticParameters();
    const second = syntheticParameters();
    expect(first.parameterSetDigest).toBe(second.parameterSetDigest);
    expect(first.ruleId).toBe(ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID);
    const moved = syntheticParameters({ "ADAPTIVE.WINDOW_DAYS": { value: 21 } });
    expect(moved.parameterSetDigest).not.toBe(first.parameterSetDigest);
  });
});

/* ---------------------------------------- 2. weight trend, golden vector 1 */

describe("S-23 §2 — Kalman weight trend under irregular sampling", () => {
  const parameters = syntheticParameters();

  /**
   * GOLDEN VECTOR 1 — a gap widens the covariance.
   *
   * Both series are 31 readings of a perfectly constant 80.000 kg. They are
   * identical for the first 30 readings, one per day on days 0..29, so the
   * filter is in its converged regime by the end of them. They differ only in
   * when the 31st reading arrives: day 30 (Δt = 1) or day 37 (Δt = 8).
   *
   * Derivation, with q = 0.0004 kg²/day³ and R = 0.25 kg², from the predict
   * step alone:
   *
   *   P'₁₁ = P₁₁ + q·Δt          Δt=1 → +0.0004      Δt=8 → +0.0032
   *   P'₀₀ = P₀₀ + 2Δt·P₀₁ + Δt²·P₁₁ + q·Δt³/3
   *
   * so the predicted covariance is unambiguously larger after the gap
   * (P'₁₁ 3.041880e-3 vs 5.841880e-3; P'₀₀ 8.179114e-2 vs 4.380586e-1), and
   * the single measurement that follows does not take all of it back. The
   * post-update numbers below are what the module returns.
   *
   * The velocity variance is 21% larger and the trend variance 158% larger
   * after the gap. Expressed in the unit the gate uses, the slope uncertainty
   * rises from 51.39 to 56.58 kcal/day at ρ = 1000 kcal/kg.
   */
  it("golden vector 1: an 8-day gap widens both variances relative to a 1-day step", () => {
    const established = Array.from({ length: 30 }, (_unused, day) => day);
    const noGap = computeWeightTrend(flatWeights([...established, 30], 80), parameters);
    const gap = computeWeightTrend(flatWeights([...established, 37], 80), parameters);
    if (noGap.status !== "AVAILABLE" || gap.status !== "AVAILABLE") {
      throw new Error("both series must be available");
    }
    const lastNoGap = noGap.points[noGap.points.length - 1];
    const lastGap = gap.points[gap.points.length - 1];

    expectPinned(lastNoGap.velocityVariance, 0.0026408952338215826);
    expectPinned(lastNoGap.trendVariance, 0.061628485314487405);
    expectPinned(lastGap.velocityVariance, 0.0032009545098543018);
    expectPinned(lastGap.trendVariance, 0.15916471531149390);

    expect(lastGap.velocityVariance).toBeGreaterThan(lastNoGap.velocityVariance);
    expect(lastGap.trendVariance).toBeGreaterThan(lastNoGap.trendVariance);

    const density = parameters.energyDensityKcalPerKg;
    expectPinned(Math.sqrt(lastNoGap.velocityVariance) * density, 51.389641308551496);
    expectPinned(Math.sqrt(lastGap.velocityVariance) * density, 56.576978620763249);
  });

  /**
   * The honest caveat on vector 1, measured rather than asserted. The
   * architecture says "a gap widens P". That is unconditionally true of the
   * PREDICT step and of the trend variance, and it is true of the velocity
   * variance once the filter has converged (the vector above). It is NOT
   * universally true of the post-update velocity variance early in a series:
   * with only four readings, a long final interval gives a longer baseline
   * between position measurements, which is more informative about velocity,
   * and P₁₁ after the update comes out about ten times SMALLER. The trend
   * variance still widens (0.1750 → 0.2441), so the gate's own signal never
   * moves the wrong way on a short history without the velocity term also
   * being enormous. Recorded so nobody later "fixes" the filter to match a
   * sentence in the design document.
   */
  it("records the early-series exception to vector 1 rather than hiding it", () => {
    const shortNoGap = computeWeightTrend(flatWeights([0, 1, 2, 3], 80), parameters);
    const shortGap = computeWeightTrend(flatWeights([0, 1, 2, 10], 80), parameters);
    if (shortNoGap.status !== "AVAILABLE" || shortGap.status !== "AVAILABLE") {
      throw new Error("both series must be available");
    }
    const a = shortNoGap.points[shortNoGap.points.length - 1];
    const b = shortGap.points[shortGap.points.length - 1];
    expectPinned(a.velocityVariance, 0.050397196837480687);
    expectPinned(b.velocityVariance, 0.0052210397379213597);
    expect(b.velocityVariance).toBeLessThan(a.velocityVariance);
    expect(b.trendVariance).toBeGreaterThan(a.trendVariance);
  });

  it("tracks a noiseless straight line exactly and reports its true velocity", () => {
    const result = computeWeightTrend(linearWeights(80, -0.1, 28), parameters);
    if (result.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    const last = result.points[result.points.length - 1];
    expectPinned(last.velocityKgPerDay, -0.1, 1e-12);
    expectPinned(last.trendKg, 77.3, 1e-12);
  });

  it("emits one point per reading from the second onward", () => {
    const result = computeWeightTrend(flatWeights([0, 1, 2, 3, 4], 80), parameters);
    if (result.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(result.points.map((point) => point.measuredOn)).toEqual([1, 2, 3, 4].map(isoDay));
  });

  it("is order-insensitive: an unsorted series gives the sorted series' answer", () => {
    const readings = linearWeights(80, -0.1, 10);
    const shuffled = [readings[4], readings[0], readings[9], ...readings.slice(1, 4), ...readings.slice(5, 9)];
    const sorted = computeWeightTrend(readings, parameters);
    const unsorted = computeWeightTrend(shuffled, parameters);
    expect(unsorted).toEqual(sorted);
  });

  it.each([
    ["fewer than two readings", [{ measuredOn: isoDay(0), weightKg: 80 }], "WEIGHT_SERIES_INSUFFICIENT"],
    [
      "two readings on the same day",
      [
        { measuredOn: isoDay(0), weightKg: 80 },
        { measuredOn: isoDay(0), weightKg: 80.4 },
      ],
      "WEIGHT_SERIES_NOT_STRICTLY_INCREASING",
    ],
    [
      "a date that is not on the calendar",
      [
        { measuredOn: "2026-02-30", weightKg: 80 },
        { measuredOn: isoDay(1), weightKg: 80 },
      ],
      "WEIGHT_SERIES_DATE_INVALID",
    ],
    [
      "a non-positive mass",
      [
        { measuredOn: isoDay(0), weightKg: 0 },
        { measuredOn: isoDay(1), weightKg: 80 },
      ],
      "WEIGHT_SERIES_VALUE_INVALID",
    ],
  ])("refuses with a named condition: %s", (_label, readings, condition) => {
    const result = computeWeightTrend(readings as WeightReading[], parameters);
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(result.failedCondition).toBe(condition);
  });
});

/* --------------------------------------------------- 3. the intake window */

describe("S-23 §3 — intake window: SKIPPED and NONE are first-class", () => {
  const parameters = syntheticParameters();

  it("counts a declared no-coverage day as declared, and a day with no row as absent", () => {
    const logs: NutritionLogDay[] = [
      ...fullLogs(2400, 20, 0),
      // Days 20..23: the client said they did not log. This is information.
      ...[20, 21, 22, 23].map((day) => ({
        loggedOn: isoDay(day),
        energyKcal: null,
        source: "SKIPPED" as const,
        completeness: "NONE" as const,
      })),
      // Days 24..25: partially logged, by the client's own declaration.
      ...[24, 25].map((day) => ({
        loggedOn: isoDay(day),
        energyKcal: 900,
        source: "MANUAL" as const,
        completeness: "PARTIAL" as const,
      })),
      // Days 26..27: no row at all. This is the absence of information.
    ];
    const result = computeIntakeWindow(logs, isoDay(27), parameters);
    if (result.status !== "AVAILABLE") throw new Error("expected AVAILABLE");

    expect(result.counts).toEqual({
      declaredDays: 26,
      absentDays: 2,
      fullDays: 20,
      partialDays: 2,
      noneDays: 4,
      skippedDays: 4,
    });
    expect(result.counts.declaredDays + result.counts.absentDays).toBe(result.windowDays);
    // A SKIPPED day is not an absent day, and vice versa.
    expect(result.counts.noneDays).not.toBe(result.counts.absentDays);
  });

  it("averages only FULL days: a PARTIAL day's under-count never enters the mean", () => {
    const logs: NutritionLogDay[] = [
      ...fullLogs(2400, 14, 0),
      ...Array.from({ length: 14 }, (_unused, index) => ({
        loggedOn: isoDay(14 + index),
        energyKcal: 600,
        source: "MANUAL" as const,
        completeness: "PARTIAL" as const,
      })),
    ];
    const result = computeIntakeWindow(logs, isoDay(27), parameters);
    if (result.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(result.meanIntakeKcal).toBe(2400);
    expect(result.completeness).toBeCloseTo(14 / 28, 12);
  });

  it("measures completeness against the whole window, not against what was submitted", () => {
    const result = computeIntakeWindow(fullLogs(2400, 7, 21), isoDay(27), parameters);
    if (result.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(result.completeness).toBeCloseTo(7 / 28, 12);
  });

  it("ignores rows outside the window so a caller may pass a longer history", () => {
    const result = computeIntakeWindow(fullLogs(2400, 60, -32), isoDay(27), parameters);
    if (result.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(result.counts.declaredDays).toBe(28);
    expect(result.completeness).toBe(1);
  });

  it.each([
    [
      "two rows for one day",
      [...fullLogs(2400, 3, 0), { loggedOn: isoDay(1), energyKcal: 1800, source: "MANUAL" as const, completeness: "FULL" as const }],
      "INTAKE_SERIES_DUPLICATE_DAY",
    ],
    [
      "a declared-coverage day with no energy value",
      [{ loggedOn: isoDay(0), energyKcal: null, source: "MANUAL" as const, completeness: "FULL" as const }],
      "INTAKE_SERIES_VALUE_INVALID",
    ],
    [
      "a declared no-coverage day that still carries numbers",
      [{ loggedOn: isoDay(0), energyKcal: 2400, source: "SKIPPED" as const, completeness: "NONE" as const }],
      "INTAKE_SERIES_VALUE_INVALID",
    ],
    [
      "a window with no FULL day at all",
      [{ loggedOn: isoDay(0), energyKcal: null, source: "SKIPPED" as const, completeness: "NONE" as const }],
      "INTAKE_WINDOW_NO_COMPLETE_DAYS",
    ],
    [
      "a date that is not on the calendar",
      [{ loggedOn: "2026-13-01", energyKcal: 2400, source: "MANUAL" as const, completeness: "FULL" as const }],
      "INTAKE_SERIES_DATE_INVALID",
    ],
  ])("refuses with a named condition: %s", (_label, logs, condition) => {
    const result = computeIntakeWindow(logs as NutritionLogDay[], isoDay(27), parameters);
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(result.failedCondition).toBe(condition);
  });
});

/* -------------------------------------- 4. expenditure, golden vectors 2-3 */

describe("S-23 §4 — observed expenditure", () => {
  const parameters = syntheticParameters();

  /**
   * GOLDEN VECTOR 2 — constant weight plus constant intake gives an
   * expenditure estimate equal to intake.
   *
   * 28 daily readings of a flat 80.000 kg and 28 FULL days at 2400 kcal.
   * The filter's trend is 80.000 at both the first in-window point (day 1) and
   * the last (day 27), so
   *
   *   Δtrend = 0,  rate = 0/26 = 0 kg/day,
   *   TDEE_obs = 2400 − 0 × 1000 = 2400 kcal/day exactly.
   *
   * The slope uncertainty at that point is sqrt(2.6442358051290164e-3) × 1000
   * = 51.422133416740074 kcal/day, i.e. "zero, plus or minus 51 kcal/day".
   */
  it("golden vector 2: constant weight and constant intake ⇒ TDEE_obs = intake", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: flatWeights(Array.from({ length: 28 }, (_unused, day) => day), 80),
        nutritionLogs: fullLogs(2400, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(estimate.weightChangeKg).toBe(0);
    expect(estimate.spanDays).toBe(26);
    expect(estimate.observedExpenditureKcal).toBe(2400);
    expectPinned(estimate.slopeUncertaintyKcal, 51.422133416740074);
    expect(estimate.completeness).toBe(1);
    expect(estimate.observedHistoryDays).toBe(28);
  });

  /**
   * GOLDEN VECTOR 3a — a controlled loss at a known intake recovers the true
   * expenditure exactly when the scale is noiseless.
   *
   * Ground truth: expenditure 2300 kcal/day, intake 2200 kcal/day, so the daily
   * deficit is 100 kcal. At ρ = 1000 kcal/kg that is exactly 0.1 kg/day of
   * mass, so the generated series is w(d) = 80 − 0.1·d for d = 0..27.
   *
   * A constant-velocity Kalman filter follows a straight line with zero
   * innovation after initialization, so trend(day 1) = 79.9 and
   * trend(day 27) = 77.3:
   *
   *   rate = (77.3 − 79.9) / 26 = −0.1 kg/day
   *   TDEE_obs = 2200 − (−0.1 × 1000) = 2300 kcal/day
   *
   * Tolerance: 1e-9 kcal/day (floating-point only; the recovery is exact).
   *
   * THE SIGN. The architecture and research documents write this term with a
   * `+`. Under that sign the same vector yields 2200 − 100 = 2100 kcal/day for
   * a client who is losing mass, i.e. it would conclude that a client burning
   * 2300 burns 2100 and would cut their food further. The assertion below is
   * the proof that the documents' sign is wrong.
   */
  it("golden vector 3a: a noiseless controlled loss recovers the true expenditure to 1e-9 kcal/day", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: linearWeights(80, -0.1, 28),
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expectPinned(estimate.trendStart.trendKg, 79.9);
    expectPinned(estimate.trendEnd.trendKg, 77.3);
    expect(estimate.spanDays).toBe(26);
    expectPinned(estimate.weightChangeKgPerDay, -0.1);
    expect(Math.abs(estimate.observedExpenditureKcal - 2300)).toBeLessThan(1e-9);
    // The documents' sign would land here instead:
    expect(Math.abs(estimate.observedExpenditureKcal - 2100)).toBeGreaterThan(100);
  });

  /**
   * GOLDEN VECTOR 3b — the same controlled loss through a noisy scale.
   *
   * The same ground truth (expenditure 2300, intake 2200, true rate
   * −0.1 kg/day) with a fixed, checked-in measurement-error series of 28
   * offsets between −0.35 and +0.33 kg — a pinned sequence, not a generator,
   * so the vector is reproducible by hand. The filter's endpoints become
   * 79.680000000000007 and 77.254160676808738, so
   *
   *   rate = −2.425839323191269 / 26 = −0.093301512430433428 kg/day
   *   TDEE_obs = 2200 + 93.301512430433428 = 2293.3015124304334 kcal/day
   *
   * Stated tolerance: 7 kcal/day against the true 2300 (the measured error is
   * 6.6984875695666233). At this noise level the estimate is 0.29% low.
   */
  it("golden vector 3b: a noisy controlled loss recovers the true expenditure to within 7 kcal/day", () => {
    const NOISE_KG = [
      0.3, -0.22, 0.14, -0.35, 0.28, -0.11, 0.19, -0.27, 0.33, -0.16, 0.21, -0.3, 0.12, -0.24,
      0.26, -0.18, 0.31, -0.13, 0.17, -0.29, 0.23, -0.2, 0.15, -0.34, 0.25, -0.12, 0.18, -0.26,
    ];
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: NOISE_KG.map((offset, day) => ({
          measuredOn: isoDay(day),
          weightKg: 80 - 0.1 * day + offset,
        })),
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expectPinned(estimate.trendStart.trendKg, 79.680000000000007);
    expectPinned(estimate.trendEnd.trendKg, 77.254160676808738);
    expectPinned(estimate.weightChangeKgPerDay, -0.093301512430433428);
    expectPinned(estimate.observedExpenditureKcal, 2293.3015124304334);
    expect(Math.abs(estimate.observedExpenditureKcal - 2300)).toBeLessThan(7);
  });

  it("ignores a weight reading dated after the window end", () => {
    const readings = [...linearWeights(80, -0.1, 28), { measuredOn: isoDay(40), weightKg: 60 }];
    const withFuture = estimateObservedExpenditure(
      { weightReadings: readings, nutritionLogs: fullLogs(2200, 28, 0), windowEndOn: isoDay(27) },
      parameters
    );
    const withoutFuture = estimateObservedExpenditure(
      {
        weightReadings: linearWeights(80, -0.1, 28),
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    expect(withFuture).toEqual(withoutFuture);
  });

  it("refuses when fewer than two smoothed weight points fall inside the window", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: flatWeights([-40, -39], 80),
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    expect(estimate.status).toBe("UNAVAILABLE");
    if (estimate.status !== "UNAVAILABLE") throw new Error("unreachable");
    expect(estimate.failedCondition).toBe("WEIGHT_SPAN_INSUFFICIENT");
  });
});

/* ----------------------------------------------- 5. the gate, vector 4 */

describe("S-23 §5 — the fail-closed gate", () => {
  const parameters = syntheticParameters();

  /** 18 FULL days out of 28 ⇒ completeness 0.642857…, between 0.5 and 0.8. */
  function betweenThresholdsLogs(energyKcal: number): NutritionLogDay[] {
    return [
      ...fullLogs(energyKcal, 18, 0),
      ...Array.from({ length: 10 }, (_unused, index) => ({
        loggedOn: isoDay(18 + index),
        energyKcal: null,
        source: "SKIPPED" as const,
        completeness: "NONE" as const,
      })),
    ];
  }

  function gateFor(ratePerDay: number, intakeKcal: number, currentEnergyKcal: number) {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: linearWeights(80, ratePerDay, 28),
        nutritionLogs: betweenThresholdsLogs(intakeKcal),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    return { estimate, decision: evaluateAdaptiveGate(estimate, currentEnergyKcal, parameters) };
  }

  /**
   * GOLDEN VECTOR 4 — the asymmetry, on one completeness value.
   *
   * Completeness is 18/28 = 0.6428571428571429: above
   * ADAPTIVE.MIN_COMPLETENESS (0.5) and below
   * ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION (0.8).
   *
   * Mirror-image evidence, same completeness, same slope uncertainty
   * (51.422133416740074 kcal/day, below the 60 threshold), same |difference|:
   *
   *   losing  0.1 kg/day at 2200 intake → TDEE_obs = 2300, current 2200
   *                                     → +100 kcal → INCREASE → PROPOSE
   *   gaining 0.1 kg/day at 2200 intake → TDEE_obs = 2100, current 2200
   *                                     → −100 kcal → DECREASE → HOLD
   *
   * The only thing that differs is the direction, which is the whole point:
   * under-logging biases the estimate downward, so a reduction on thin data
   * must fail safe while an increase on the identical evidence does not.
   */
  it("golden vector 4: at completeness between the two thresholds, the upward proposal passes", () => {
    const { estimate, decision } = gateFor(-0.1, 2200, 2200);
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(estimate.completeness).toBeCloseTo(18 / 28, 12);
    expect(estimate.completeness).toBeGreaterThan(parameters.minCompleteness);
    expect(estimate.completeness).toBeLessThan(parameters.minCompletenessForReduction);
    expectPinned(estimate.slopeUncertaintyKcal, 51.422133416740074);
    expect(Math.abs(estimate.observedExpenditureKcal - 2300)).toBeLessThan(1e-9);

    expect(decision.decision).toBe("PROPOSE");
    if (decision.decision !== "PROPOSE") throw new Error("unreachable");
    expect(decision.direction).toBe("INCREASE");
    expect(Math.abs(decision.proposedExpenditureKcal - 2300)).toBeLessThan(1e-9);
  });

  it("golden vector 4: on mirror-image evidence the downward proposal is held, naming the condition", () => {
    const { estimate, decision } = gateFor(0.1, 2200, 2200);
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(Math.abs(estimate.observedExpenditureKcal - 2100)).toBeLessThan(1e-9);

    expect(decision.decision).toBe("HOLD");
    if (decision.decision !== "HOLD") throw new Error("unreachable");
    expect(decision.reasonCode).toBe("ADAPTIVE_INSUFFICIENT_EVIDENCE");
    expect(decision.failedCondition).toBe("COMPLETENESS_BELOW_REDUCTION_MINIMUM");
    // A HOLD still reports what it saw: absence of evidence is explainable.
    expect(decision.observedExpenditureKcal).not.toBeNull();
    expect(decision.completeness).toBeCloseTo(18 / 28, 12);
  });

  it("permits the same downward proposal once completeness clears the stricter threshold", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: linearWeights(80, 0.1, 28),
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    const decision = evaluateAdaptiveGate(estimate, 2200, parameters);
    expect(decision.decision).toBe("PROPOSE");
    if (decision.decision !== "PROPOSE") throw new Error("unreachable");
    expect(decision.direction).toBe("DECREASE");
  });

  it("condition 1: holds when the observed history is shorter than the window", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: linearWeights(80, -0.1, 14).map((reading, day) => ({
          ...reading,
          measuredOn: isoDay(14 + day),
        })),
        nutritionLogs: fullLogs(2200, 14, 14),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(estimate.observedHistoryDays).toBe(14);
    const decision = evaluateAdaptiveGate(estimate, 2200, parameters);
    expect(decision.decision).toBe("HOLD");
    if (decision.decision !== "HOLD") throw new Error("unreachable");
    expect(decision.failedCondition).toBe("WINDOW_HISTORY_INSUFFICIENT");
  });

  it("condition 2: holds when completeness is below the minimum", () => {
    const logs = [
      ...fullLogs(2200, 10, 0),
      ...Array.from({ length: 18 }, (_unused, index) => ({
        loggedOn: isoDay(10 + index),
        energyKcal: null,
        source: "SKIPPED" as const,
        completeness: "NONE" as const,
      })),
    ];
    const estimate = estimateObservedExpenditure(
      { weightReadings: linearWeights(80, -0.1, 28), nutritionLogs: logs, windowEndOn: isoDay(27) },
      parameters
    );
    const decision = evaluateAdaptiveGate(estimate, 2200, parameters);
    expect(decision.decision).toBe("HOLD");
    if (decision.decision !== "HOLD") throw new Error("unreachable");
    expect(decision.failedCondition).toBe("COMPLETENESS_BELOW_MINIMUM");
  });

  it("condition 3: holds when the slope uncertainty exceeds the maximum", () => {
    const estimate = estimateObservedExpenditure(
      {
        // Three readings one day apart: the filter has a second output point
        // (so the span is defined) but almost no information about velocity.
        weightReadings: [
          { measuredOn: isoDay(0), weightKg: 80 },
          { measuredOn: isoDay(1), weightKg: 79.5 },
          { measuredOn: isoDay(2), weightKg: 80.2 },
        ],
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    if (estimate.status !== "AVAILABLE") throw new Error("expected AVAILABLE");
    expect(estimate.slopeUncertaintyKcal).toBeGreaterThan(parameters.maxSlopeUncertaintyKcal);
    const decision = evaluateAdaptiveGate(estimate, 2200, parameters);
    expect(decision.decision).toBe("HOLD");
    if (decision.decision !== "HOLD") throw new Error("unreachable");
    expect(decision.failedCondition).toBe("SLOPE_UNCERTAINTY_ABOVE_MAXIMUM");
  });

  it("condition 4: holds when the disagreement is not material", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: flatWeights(Array.from({ length: 28 }, (_unused, day) => day), 80),
        nutritionLogs: fullLogs(2400, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    const decision = evaluateAdaptiveGate(estimate, 2400, parameters);
    expect(decision.decision).toBe("HOLD");
    if (decision.decision !== "HOLD") throw new Error("unreachable");
    expect(decision.failedCondition).toBe("DIFFERENCE_NOT_MATERIAL");
    expect(decision.differenceKcal).toBe(0);
  });

  it("propagates an unavailable estimate as a named HOLD rather than a bare refusal", () => {
    const decision = evaluateAdaptiveGate(
      { status: "UNAVAILABLE", failedCondition: "INTAKE_WINDOW_NO_COMPLETE_DAYS" },
      2200,
      parameters
    );
    expect(decision.decision).toBe("HOLD");
    if (decision.decision !== "HOLD") throw new Error("unreachable");
    expect(decision.reasonCode).toBe("ADAPTIVE_INSUFFICIENT_EVIDENCE");
    expect(decision.failedCondition).toBe("INTAKE_WINDOW_NO_COMPLETE_DAYS");
    expect(decision.observedExpenditureKcal).toBeNull();
  });

  it("holds when the current energy target is not a positive number", () => {
    const estimate = estimateObservedExpenditure(
      {
        weightReadings: linearWeights(80, -0.1, 28),
        nutritionLogs: fullLogs(2200, 28, 0),
        windowEndOn: isoDay(27),
      },
      parameters
    );
    for (const current of [0, -1, Number.NaN]) {
      const decision = evaluateAdaptiveGate(estimate, current, parameters);
      expect(decision.decision).toBe("HOLD");
      if (decision.decision !== "HOLD") throw new Error("unreachable");
      expect(decision.failedCondition).toBe("CURRENT_ENERGY_NOT_POSITIVE");
    }
  });
});

/* ------------------------------------------- 6. determinism and purity of I/O */

describe("S-23 §6 — determinism", () => {
  it("returns identical output for identical input across repeated calls", () => {
    const parameters = syntheticParameters();
    const input = {
      weightReadings: linearWeights(80, -0.1, 28),
      nutritionLogs: fullLogs(2200, 28, 0),
      windowEndOn: isoDay(27),
    };
    const first = estimateObservedExpenditure(input, parameters);
    const second = estimateObservedExpenditure(input, parameters);
    expect(second).toEqual(first);
  });
});

/* ------------------------------------ 7. nothing acts on a client (rule 10) */

describe("S-23 §7 — the estimator is wired to nothing", () => {
  const PRODUCT_DIRS = ["lib", "app", "components", "hooks", "types"];

  function sourceFiles(dir: string): string[] {
    const absolute = path.resolve(REPO_ROOT, dir);
    if (!fs.existsSync(absolute)) return [];
    const out: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "generated") continue;
          walk(next);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          out.push(next);
        }
      }
    };
    walk(absolute);
    return out;
  }

  it("no product module imports lib/ai-coach/adaptive", () => {
    const importers: string[] = [];
    for (const dir of PRODUCT_DIRS) {
      for (const file of sourceFiles(dir)) {
        if (file.startsWith(ADAPTIVE_DIR + path.sep)) continue;
        const content = fs.readFileSync(file, "utf8");
        if (/from\s+["'][^"']*ai-coach\/adaptive/.test(content)) {
          importers.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(importers).toEqual([]);
  });

  it("the weekly controller's energyMethod still has exactly its two existing values", () => {
    const options = resolvedWeeklyParametersSchema.shape.adjustment.shape.energyMethod.options;
    expect([...options].sort()).toEqual(["REESTIMATE_FROM_CURRENT_WEIGHT", "RELATIVE_STEP"]);
    expect(options).not.toContain("ADAPTIVE_OBSERVED_EXPENDITURE");
  });

  it("no source file mentions the phase-4 energy method value", () => {
    const mentions: string[] = [];
    for (const dir of PRODUCT_DIRS) {
      for (const file of sourceFiles(dir)) {
        // The quoted enum value, not the rule-id constant name in parameters.ts.
        if (/["']ADAPTIVE_OBSERVED_EXPENDITURE["']/.test(fs.readFileSync(file, "utf8"))) {
          mentions.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(mentions).toEqual([]);
  });
});

/* ------------------------------------------------------------ 8. purity */

describe("S-23 §8 — module purity (strict AST checks over lib/ai-coach/adaptive)", () => {
  const ALLOWED_NUMERIC_LITERALS = new Set(["0", "1", "7"]);
  const ALLOWED_LONG_STRINGS = new Set([
    "ADAPTIVE_PARAMETER_MISSING",
    "ADAPTIVE_PARAMETER_INCOMPATIBLE",
    "ADAPTIVE_INSUFFICIENT_EVIDENCE",
    "WINDOW_HISTORY_INSUFFICIENT",
    "COMPLETENESS_BELOW_MINIMUM",
    "SLOPE_UNCERTAINTY_ABOVE_MAXIMUM",
    "DIFFERENCE_NOT_MATERIAL",
    "COMPLETENESS_BELOW_REDUCTION_MINIMUM",
    "WEIGHT_SERIES_DATE_INVALID",
    "WEIGHT_SERIES_VALUE_INVALID",
    "WEIGHT_SERIES_INSUFFICIENT",
    "WEIGHT_SERIES_NOT_STRICTLY_INCREASING",
    "WEIGHT_SPAN_INSUFFICIENT",
    "INTAKE_SERIES_DATE_INVALID",
    "INTAKE_SERIES_DUPLICATE_DAY",
    "INTAKE_SERIES_VALUE_INVALID",
    "INTAKE_WINDOW_NO_COMPLETE_DAYS",
    "CURRENT_ENERGY_NOT_POSITIVE",
  ]);

  const adaptiveFiles = fs
    .readdirSync(ADAPTIVE_DIR)
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => path.join(ADAPTIVE_DIR, file));

  it("contains exactly the six declared modules", () => {
    expect(adaptiveFiles.map((file) => path.basename(file))).toEqual([
      "dates.ts",
      "expenditure.ts",
      "gate.ts",
      "intake-window.ts",
      "parameters.ts",
      "weight-trend.ts",
    ]);
  });

  it("contains NO numeric literals other than 0, 1 and 7", () => {
    const offenders: string[] = [];
    for (const file of adaptiveFiles) {
      const content = fs.readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isNumericLiteral(node) && !ALLOWED_NUMERIC_LITERALS.has(node.text)) {
          offenders.push(`${path.basename(file)}: numeric literal ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
    }
    expect(offenders).toEqual([]);
  });

  it("contains NO string literals > 30 chars outside reason codes, condition ids, parameter ids and import paths", () => {
    const offenders: string[] = [];
    for (const file of adaptiveFiles) {
      const content = fs.readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const text = node.text;
          if (text.length > 30) {
            const isImport =
              node.parent &&
              (ts.isImportDeclaration(node.parent) ||
                ts.isExportDeclaration(node.parent) ||
                ts.isExternalModuleReference(node.parent));
            const isKnown = ALLOWED_LONG_STRINGS.has(text) || text.startsWith("ADAPTIVE.");
            if (!isImport && !isKnown) {
              offenders.push(`${path.basename(file)}: string literal > 30 chars: "${text}"`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
    }
    expect(offenders).toEqual([]);
  });

  it("never constructs a Number from a string literal", () => {
    const offenders: string[] = [];
    for (const file of adaptiveFiles) {
      if (/Number\s*\(\s*[`'"]/.test(fs.readFileSync(file, "utf8"))) {
        offenders.push(path.basename(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  /** Comments describe what the modules must not do, so they are stripped first. */
  function withoutComments(content: string): string {
    return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("reads no clock, no randomness, no environment and no database", () => {
    const forbidden: [RegExp, string][] = [
      [/Date\.now\s*\(/, "Date.now()"],
      [/new\s+Date\s*\(\s*\)/, "new Date() with no argument"],
      [/Math\.random\s*\(/, "Math.random()"],
      [/performance\.now\s*\(/, "performance.now()"],
      [/process\.env/, "process.env"],
      [/\brequire\s*\(/, "require()"],
      [/from\s+["'][^"']*\/db["']/, "a database import"],
      [/from\s+["'][^"']*prisma[^"']*["']/, "a Prisma import"],
      [/from\s+["']node:/, "a node builtin import"],
    ];
    const offenders: string[] = [];
    for (const file of adaptiveFiles) {
      const content = withoutComments(fs.readFileSync(file, "utf8"));
      for (const [pattern, label] of forbidden) {
        if (pattern.test(content)) offenders.push(`${path.basename(file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
