import type { PlanModeValue } from "./publish-messages";

/**
 * T-800 hotfix — defensive render rule.
 *
 * A plan can end up stamped MACROS with food items and zero macro targets
 * (the T-800 production bug: the foods editor created a new version without
 * an explicit planMode, so it fell through to a stale CoachClient default).
 * Every reader of a plan must treat that state as a mislabeled foods plan,
 * never as an empty macro plan, so a client is never shown a blank screen
 * when content exists.
 *
 * Pure, no db import — this is imported by a client component
 * (components/client/simple-meal-plan.tsx).
 */

export function isMislabeledMacroPlan(
  planMode: PlanModeValue,
  counts: { items: number; macroTargets: number }
): boolean {
  return planMode === "MACROS" && counts.macroTargets === 0 && counts.items > 0;
}

export function resolveDisplayPlanMode(
  planMode: PlanModeValue,
  counts: { items: number; macroTargets: number }
): PlanModeValue {
  return isMislabeledMacroPlan(planMode, counts) ? "MEAL_PLAN" : planMode;
}
