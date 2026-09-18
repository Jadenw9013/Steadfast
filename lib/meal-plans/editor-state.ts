import { flattenMeals, type MealGroup } from "@/types/meal-plan";
import type { PlanExtras } from "@/types/meal-plan-extras";
import type { PlanModeInput } from "@/lib/meal-plans/macro-targets";

/**
 * T-800 hotfix. The foods editor (MealPlanEditorV2) must always pass an
 * explicit planMode when creating a draft — omitting it let a new version
 * fall through to the CoachClient's stale default (the root cause of the
 * production bug this ticket fixes). This builder is the single place that
 * assembles that payload so the explicit MEAL_PLAN mode can't be dropped
 * again.
 *
 * Same module name and function name as team/sprint-1's
 * lib/meal-plans/editor-state.ts so the eventual merge is a clean add.
 *
 * NOTE: on origin/main, keep `supportContent: supportContent.trim() ||
 * undefined` (main has no T-101 carry-forward semantics for an explicit
 * null; sprint-1's own trim is kept so a whitespace-only notes box is
 * treated as "no notes", matching `foodsEditorSignature`'s write
 * semantics — code-review r2 NIT-1). Do not copy sprint-1's explicit-null
 * variant here.
 */
export function buildFoodsDraftInput(args: {
  clientId: string;
  weekStartDate: string;
  meals: MealGroup[];
  planExtras: PlanExtras | null;
  supportContent: string;
}): {
  clientId: string;
  weekStartDate: string;
  items: ReturnType<typeof flattenMeals>;
  planMode: "MEAL_PLAN";
  planExtras?: PlanExtras;
  supportContent?: string;
} {
  return {
    clientId: args.clientId,
    weekStartDate: args.weekStartDate,
    items: flattenMeals(args.meals),
    planMode: "MEAL_PLAN",
    planExtras: args.planExtras ?? undefined,
    supportContent: args.supportContent.trim() || undefined,
  };
}

// ── Plan-mode toggle guard (T-800 code-review r1, MAJOR-3) ────────────────────
//
// Verbatim from team/sprint-1's lib/meal-plans/editor-state.ts ("T-102a
// review, finding 1"), carried into the hotfix so a coach can never lose
// unsaved foods/macros typed before a draft exists: the plan-mode toggle
// swaps which editor is mounted, and editor content lives only in `useState`
// until an explicit Save.

/** Shown before a plan-mode switch discards unsaved editor content. */
export const PLAN_MODE_SWITCH_WARNING =
  "Switching plan type replaces the editor below. Your unsaved changes to this week's plan will be lost. Switch anyway?";

/**
 * Stable, id-free serialization of everything the foods editor can author.
 *
 * Client-side row ids are random UUIDs regenerated on every load, so they are
 * deliberately excluded — `flattenMeals` already drops them. Compare the
 * signature of the current editor state against the signature of the effective
 * plan the editor was seeded with: equal means nothing would be lost by
 * remounting.
 */
export function foodsEditorSignature(
  meals: MealGroup[],
  planExtras: PlanExtras | null,
  supportContent: string
): string {
  return JSON.stringify({
    // Meal names are carried separately because `flattenMeals` drops meals
    // that have no items — a renamed-but-still-empty meal is still typed
    // content.
    mealNames: meals.map((m) => m.mealName),
    items: flattenMeals(meals),
    planExtras: planExtras ?? null,
    // An all-whitespace box and an empty box are the same "no notes", not a
    // difference — matches `buildFoodsDraftInput`'s write semantics.
    supportContent: supportContent.trim() === "" ? null : supportContent,
  });
}

/**
 * Stable, id-free serialization of everything the macros editor can author.
 *
 * Trimmed from team/sprint-1's `macroEditorSignature`: origin/main's macro
 * editor has no `supportContent` field yet (that is T-103, on sprint-1 only),
 * so this only signs the meal rows. Structural, so it accepts both the raw
 * `EffectiveMealPlan.macroTargets` shape and the editor's `EditableMacroMeal`
 * rows (which carry an extra client-side `id` — deliberately not read here,
 * for the same id-free reason as `foodsEditorSignature`).
 */
export function macroEditorSignature(
  meals: { mealName: string; calories: number; protein: number; carbs: number; fats: number }[]
): string {
  return JSON.stringify(
    meals.map((m) => ({
      mealName: m.mealName,
      calories: m.calories,
      protein: m.protein,
      carbs: m.carbs,
      fats: m.fats,
    }))
  );
}

/**
 * Whether a click on the plan-mode toggle should actually switch the mode.
 *
 * Extracted from the toggle's click handler so the rule is testable without a
 * DOM. `confirmDiscard` is only consulted when there is something to lose, so
 * a fresh page load with no edits keeps its one-tap behavior.
 */
export function shouldProceedWithModeSwitch(args: {
  current: PlanModeInput;
  next: PlanModeInput;
  /** A switch is already in flight. */
  pending: boolean;
  /** Reported by whichever editor is currently mounted. */
  hasUnsavedChanges: boolean;
  /** Returns true to discard the unsaved content and switch anyway. */
  confirmDiscard: () => boolean;
}): boolean {
  const { current, next, pending, hasUnsavedChanges, confirmDiscard } = args;
  if (next === current || pending) return false;
  if (!hasUnsavedChanges) return true;
  return confirmDiscard();
}
