import {
  flattenMeals,
  flattenMacroMeals,
  type MealGroup,
  type MacroMealTarget,
  type EditableMacroMeal,
} from "@/types/meal-plan";
import type { PlanExtras } from "@/types/meal-plan-extras";
import type { PlanModeInput } from "@/lib/meal-plans/macro-targets";

/**
 * Pure helpers shared by the two coach-facing meal-plan editors (T-102a).
 *
 * Nothing here touches the database, React, or the DOM — the type-only imports
 * above are erased at compile time — so this module is safe inside a
 * `"use client"` bundle AND unit-testable without a DOM. That matters twice:
 *
 *  1. `planMode` on a brand-new draft. Each editor authors exactly one
 *     representation, so the draft it creates must say so explicitly. Letting
 *     the field fall through to `CoachClient.planMode` would create (say) a
 *     MACROS draft full of foods for the whole window between a toggle and the
 *     next reload. The literal lives in `buildFoodsDraftInput` /
 *     `buildMacroDraftInput` — one place per mode, with a literal return type,
 *     so deleting it is both a test failure and a type error.
 *  2. "Has the coach typed something?". The plan-mode toggle swaps the entire
 *     editor, and editor content lives only in `useState` until an explicit
 *     Save. The signature functions below define, once, what counts as content
 *     worth warning about before that swap throws it away.
 */

/** Shown before a plan-mode switch discards unsaved editor content. */
export const PLAN_MODE_SWITCH_WARNING =
  "Switching plan type replaces the editor below. Your unsaved changes to this week's plan will be lost. Switch anyway?";

// ── "The coach has typed something" ───────────────────────────────────────────

/**
 * Stable, id-free serialization of everything the foods editor can author.
 *
 * Client-side row ids are random UUIDs regenerated on every load, so they are
 * deliberately excluded — `flattenMeals` already drops them. Compare the
 * signature of the current editor state against the signature of the effective
 * plan the editor was seeded with: equal means nothing would be lost by
 * remounting, which is exactly the "no extra friction" case for the toggle.
 */
export function foodsEditorSignature(
  meals: MealGroup[],
  planExtras: PlanExtras | null,
  supportContent: string
): string {
  return JSON.stringify({
    // Meal names are carried separately because `flattenMeals` drops meals that
    // have no items — a renamed-but-still-empty meal is still typed content.
    mealNames: meals.map((m) => m.mealName),
    items: flattenMeals(meals),
    planExtras: planExtras ?? null,
    // Matches the write semantics in `buildFoodsDraftInput`: an all-whitespace
    // box and an empty box are the same "no notes", not a difference.
    supportContent: supportContent.trim() === "" ? null : supportContent,
  });
}

/** Stable, id-free serialization of everything the macros editor can author. */
export function macroEditorSignature(meals: MacroMealTarget[]): string {
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

// ── The plan-mode toggle's guard ──────────────────────────────────────────────

/**
 * Whether a click on the plan-mode toggle should actually switch the mode.
 *
 * Extracted from the toggle's click handler so the rule is testable without a
 * DOM. `confirmDiscard` is only consulted when there is something to lose, so a
 * fresh page load with no edits keeps its one-tap behavior.
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

// ── Draft-creation payloads ───────────────────────────────────────────────────

export type FoodsDraftInput = {
  clientId: string;
  weekStartDate: string;
  items: ReturnType<typeof flattenMeals>;
  /** Literal, not `PlanModeInput` — see the module note. */
  planMode: "MEAL_PLAN";
  planExtras?: PlanExtras;
  supportContent: string | null;
};

/** The `createDraftMealPlan` payload the foods editor sends. */
export function buildFoodsDraftInput(args: {
  clientId: string;
  weekStartDate: string;
  meals: MealGroup[];
  planExtras: PlanExtras | null;
  supportContent: string;
}): FoodsDraftInput {
  return {
    clientId: args.clientId,
    weekStartDate: args.weekStartDate,
    items: flattenMeals(args.meals),
    // This editor only ever authors foods, so the draft's mode must be
    // explicit — letting it fall through to `CoachClient.planMode` would
    // create a MACROS draft full of foods for the whole window between a
    // toggle and the next reload (T-102a).
    planMode: "MEAL_PLAN",
    planExtras: args.planExtras ?? undefined,
    // Explicit `null`, not `undefined`, when the textarea is empty. On the
    // create path `undefined` means "not touched" and the service carries the
    // previous published plan's notes forward (T-101), which would silently
    // resurrect notes the coach just cleared as soon as router.refresh()
    // re-seeded this field. The textarea is pre-populated from the effective
    // plan, so an empty box always means "no notes for this week".
    // (Clearing notes on the SAVE path is still T-732.)
    supportContent: args.supportContent.trim() === "" ? null : args.supportContent,
  };
}

export type MacroDraftInput = {
  clientId: string;
  weekStartDate: string;
  /** Literal, not `PlanModeInput` — see the module note. */
  planMode: "MACROS";
  macroTargets: ReturnType<typeof flattenMacroMeals>;
};

/** The `createDraftMealPlan` payload the macros editor sends. */
export function buildMacroDraftInput(args: {
  clientId: string;
  weekStartDate: string;
  meals: EditableMacroMeal[];
}): MacroDraftInput {
  return {
    clientId: args.clientId,
    weekStartDate: args.weekStartDate,
    // This editor only ever authors macro targets — same reasoning as
    // `buildFoodsDraftInput`, opposite mode.
    planMode: "MACROS",
    macroTargets: flattenMacroMeals(args.meals),
  };
}
