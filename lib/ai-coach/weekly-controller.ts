import type { RunSnapshot } from "./run-command";
import { planPayloadSchema, type PlanPayload, type ReviewDecision } from "./plan-contract";
import { contentHash } from "./canonical-json";
import { reviewWindow } from "./review-window";
import { mealTargetsMatch } from "./representation";

/** Unit definitions and arithmetic, never policy. Any addition is a review decision. */
const STRUCTURAL = Object.freeze({
  MILLISECONDS_PER_DAY: 86400000,
  KILOGRAMS_PER_POUND: 0.45359237,
  PRESCRIPTION_ID_HASH_LENGTH: 32,
  PERCENT: 100,
});

function decision(
  action: ReviewDecision["action"],
  reason: ReviewDecision["reasonCodes"][number],
  explanation: string,
  changeClass: ReviewDecision["changeClass"] = null
): ReviewDecision {
  return {
    action,
    reasonCodes: [reason],
    explanation,
    changeClass,
    limitations: [
      "Synthetic controller and catalog; this result does not establish clinical suitability.",
      "Plan-following answers are self-reports, not measured intake or energy expenditure.",
    ],
    nextAction: changeClass
      ? "Wait for qualified review, then compare the proposal before accepting."
      : "Keep reporting what is known, including missing information and new concerns.",
  };
}

