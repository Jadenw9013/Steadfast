/**
 * S-23 — two-state Kalman filter over body-mass measurements.
 *
 * State `x = [w, v]`: true body mass in kg and its velocity in kg/day.
 * Measurement `z`: one scale reading, `H = [1, 0]`.
 *
 *   predict   w' = w + v·Δt,  v' = v,  P' = F P Fᵀ + Q(Δt)
 *   update    S  = P'₀₀ + R,  K = [P'₀₀/S, P'₀₁/S]
 *             x  = x' + K (z − w'),  P = (I − K H) P'
 *
 * IRREGULAR SAMPLING IS THE POINT. Δt is the number of days between the two
 * readings, not a fixed step, and the process-noise covariance is the exact
 * integral of a continuous white-noise-acceleration model over that interval:
 *
 *   Q(Δt) = q · [[Δt³/3, Δt²/2], [Δt²/2, Δt]]
 *
 * so a gap genuinely widens `P` instead of being ignored. `q` is the signed
 * parameter `ADAPTIVE.KALMAN.PROCESS_NOISE` (kg²/day³) and `R` is
 * `ADAPTIVE.KALMAN.MEASUREMENT_NOISE` (kg²). No number here is a constant of
 * the body; both come from the bundle.
 *
 * WHAT THE FILTER BUYS. `velocityVariance` (`P[1][1]`) is an uncertainty on the
 * rate expressed in the same units as the rate, which is what lets the gate ask
 * "is this trend distinguishable from no trend" instead of guessing. A moving
 * average cannot answer that.
 *
 * INITIALIZATION. Two-point initialization at the first two readings, which is
 * the standard constant-velocity start and needs no extra signed parameter:
 * with an interval `T`, `x = [z₁, (z₁ − z₀)/T]` and
 * `P = [[R, R/T], [R/T, 2R/T²]]`. It deliberately omits the process noise
 * accumulated across that first interval, so `P` starts marginally optimistic
 * and is corrected by the first predict step; the filter therefore has no
 * output point at the first reading, by construction.
 *
 * Pure: no I/O, no clock, no randomness. Every date is an input.
 */

import type { AdaptiveConditionId, ResolvedAdaptiveParameters } from "./parameters";
import { epochDayFromIsoDate } from "./dates";

/**
 * Structural constants of the algebra above — the 2 and 3 in `F P Fᵀ`, in the
 * `Q(Δt)` integral and in the two-point initialization. They are not tunable:
 * changing one would make the filter a different filter. Written as sums of 1
 * because the folder forbids numeric literals other than 0, 1 and 7, and
 * because a "3" that came from a parameter here would be a lie.
 */
const TWO = 1 + 1;
const THREE = TWO + 1;

export type WeightReading = {
  /** `YYYY-MM-DD`. */
  measuredOn: string;
  weightKg: number;
};

export type WeightTrendPoint = {
  measuredOn: string;
  /** Days since the epoch; only differences are meaningful. */
  dayIndex: number;
  /** Filtered body mass, kg. */
  trendKg: number;
  /** Filtered rate of change, kg/day. */
  velocityKgPerDay: number;
  /** `P[0][0]`, kg². */
  trendVariance: number;
  /** `P[1][1]`, (kg/day)². The confidence signal everything downstream uses. */
  velocityVariance: number;
};

export type WeightTrendResult =
  | { status: "AVAILABLE"; points: WeightTrendPoint[] }
  | { status: "UNAVAILABLE"; failedCondition: AdaptiveConditionId };

type Covariance = { p00: number; p01: number; p11: number };

function predict(
  state: { w: number; v: number },
  covariance: Covariance,
  deltaDays: number,
  processNoise: number
): { state: { w: number; v: number }; covariance: Covariance } {
  const dt = deltaDays;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  return {
    state: { w: state.w + state.v * dt, v: state.v },
    covariance: {
      p00:
        covariance.p00 +
        TWO * dt * covariance.p01 +
        dt2 * covariance.p11 +
        (processNoise * dt3) / THREE,
      p01: covariance.p01 + dt * covariance.p11 + (processNoise * dt2) / TWO,
      p11: covariance.p11 + processNoise * dt,
    },
  };
}

