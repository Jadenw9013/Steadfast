/**
 * T-800 hotfix. Pure, zero imports — safe to import from client components
 * (the two coach meal-plan editors) as well as server modules.
 *
 * Names and wording are copied verbatim from team/sprint-1's
 * lib/meal-plans/publish.ts so the eventual sprint-1 merge is lossless.
 */

export type PlanModeValue = "MEAL_PLAN" | "MACROS";

export function emptyPlanMessage(planMode: PlanModeValue): string {
  return planMode === "MACROS"
    ? "Add at least one meal with macro targets before publishing."
    : "Add at least one food before publishing.";
}