function none(
  action: ReviewDecision["action"],
  reason: ReviewDecision["reasonCodes"][number],
  text: string
) {
  return { payload: null, decision: decision(action, reason, text) };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function totals(plan: PlanPayload) {
  return {
    reps: plan.strength.reduce(
      (sum, session) =>
        sum +
        session.exercises.reduce((count, exercise) => count + exercise.sets * exercise.reps, 0),
      0
    ),
    sets: plan.strength.reduce(
      (sum, session) =>
        sum + session.exercises.reduce((count, exercise) => count + exercise.sets, 0),
      0
    ),
    cardio: plan.cardio.reduce((sum, session) => sum + session.durationMinutes, 0),
    energy: plan.nutrition?.targets.energyKcal ?? null,
  };
}

function lastMaterialNutritionDirection(
  snapshot: RunSnapshot
): "REDUCTION" | "NON_REDUCTION" | "NONE" {
  let prior: number | null = null;
  let direction: "REDUCTION" | "NON_REDUCTION" | "NONE" = "NONE";
  const history = [...snapshot.history].sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
  for (const version of history) {
    const energy = totals(version.payload).energy;
    if (energy === null) continue;
    if (prior !== null && energy !== prior)
      direction = energy < prior ? "REDUCTION" : "NON_REDUCTION";
    prior = energy;
  }
  return direction;
}

function isConsecutiveDeficit(snapshot: RunSnapshot, candidate: PlanPayload) {
  const before = snapshot.basePayload ? totals(snapshot.basePayload).energy : null;
  const after = totals(candidate).energy;
  return (
    before !== null &&
    after !== null &&
    after < before &&
    lastMaterialNutritionDirection(snapshot) === "REDUCTION"
  );
}

export function weeklyChangeWithinBounds(snapshot: RunSnapshot, candidate: PlanPayload): boolean {
  const base = snapshot.basePayload;
  const first = snapshot.history[0]?.payload;
  const weekly = snapshot.weeklyPolicy;
  if (
    !base ||
    !first ||
    !weekly ||
    weekly.status !== "RESOLVED" ||
    base.policyVersion !== candidate.policyVersion
  )
    return false;
  const parameters = weekly.parameters;
  const baseline = totals(first);
  const before = totals(base);
  const after = totals(candidate);
  const now = new Date(`${snapshot.reviewWindowKey}T00:00:00Z`).getTime();
  const material = snapshot.history.filter(
    (plan) => plan.changeClass === "ROUTINE" || plan.changeClass === "PROTECTIVE"
  );
  const dateLength = STRUCTURAL.PERCENT / (2 * (2 + 2 + 1));
  const age = (plan: (typeof material)[number]) =>
    (now -
      new Date(
        `${plan.reviewWindowKey ?? plan.acceptedAt.slice(0, dateLength)}T00:00:00Z`
      ).getTime()) /
    STRUCTURAL.MILLISECONDS_PER_DAY;
  if (
    material.some((plan) => age(plan) < parameters.cooldown.minDaysBetweenMaterialChanges) ||
    material.filter((plan) => age(plan) < parameters.cumulative.windowDays).length >=
      parameters.cumulative.maxMaterialChangesPerWindow
  )
    return false;
  const restriction =
    after.energy !== null && before.energy !== null && after.energy < before.energy;
  if (restriction && lastMaterialNutritionDirection(snapshot) === "REDUCTION") return false;
  const moreStrength = after.reps > before.reps || after.sets > before.sets;
  const moreCardio = after.cardio > before.cardio;
  if (
    Number(restriction) + Number(moreStrength) + Number(moreCardio) >
    parameters.cumulative.maxChangedDomainsPerReview
  )
    return false;
  if (
    (moreStrength || moreCardio) &&
    material.some((plan) => age(plan) < parameters.progression.minDaysBetweenIncreases)
  )
    return false;
  if (
    after.energy !== null &&
    baseline.energy !== null &&
    after.energy < baseline.energy * (1 - parameters.cumulative.maxEnergyReductionFraction)
  )
    return false;
  if (
    restriction &&
    after.energy! <
      before.energy! * (1 - parameters.adjustment.energyStepFraction) -
        parameters.adjustment.energyStepToleranceKcal
  )
    return false;
  if (
    after.cardio > baseline.cardio + parameters.progression.cardioMinutesMaxAboveInitial ||
    after.cardio > before.cardio + parameters.progression.cardioMinutesIncrement
  )
    return false;
  if (moreStrength) {
    for (const session of candidate.strength) {
      for (const exercise of session.exercises) {
        const original = first.strength
          .find((entry) => entry.sessionId === session.sessionId)
          ?.exercises.find((entry) => entry.exerciseId === exercise.exerciseId);
        const prior = base.strength
          .find((entry) => entry.sessionId === session.sessionId)
          ?.exercises.find((entry) => entry.exerciseId === exercise.exerciseId);
        if (
          !original ||
          !prior ||
          exercise.sets > prior.sets + parameters.progression.setsIncrement ||
          exercise.sets > original.sets + parameters.progression.setsMaxAboveInitial ||
          exercise.reps > prior.reps + parameters.progression.repsIncrement ||
          exercise.reps > original.reps + parameters.progression.repsMaxAboveInitial
        )
          return false;
      }
    }
  }
  return mealTargetsMatch(candidate, snapshot.intake);
}

function expectedWeekKeys(snapshot: RunSnapshot, count: number): string[] {
  const dateLength = STRUCTURAL.PERCENT / (2 * (2 + 2 + 1));
  return Array.from({ length: count }, (_, index) => {
    const expected = new Date(`${snapshot.reviewWindowKey}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() - 7 * (count - index));
    return expected.toISOString().slice(0, dateLength);
  });
}

function roundToDecimals(value: number, decimals: number): number {
  const multiplier = STRUCTURAL.PERCENT ** (decimals / 2);
  return Math.round(value * multiplier) / multiplier;
}

function scaleMeals(payload: PlanPayload, factor: number) {
  const gramStep = STRUCTURAL.PERCENT / (2 * 2 * (2 + 2 + 1));
  for (const day of payload.meals?.days ?? [])
    for (const meal of day.meals)
      for (const ingredient of meal.ingredients)
        ingredient.grams = Math.round((ingredient.grams * factor) / gramStep) * gramStep;
}

/** Deterministic coordinated review using only frozen parameters and product-collected evidence. */
export function buildWeeklyFixtureReview(snapshot: RunSnapshot): {
  payload: PlanPayload | null;
  decision: ReviewDecision;
} {
  const base = snapshot.basePayload;
  if (!base || !snapshot.history.length)
    return none(
      "CLARIFY",
      "MISSING_INPUT",
      "An accepted baseline and retained history are required."
    );
  const materialAt = snapshot.history
    .filter((plan) => plan.changeClass !== "TARGET_PRESERVING")
    .at(-1)?.acceptedAt;
  const baselineAt =
    materialAt && snapshot.lastSafetyResolutionAt && snapshot.lastSafetyResolutionAt > materialAt
      ? snapshot.lastSafetyResolutionAt
      : materialAt;
  if (!baselineAt)
    return none(
      "CLARIFY",
      "MISSING_INPUT",
      "The current prescription has no retained activation date."
    );
  const weekly = snapshot.weeklyPolicy;
  if (!weekly || weekly.status !== "RESOLVED")
    return none(
      "HOLD",
      "WEEKLY_PARAMETER_MISSING",
      "This review needs reviewed policy values that the current policy bundle does not provide. No change is proposed."
    );
  const parameters = weekly.parameters;
  if (
    base.nutrition?.method === "REVIEWED_PRESCRIPTION_V1" &&
    parameters.adjustment.energyMethod !== "REESTIMATE_FROM_CURRENT_WEIGHT"
  )
    return none(
      "HOLD",
      "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE",
      "The weekly nutrition adjustment rule needs bundle parameters this test policy does not yet provide."
    );

  const observations = snapshot.evidence.observations.filter((row) => row.occurredAt >= baselineAt);
  const sessions = snapshot.evidence.sessions.filter((row) => row.occurredAt >= baselineAt);
  if (
    observations.some((row) => row.payload.safetyChanged !== "NO") ||
    sessions.some((session) => session.painReported)
  )
    return none(
      "PAUSE_REFER",
      "SAFETY_CONCERN",
      "A reported concern needs authorized review before another plan change."
    );
  const priorWeek = new Date(`${snapshot.reviewWindowKey}T00:00:00Z`);
  priorWeek.setUTCDate(priorWeek.getUTCDate() - 7);
  const dateLength = STRUCTURAL.PERCENT / (2 * (2 + 2 + 1));
  const recent = observations.filter(
    (row) =>
      reviewWindow(new Date(row.occurredAt), snapshot.reviewTimezone).key ===
      priorWeek.toISOString().slice(0, dateLength)
  );
  if (!recent.length)
    return none(
      "CLARIFY",
      "MISSING_INPUT",
      "The most recent review week has no submitted check-in. Missing reports do not imply skipped activity or food restriction."
    );
  if (
    recent.some(
      (row) =>
        row.payload.energy === "LOW" ||
        row.payload.recovery === "POOR" ||
        row.payload.hunger === "HIGH"
    )
  )
    return none(
      "HOLD",
      "RECOVERY_CONCERN",
      "Energy, hunger or recovery needs attention. Weight changes do not justify increasing restriction or exercise in this state."
    );

  const grouped = new Map<string, typeof observations>();
  for (const row of observations) {
    const key = reviewWindow(new Date(row.occurredAt), snapshot.reviewTimezone).key;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const weeks = expectedWeekKeys(snapshot, parameters.evidence.minConsecutiveWeeks).map(
    (key) => [key, grouped.get(key) ?? []] as const
  );
  const uncovered = weeks.filter(([, rows]) => {
    const qualifying = rows.filter(
      (row) =>
        row.payload.completeness === "REPORTED_COMPLETE" &&
        row.payload.followingDays !== null &&
        row.payload.followingDays >= parameters.evidence.minPlanFollowingDays &&
        row.payload.energy === "OK" &&
        row.payload.recovery === "GOOD" &&
        row.payload.hunger === "MANAGEABLE" &&
        row.payload.barrier === "NONE"
    );
    return qualifying.length < parameters.evidence.minCompleteCheckInsPerWeek;
  }).length;
  const protectiveConcern = weeks.some(([, rows]) =>
    rows.some(
      (row) =>
        row.payload.energy === "LOW" ||
        row.payload.recovery === "POOR" ||
        row.payload.hunger === "HIGH"
    )
  );
  if (uncovered > parameters.evidence.maxMissingWeeks || protectiveConcern)
    return none(
      "HOLD",
      "INSUFFICIENT_EVIDENCE",
      "Three consecutive complete weeks with clear recovery and plan-following reports are required by this test policy. Missing values are not treated as zero."
    );

  let payload = structuredClone(base);
  let action: "SIMPLIFY" | "ADJUST" = "ADJUST";
  let reason: ReviewDecision["reasonCodes"][number] = "SUPPORTED_FIXTURE_CHANGE";
  let explanation = "";
  if (recent.some((row) => row.payload.barrier === "TIME")) {
    if (parameters.simplify.method === "RECOMPOSE_AT_FEWER_DAYS") {
      if (!weekly.simplifiedTraining)
        return none(
          "HOLD",
          "SCHEDULE_BARRIER",
          "The fixture catalog has no further validated simplification. Review your available time."
        );
      payload.strength = structuredClone(weekly.simplifiedTraining.strength);
      payload.cardio = structuredClone(weekly.simplifiedTraining.cardio);
    } else if (payload.strength.length > parameters.simplify.trainingDaysDecrement) {
      payload.strength = payload.strength.slice(0, -parameters.simplify.trainingDaysDecrement);
    } else if (
      payload.cardio.length &&
      payload.cardio[0].durationMinutes > parameters.simplify.cardioMinutesFloor
    ) {
      payload.cardio[0].durationMinutes -= Math.min(
        parameters.simplify.cardioMinutesDecrement,
        payload.cardio[0].durationMinutes - parameters.simplify.cardioMinutesFloor
      );
    } else
      return none(
        "HOLD",
        "SCHEDULE_BARRIER",
        "The fixture catalog has no further validated simplification. Review your available time."
      );
    action = "SIMPLIFY";
    reason = "SCHEDULE_BARRIER";
    explanation =
      "A reported time barrier supports a smaller training schedule. Nutrition and remaining session doses stay the same.";
  } else if (snapshot.intake.goal === "BODY_COMPOSITION" && payload.nutrition) {
    const weights = weeks.map(([, rows]) =>
      rows.flatMap((row) =>
        row.payload.weight?.comparableConditions
          ? [
              row.payload.weight.value *
                (row.payload.weight.unit === "LB" ? STRUCTURAL.KILOGRAMS_PER_POUND : 1),
            ]
          : []
      )
    );
    if (
      weights.some((week) => week.length < parameters.evidence.minComparableWeighInsPerWeek) ||
      weights.flat().length < parameters.evidence.minComparableWeighInsTotal
    )
      return none(
        "CLARIFY",
        "MISSING_INPUT",
        "Comparable measurements are missing for one or more weeks. No intake or expenditure is inferred."
      );
    const means = weights.map(median);
    const flat = weights.flat();
    const spread = (Math.max(...flat) - Math.min(...flat)) / median(flat);
    if (spread > parameters.evidence.maxComparableSpreadFraction)
      return none(
        "HOLD",
        "INSUFFICIENT_EVIDENCE",
        "Measurements are too variable for the synthetic adjustment rule."
      );
    if (
      Math.abs(means.at(-1)! - means[0]) / means[0] >
      parameters.evidence.plateauMaxRelativeChange
    )
      return none(
        "HOLD",
        "UNCHANGED",
        "The observed trend does not meet this test policy's adjustment condition."
      );

    let factor: number;
    if (parameters.adjustment.energyMethod === "REESTIMATE_FROM_CURRENT_WEIGHT") {
      if (!weekly.energyReestimate)
        return none(
          "HOLD",
          "WEEKLY_PARAMETER_MISSING",
          "This review needs reviewed policy values that the current policy bundle does not provide. No change is proposed."
        );
      const currentEnergy = payload.nutrition.targets.energyKcal;
      const proposedEnergy = weekly.energyReestimate.targets.energyKcal;
      if (
        Math.abs(proposedEnergy - currentEnergy) >
        currentEnergy * parameters.adjustment.energyStepFraction +
          parameters.adjustment.energyStepToleranceKcal
      )
        return none(
          "HOLD",
          "CUMULATIVE_LIMIT",
          "The retained history, cooldown or combined-change limit does not permit another material adjustment in this window."
        );
      factor = proposedEnergy / currentEnergy;
      payload.nutrition.targets = structuredClone(weekly.energyReestimate.targets);
    } else {
      factor = 1 - parameters.adjustment.energyStepFraction;
      for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const)
        payload.nutrition.targets[key] = roundToDecimals(
          payload.nutrition.targets[key] * factor,
          parameters.adjustment.macroGramDecimals
        );
    }
    if (payload.nutrition.targets.energyKcal < parameters.floors.minimumDailyEnergyKcal)
      return none(
        "HOLD",
        "NUTRITION_FLOOR_BLOCKED",
        "The proposed nutrition target would fall below the reviewed minimum daily energy. No change is proposed."
      );
    payload.nutrition.prescriptionId = `rx-${contentHash({
      base: snapshot.baseVersionId,
      window: snapshot.reviewWindowKey,
      sources: snapshot.sourceRefs,
    }).slice(0, STRUCTURAL.PRESCRIPTION_ID_HASH_LENGTH)}`;
    scaleMeals(payload, factor);
    explanation =
      "Comparable measurements and complete self-reports meet the synthetic plateau rule. A bounded nutrition proposal is prepared; strength and cardio do not increase.";
  } else if (snapshot.intake.goal === "STRENGTH" || snapshot.intake.goal === "ENDURANCE") {
    const modality = snapshot.intake.goal === "STRENGTH" ? "STRENGTH" : "CARDIO";
    const matching = sessions.filter(
      (session) => session.modality === modality && session.planVersionId === snapshot.baseVersionId
    );
    const supportedWeeks = weeks.slice(-parameters.progression.minCompleteSessionWeeks);
    const weeksSupported =
      supportedWeeks.length === parameters.progression.minCompleteSessionWeeks &&
      supportedWeeks.every(([key]) => {
        const records = matching.filter(
          (session) =>
            reviewWindow(new Date(session.occurredAt), snapshot.reviewTimezone).key === key
        );
        if (
          !records.length ||
          records.some(
            (session) =>
              session.resultStatus !== "REPORTED_COMPLETE" ||
              session.effortRating === null ||
              session.effortRating > parameters.progression.maxEffortRating ||
              session.painReported
          )
        )
          return false;
        if (modality === "CARDIO")
          return payload.cardio.every((prescribed) =>
            records.some(
              (session) =>
                session.prescriptionSessionId === prescribed.sessionId &&
                session.durationMinutes !== null &&
                session.durationMinutes >= prescribed.durationMinutes
            )
          );
        return payload.strength.every((prescribed) => {
          const prescribedSets = prescribed.exercises.reduce(
            (sum, exercise) => sum + exercise.sets,
            0
          );
          const completeSets = prescribed.exercises.reduce(
            (sum, exercise) =>
              sum +
              Array.from({ length: exercise.sets }, (_, setIndex) =>
                records.some(
                  (session) =>
                    session.prescriptionSessionId === prescribed.sessionId &&
                    session.exerciseId === exercise.exerciseId &&
                    session.setIndex === setIndex &&
                    session.reps !== null &&
                    session.reps >= exercise.reps
                )
              ).filter(Boolean).length,
            0
          );
          return completeSets / prescribedSets >= parameters.progression.minCompleteSetsFraction;
        });
      });
    if (!weeksSupported)
      return none(
        "HOLD",
        "INSUFFICIENT_EVIDENCE",
        "The accepted sessions need two weeks of complete, tolerable activity reports before this test progression."
      );
    if (modality === "STRENGTH" && payload.strength.length) {
      for (const session of payload.strength)
        for (const exercise of session.exercises)
          exercise.reps += parameters.progression.repsIncrement;
    } else if (modality === "CARDIO" && payload.cardio.length) {
      payload.cardio[0].durationMinutes += parameters.progression.cardioMinutesIncrement;
    } else return none("HOLD", "UNCHANGED", "There is no matching accepted activity to progress.");
    explanation =
      "Complete typed activity and recovery reports support a bounded progression in one training domain. Nutrition and the other training domain stay the same.";
  } else
    return none(
      "HOLD",
      "UNCHANGED",
      "The current plan can continue; this review does not require a numerical change."
    );

  const checked = planPayloadSchema.safeParse(payload);
  if (!checked.success || !mealTargetsMatch(payload, snapshot.intake))
    return none(
      "CLARIFY",
      "NO_FEASIBLE_MEALS",
      "The proposed change cannot be represented with validated practical portions and content."
    );
  payload = checked.data;
  if (isConsecutiveDeficit(snapshot, payload))
    return none(
      "HOLD",
      "CONSECUTIVE_DEFICIT_BLOCKED",
      "The last material nutrition change was already a calorie reduction. This test policy does not permit consecutive deficit changes."
    );
  if (!weeklyChangeWithinBounds(snapshot, payload))
    return none(
      "HOLD",
      "CUMULATIVE_LIMIT",
      "The retained history, cooldown or combined-change limit does not permit another material adjustment in this window."
    );
  return { payload, decision: decision(action, reason, explanation, "ROUTINE") };
}