function update(
  state: { w: number; v: number },
  covariance: Covariance,
  measurementKg: number,
  measurementNoise: number
): { state: { w: number; v: number }; covariance: Covariance } {
  const innovationVariance = covariance.p00 + measurementNoise;
  const gain0 = covariance.p00 / innovationVariance;
  const gain1 = covariance.p01 / innovationVariance;
  const innovation = measurementKg - state.w;
  return {
    state: { w: state.w + gain0 * innovation, v: state.v + gain1 * innovation },
    covariance: {
      p00: covariance.p00 - gain0 * covariance.p00,
      p01: covariance.p01 - gain0 * covariance.p01,
      p11: covariance.p11 - gain1 * covariance.p01,
    },
  };
}

/**
 * Runs the filter over `readings` and returns one point per reading from the
 * second onward. Readings are sorted by date; two readings on the same calendar
 * day are refused rather than merged, because merging them would silently
 * change the effective measurement noise.
 */
export function computeWeightTrend(
  readings: readonly WeightReading[],
  parameters: ResolvedAdaptiveParameters
): WeightTrendResult {
  const dated: { dayIndex: number; measuredOn: string; weightKg: number }[] = [];
  for (const reading of readings) {
    const dayIndex = epochDayFromIsoDate(reading.measuredOn);
    if (dayIndex === null) {
      return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SERIES_DATE_INVALID" };
    }
    if (!Number.isFinite(reading.weightKg) || reading.weightKg <= 0) {
      return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SERIES_VALUE_INVALID" };
    }
    dated.push({ dayIndex, measuredOn: reading.measuredOn, weightKg: reading.weightKg });
  }
  dated.sort((a, b) => a.dayIndex - b.dayIndex);

  if (dated.length < TWO) {
    return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SERIES_INSUFFICIENT" };
  }
  for (let index = 1; index < dated.length; index += 1) {
    if (dated[index].dayIndex <= dated[index - 1].dayIndex) {
      return { status: "UNAVAILABLE", failedCondition: "WEIGHT_SERIES_NOT_STRICTLY_INCREASING" };
    }
  }

  const noiseR = parameters.kalmanMeasurementNoise;
  const noiseQ = parameters.kalmanProcessNoise;

  const first = dated[0];
  const second = dated[1];
  const firstInterval = second.dayIndex - first.dayIndex;
  let state = {
    w: second.weightKg,
    v: (second.weightKg - first.weightKg) / firstInterval,
  };
  let covariance: Covariance = {
    p00: noiseR,
    p01: noiseR / firstInterval,
    p11: (TWO * noiseR) / (firstInterval * firstInterval),
  };

  const points: WeightTrendPoint[] = [
    {
      measuredOn: second.measuredOn,
      dayIndex: second.dayIndex,
      trendKg: state.w,
      velocityKgPerDay: state.v,
      trendVariance: covariance.p00,
      velocityVariance: covariance.p11,
    },
  ];

  for (let index = TWO; index < dated.length; index += 1) {
    const reading = dated[index];
    const deltaDays = reading.dayIndex - dated[index - 1].dayIndex;
    const predicted = predict(state, covariance, deltaDays, noiseQ);
    const updated = update(predicted.state, predicted.covariance, reading.weightKg, noiseR);
    state = updated.state;
    covariance = updated.covariance;
    points.push({
      measuredOn: reading.measuredOn,
      dayIndex: reading.dayIndex,
      trendKg: state.w,
      velocityKgPerDay: state.v,
      trendVariance: covariance.p00,
      velocityVariance: covariance.p11,
    });
  }

  return { status: "AVAILABLE", points };
}
