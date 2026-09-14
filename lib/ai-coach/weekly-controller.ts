import type { RunSnapshot } from "./run-command";
import { planPayloadSchema, type PlanPayload, type ReviewDecision } from "./plan-contract";
import { contentHash } from "./canonical-json";
import { reviewWindow } from "./review-window";
import { mealTargetsMatch } from "./representation";

/** SYNTHETIC TEST POLICY ONLY. These engineering constants are not clinical
 * recommendations. Managed execution requires a synthetic account, explicit
 * fixture mode and a nonproduction runtime. G01/G02 must replace this bundle.
 */
export const WEEKLY_FIXTURE_POLICY = Object.freeze({ version: "weekly-fixture-v1", minimumWeeks: 3, followingDays: 5, plateauFraction: 0.005, noisyFraction: 0.02, nutritionStep: 0.03, maximumCumulativeRestriction: 0.10, cooldownDays: 14, maximumChangesIn28Days: 2, maximumRepsAboveInitial: 2, cardioStepMinutes: 2, maximumCardioAboveInitial: 6 });
const day = 86400000;
function decision(action: ReviewDecision["action"], reason: ReviewDecision["reasonCodes"][number], explanation: string, changeClass: ReviewDecision["changeClass"] = null): ReviewDecision {
  return { action, reasonCodes: [reason], explanation, changeClass, limitations: ["Synthetic controller and catalog; this result does not establish clinical suitability.", "Plan-following answers are self-reports, not measured intake or energy expenditure."], nextAction: changeClass ? "Wait for qualified review, then compare the proposal before accepting." : "Keep reporting what is known, including missing information and new concerns." };
}
function none(action: ReviewDecision["action"], reason: ReviewDecision["reasonCodes"][number], text: string) { return { payload: null, decision: decision(action, reason, text) }; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function totals(plan: PlanPayload) { return { reps: plan.strength.reduce((sum, s) => sum + s.exercises.reduce((n, e) => n + e.sets * e.reps, 0), 0), cardio: plan.cardio.reduce((sum, s) => sum + s.durationMinutes, 0), energy: plan.nutrition?.targets.energyKcal ?? null }; }
export function weeklyChangeWithinBounds(snapshot: RunSnapshot, candidate: PlanPayload): boolean {
  const base = snapshot.basePayload; const first = snapshot.history[0]?.payload;
  if (!base || !first || base.policyVersion !== candidate.policyVersion) return false;
  const baseline = totals(first), before = totals(base), after = totals(candidate);
  const now = new Date(`${snapshot.reviewWindowKey}T00:00:00Z`).getTime();
  const material = snapshot.history.filter(p => p.changeClass === "ROUTINE" || p.changeClass === "PROTECTIVE");
  // Compare canonical calendar weeks, never device travel or time since a retry.
  const age = (p: typeof material[number]) => (now - new Date(`${p.reviewWindowKey ?? p.acceptedAt.slice(0, 10)}T00:00:00Z`).getTime()) / day;
  if (material.some(p => age(p) < WEEKLY_FIXTURE_POLICY.cooldownDays) || material.filter(p => age(p) < 28).length >= WEEKLY_FIXTURE_POLICY.maximumChangesIn28Days) return false;
  const restriction = after.energy !== null && before.energy !== null && after.energy < before.energy;
  const moreStrength = after.reps > before.reps, moreCardio = after.cardio > before.cardio;
  if (Number(restriction) + Number(moreStrength) + Number(moreCardio) > 1) return false;
  if (after.energy !== null && baseline.energy !== null && after.energy < baseline.energy * (1 - WEEKLY_FIXTURE_POLICY.maximumCumulativeRestriction)) return false;
  if (restriction && after.energy! < before.energy! * (1 - WEEKLY_FIXTURE_POLICY.nutritionStep) - 0.2) return false;
  if (after.cardio > baseline.cardio + WEEKLY_FIXTURE_POLICY.maximumCardioAboveInitial || after.cardio > before.cardio + WEEKLY_FIXTURE_POLICY.cardioStepMinutes) return false;
  for (const session of candidate.strength) for (const exercise of session.exercises) {
    const original = first.strength.find(s => s.sessionId === session.sessionId)?.exercises.find(e => e.exerciseId === exercise.exerciseId);
    const prior = base.strength.find(s => s.sessionId === session.sessionId)?.exercises.find(e => e.exerciseId === exercise.exerciseId);
    if (!original || !prior || exercise.sets > prior.sets || exercise.reps > prior.reps + 1 || exercise.reps > original.reps + WEEKLY_FIXTURE_POLICY.maximumRepsAboveInitial) return false;
  }
  return mealTargetsMatch(candidate, snapshot.intake);
}

/** Deterministic coordinated review using only fields collected by the product.
 * Raw notes never change a decision and the model cannot choose numeric doses.
 */
export function buildWeeklyFixtureReview(snapshot: RunSnapshot): { payload: PlanPayload | null; decision: ReviewDecision } {
  const base = snapshot.basePayload;
  if (!base || !snapshot.history.length) return none("CLARIFY", "MISSING_INPUT", "An accepted baseline and retained history are required.");
  const materialAt = snapshot.history.filter(p => p.changeClass !== "TARGET_PRESERVING").at(-1)?.acceptedAt;
  const baselineAt = materialAt && snapshot.lastSafetyResolutionAt && snapshot.lastSafetyResolutionAt > materialAt ? snapshot.lastSafetyResolutionAt : materialAt;
  if (!baselineAt) return none("CLARIFY", "MISSING_INPUT", "The current prescription has no retained activation date.");
  const observations = snapshot.evidence.observations.filter(r => r.occurredAt >= baselineAt);
  const sessions = snapshot.evidence.sessions.filter(r => r.occurredAt >= baselineAt);
  if (observations.some(r => r.payload.safetyChanged !== "NO") || sessions.some(s => s.painReported)) return none("PAUSE_REFER", "SAFETY_CONCERN", "A reported concern needs authorized review before another plan change.");
  const priorWeek = new Date(`${snapshot.reviewWindowKey}T00:00:00Z`); priorWeek.setUTCDate(priorWeek.getUTCDate() - 7);
  const recent = observations.filter(r => reviewWindow(new Date(r.occurredAt), snapshot.reviewTimezone).key === priorWeek.toISOString().slice(0, 10));
  if (!recent.length) return none("CLARIFY", "MISSING_INPUT", "The most recent review week has no submitted check-in. Missing reports do not imply skipped activity or food restriction.");
  if (recent.some(r => r.payload.energy === "LOW" || r.payload.recovery === "POOR" || r.payload.hunger === "HIGH")) return none("HOLD", "RECOVERY_CONCERN", "Energy, hunger or recovery needs attention. Weight changes do not justify increasing restriction or exercise in this state.");
  let payload = structuredClone(base);
  let action: "SIMPLIFY" | "ADJUST" = "ADJUST";
  let reason: ReviewDecision["reasonCodes"][number] = "SUPPORTED_FIXTURE_CHANGE";
  let explanation = "";
  if (recent.some(r => r.payload.barrier === "TIME")) {
    if (payload.strength.length > 1) payload.strength = payload.strength.slice(0, -1);
    else if (payload.cardio.length && payload.cardio[0].durationMinutes > 5) payload.cardio[0].durationMinutes -= Math.min(5, payload.cardio[0].durationMinutes - 5);
    else return none("HOLD", "SCHEDULE_BARRIER", "The fixture catalog has no further validated simplification. Review your available time.");
    action = "SIMPLIFY"; reason = "SCHEDULE_BARRIER"; explanation = "A reported time barrier supports a smaller training schedule. Nutrition and remaining session doses stay the same.";
  } else {
    const grouped = new Map<string, typeof observations>();
    for (const row of observations) { const key = reviewWindow(new Date(row.occurredAt), snapshot.reviewTimezone).key; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
    const weeks = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-WEEKLY_FIXTURE_POLICY.minimumWeeks);
    const complete = weeks.length === WEEKLY_FIXTURE_POLICY.minimumWeeks && weeks.every(([key, rows], index) => {
      const expected = new Date(`${snapshot.reviewWindowKey}T00:00:00Z`); expected.setUTCDate(expected.getUTCDate() - 7 * (WEEKLY_FIXTURE_POLICY.minimumWeeks - index));
      return key === expected.toISOString().slice(0, 10) && rows.every(r => r.payload.completeness === "REPORTED_COMPLETE" && r.payload.followingDays !== null && r.payload.followingDays >= WEEKLY_FIXTURE_POLICY.followingDays && r.payload.energy === "OK" && r.payload.recovery === "GOOD" && r.payload.hunger === "MANAGEABLE" && r.payload.barrier === "NONE");
    });
    if (!complete) return none("HOLD", "INSUFFICIENT_EVIDENCE", "Three consecutive complete weeks with clear recovery and plan-following reports are required by this test policy. Missing values are not treated as zero.");
    if (snapshot.intake.goal === "BODY_COMPOSITION" && payload.nutrition) {
      const weights = weeks.map(([, rows]) => rows.flatMap(r => r.payload.weight?.comparableConditions ? [r.payload.weight.value * (r.payload.weight.unit === "LB" ? 0.45359237 : 1)] : []));
      if (weights.some(w => !w.length)) return none("CLARIFY", "MISSING_INPUT", "Comparable measurements are missing for one or more weeks. No intake or expenditure is inferred.");
      const means = weights.map(median); const flat = weights.flat(); const spread = (Math.max(...flat) - Math.min(...flat)) / median(flat);
      if (spread > WEEKLY_FIXTURE_POLICY.noisyFraction) return none("HOLD", "INSUFFICIENT_EVIDENCE", "Measurements are too variable for the synthetic adjustment rule.");
      if (Math.abs(means.at(-1)! - means[0]) / means[0] > WEEKLY_FIXTURE_POLICY.plateauFraction) return none("HOLD", "UNCHANGED", "The observed trend does not meet this test policy's adjustment condition.");
      const factor = 1 - WEEKLY_FIXTURE_POLICY.nutritionStep;
      payload.nutrition.prescriptionId = `rx-${contentHash({ base: snapshot.baseVersionId, window: snapshot.reviewWindowKey, sources: snapshot.sourceRefs }).slice(0, 32)}`;
      for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) payload.nutrition.targets[key] = Math.round(payload.nutrition.targets[key] * factor * 10) / 10;
      for (const d of payload.meals?.days ?? []) for (const m of d.meals) for (const i of m.ingredients) i.grams = Math.round(i.grams * factor / 5) * 5;
      explanation = "Comparable measurements and complete self-reports meet the synthetic plateau rule. A bounded nutrition proposal is prepared; strength and cardio do not increase.";
    } else if (snapshot.intake.goal === "STRENGTH" || snapshot.intake.goal === "ENDURANCE") {
      const modality = snapshot.intake.goal === "STRENGTH" ? "STRENGTH" : "CARDIO";
      const matching = sessions.filter(s => s.modality === modality && s.planVersionId === snapshot.baseVersionId);
      const weeksSupported = weeks.slice(-2).every(([key]) => {
        const records = matching.filter(s => reviewWindow(new Date(s.occurredAt), snapshot.reviewTimezone).key === key);
        if (!records.length || records.some(s => s.resultStatus !== "REPORTED_COMPLETE" || s.effortRating === null || s.effortRating > 6 || s.painReported)) return false;
        if (modality === "CARDIO") return payload.cardio.every(p => records.some(s => s.prescriptionSessionId === p.sessionId && s.durationMinutes !== null && s.durationMinutes >= p.durationMinutes));
        return payload.strength.every(p => p.exercises.every(e => Array.from({ length: e.sets }, (_, setIndex) => records.some(s => s.prescriptionSessionId === p.sessionId && s.exerciseId === e.exerciseId && s.setIndex === setIndex && s.reps !== null && s.reps >= e.reps)).every(Boolean)));
      });
      if (!weeksSupported) return none("HOLD", "INSUFFICIENT_EVIDENCE", "The accepted sessions need two weeks of complete, tolerable activity reports before this test progression.");
      if (modality === "STRENGTH" && payload.strength.length) { for (const s of payload.strength) for (const e of s.exercises) e.reps += 1; }
      else if (modality === "CARDIO" && payload.cardio.length) payload.cardio[0].durationMinutes += WEEKLY_FIXTURE_POLICY.cardioStepMinutes;
      else return none("HOLD", "UNCHANGED", "There is no matching accepted activity to progress.");
      explanation = "Complete typed activity and recovery reports support a bounded progression in one training domain. Nutrition and the other training domain stay the same.";
    } else return none("HOLD", "UNCHANGED", "The current plan can continue; this review does not require a numerical change.");
  }
  const checked = planPayloadSchema.safeParse(payload);
  if (!checked.success || !mealTargetsMatch(payload, snapshot.intake)) return none("CLARIFY", "NO_FEASIBLE_MEALS", "The proposed change cannot be represented with validated practical portions and content.");
  payload = checked.data;
  if (!weeklyChangeWithinBounds(snapshot, payload)) return none("HOLD", "CUMULATIVE_LIMIT", "The retained history, cooldown or combined-change limit does not permit another material adjustment in this window.");
  return { payload, decision: decision(action, reason, explanation, "ROUTINE") };
}
