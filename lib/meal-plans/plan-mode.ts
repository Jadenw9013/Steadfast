import type { PlanModeInput } from "@/lib/meal-plans/macro-targets";

/**
 * T-800 rework (code-review r1, MAJOR-1). Single source of truth
 * for the COACH-FACING editor mode, shared by both coach-facing readers —
 * the web query `getEffectiveMealPlanForReview` (lib/queries/meal-plans.ts)
 * and the iOS-facing REST `GET /api/coach/clients/[clientId]/meal-plan`.
 *
 * Before this file existed, `lib/queries/meal-plans.ts` computed
 * `draft?.planMode ?? clientPlanMode` inline and the REST route still
 * resolved from `draft ?? published`, so the two surfaces disagreed about
 * which editor a coach got for the exact state this hotfix repairs
 * (`CoachClient.planMode = MACROS`, no draft, published `MEAL_PLAN` plan —
 * web showed the macro editor, iOS showed the foods editor). Routing both
 * readers through this one module makes that drift a compile-time-shared
 * dependency instead of two hand-copied expressions.
 *
 * `resolveEditorPlanMode` deliberately never reads the published row's mode:
 * doing so would silently undo a toggle made on a week that has only a
 * published plan (the mechanism T-800 traces in board/tickets/T-800.md).
 *
 * Name and shape mirror team/sprint-1's `lib/meal-plans/plan-mode.ts`
 * verbatim (`resolveEditorPlanMode(draftPlanMode, clientPlanMode)`) so T-812's
 * merge is a lossless "take sprint-1" for this function. Unlike sprint-1's
 * module, `resolveDefaultPlanMode` stays in `lib/meal-plans/macro-targets.ts`
 * here — it already lived there before T-800, and moving it is an unrelated
 * refactor, out of scope for a P0.
 */
export function resolveEditorPlanMode(
  draftPlanMode: PlanModeInput | null | undefined,
  clientPlanMode: PlanModeInput
): PlanModeInput {
  return draftPlanMode ?? clientPlanMode;
}
