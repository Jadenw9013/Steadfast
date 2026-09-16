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
 * The pure coach-editor rules, shared by the two coach-facing meal-plan editors
 * (T-102a, extended by T-103): draft-creation payloads, the unsaved-change
 * signatures, the plan-mode toggle's guard, publish-time meal-name validation,
 * the macro/calorie consistency check and the macro autofill request/response
 * mapping.
 *
 * Nothing here touches the database, React, or the DOM — the type-only imports
 * above are erased at compile time — so this module is safe inside a
 * `"use client"` bundle AND unit-testable without a DOM. That is the whole
 * reason the rules live here: this repo has no jsdom/RTL, so a rule written
 * inside a `"use client"` component is a rule with no unit test. That matters
 * twice over:
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

/**
 * Stable, id-free serialization of everything the macros editor can author.
 *
 * `supportContent` is a required second parameter because the macros editor can
 * now author plan notes too (T-103); without it, typed notes are silently
 * destroyed by the plan-mode toggle's confirm guard, which is the exact bug
 * T-102a closed for the foods editor. It is deliberately NOT defaulted to `""`:
 * a default would let a future caller reintroduce that data loss by simply
 * forgetting the argument.
 */
export function macroEditorSignature(
  meals: MacroMealTarget[],
  supportContent: string
): string {
  return JSON.stringify({
    meals: meals.map((m) => ({
      mealName: m.mealName,
      calories: m.calories,
      protein: m.protein,
      carbs: m.carbs,
      fats: m.fats,
    })),
    // Matches the write semantics in `buildMacroDraftInput` (and
    // `foodsEditorSignature`): an all-whitespace box and an empty box are the
    // same "no notes", not a difference.
    supportContent: supportContent.trim() === "" ? null : supportContent,
  });
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
  /** NEW (T-103). Same explicit-null semantics as `buildFoodsDraftInput`. */
  supportContent: string | null;
};

/** The `createDraftMealPlan` payload the macros editor sends. */
export function buildMacroDraftInput(args: {
  clientId: string;
  weekStartDate: string;
  meals: EditableMacroMeal[];
  supportContent: string;
}): MacroDraftInput {
  return {
    clientId: args.clientId,
    weekStartDate: args.weekStartDate,
    // This editor only ever authors macro targets — same reasoning as
    // `buildFoodsDraftInput`, opposite mode.
    planMode: "MACROS",
    macroTargets: flattenMacroMeals(args.meals),
    // Explicit `null`, never `undefined`, for the identical reason documented
    // on `buildFoodsDraftInput` above: on the create path `undefined` means
    // "not touched" and T-101's carry-forward resurrects the previous published
    // plan's notes.
    supportContent: args.supportContent.trim() === "" ? null : args.supportContent,
  };
}

// ── Publish-time meal-name validation (T-103) ─────────────────────────────────

export type MealNameProblem =
  | { code: "BLANK_NAME"; index: number }
  | { code: "DUPLICATE_NAME"; index: number; name: string };

/**
 * The first problem in a plan's meal names, or null.
 *
 * Checks in order — all blanks before any duplicate — so a coach who left two
 * rows blank is told to name them rather than told they collide.
 *  - BLANK_NAME:     `name.trim() === ""`. A truly empty string is unreachable
 *    through either editor (`tempName || "Untitled Meal"`), but a single space
 *    is, and `z.string().min(1)` accepts it — it then renders as a blank meal
 *    title and a blank check-off label.
 *  - DUPLICATE_NAME: two names equal after `.trim().toLowerCase()`; `index` is
 *    the SECOND occurrence, `name` is the first occurrence's trimmed text.
 *
 * Duplicates matter because `DailyMealCheckoff` is unique per
 * `(dailyAdherenceId, mealNameSnapshot)` (prisma/schema.prisma:1568): two
 * identically-named meals share one check-off row, so ticking one ticks both,
 * the client's checklist shows fewer meals than the plan has, and the coach's
 * adherence percentages use the wrong denominator.
 *
 * Deliberately stricter than the DB: that unique index is exact-match, so
 * "Lunch"/"lunch" would not literally collide — but it reads as one meal to the
 * client and there is no legitimate plan that needs both. T-743 must use this
 * same comparison server-side or the two surfaces disagree.
 */
export function findMealNameProblem(names: string[]): MealNameProblem | null {
  for (let i = 0; i < names.length; i++) {
    if (names[i].trim() === "") return { code: "BLANK_NAME", index: i };
  }
  const seen = new Map<string, string>();
  for (let i = 0; i < names.length; i++) {
    const trimmed = names[i].trim();
    const key = trimmed.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      return { code: "DUPLICATE_NAME", index: i, name: first };
    }
    seen.set(key, trimmed);
  }
  return null;
}

/** The single copy of the coach-facing wording for `findMealNameProblem`. */
export function mealNameProblemMessage(problem: MealNameProblem): string {
  if (problem.code === "BLANK_NAME") {
    return `Meal ${problem.index + 1} needs a name before you can publish.`;
  }
  return `Two meals are named "${problem.name}". Give each meal a different name — your client's daily check-off list tracks meals by name, so duplicates merge into one.`;
}

// ── Calories vs. macros (T-103) ───────────────────────────────────────────────

/** 10%. Exported so the UI and the test can't drift. */
export const MACRO_CALORIE_TOLERANCE = 0.1;

/** 4 cal/g protein, 4 cal/g carbs, 9 cal/g fat. Always an integer — every input
 *  is a `z.number().int()` (lib/meal-plans/macro-targets.ts:18-21). */
export function derivedCalories(m: {
  protein: number;
  carbs: number;
  fats: number;
}): number {
  return m.protein * 4 + m.carbs * 4 + m.fats * 9;
}

/**
 * `{ derived }` when the row's `calories` disagrees with 4P+4C+9F by more than
 * `MACRO_CALORIE_TOLERANCE`, else null. Advisory only — it must never block
 * Publish.
 *
 * Returns null when protein/carbs/fats are ALL zero: that is a calories-only
 * target, which is a legitimate prescription and must not carry a warning the
 * coach cannot clear, or coaches learn to ignore the warning that matters.
 * Otherwise ratio = |calories - derived| / derived, so a row with macros but
 * `calories: 0` DOES warn (ratio 1) — that is the common half-filled row the
 * one-tap fix button exists for. The boundary is inclusive: exactly 10% off is
 * not a mismatch.
 */
export function macroCalorieMismatch(meal: {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}): { derived: number } | null {
  const derived = derivedCalories(meal);
  // `derived === 0` is exactly the all-macros-zero case for non-negative
  // integer inputs, and also keeps the ratio below from dividing by zero.
  if (derived === 0) return null;
  const ratio = Math.abs(meal.calories - derived) / derived;
  return ratio > MACRO_CALORIE_TOLERANCE ? { derived } : null;
}

// ── Macro autofill request/response mapping (T-103) ───────────────────────────

/** Structural, not imported from `lib/queries/meal-plans` — this module must
 *  stay free of any import whose module graph reaches `@/lib/db`. */
export type AutofillSourceItem = {
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription: string | null;
};

export type MacroAutofillRequest = {
  /** The POST body's `meals`, in order. Never contains an entry with zero items. */
  sourceMeals: { name: string; items: { food: string; portion: string }[] }[];
  /** `targetIndices[k]` is the index in `meals` that `sourceMeals[k]` fills.
   *  Empty when `seeding` is true. */
  targetIndices: number[];
  /** Indices in `meals` with no matching foods: not sent, not overwritten. */
  skippedIndices: number[];
  /** `meals` was empty ⇒ create one row per estimate (today's behavior). */
  seeding: boolean;
};

/**
 * Builds the `/api/mealplans/estimate-macros` request from the editor's rows and
 * the plan's existing foods.
 *
 * Foods are grouped by meal name — there is no id linking a macro row to a foods
 * meal, and inventing one is a schema change — and the portion string is
 * byte-identical to the expression this replaced.
 *
 * Rows with no matching foods are NOT sent: the prompt tells the model to return
 * zeros for a meal with no foods (lib/llm/estimate-meal-macros.ts:24), so
 * sending them "for symmetry" would silently wipe hand-entered targets on every
 * renamed row. They come back as `skippedIndices` so the UI can say why.
 */
export function buildAutofillRequest(
  meals: { mealName: string }[],
  items: AutofillSourceItem[]
): MacroAutofillRequest {
  const grouped = new Map<string, { food: string; portion: string }[]>();
  for (const item of items) {
    const list = grouped.get(item.mealName) ?? [];
    list.push({
      food: item.foodName,
      portion: item.servingDescription || `${item.quantity} ${item.unit}`.trim(),
    });
    grouped.set(item.mealName, list);
  }

  // No rows yet: seed one row per distinct food meal, in first-seen order.
  if (meals.length === 0) {
    return {
      sourceMeals: Array.from(grouped, ([name, mealItems]) => ({ name, items: mealItems })),
      targetIndices: [],
      skippedIndices: [],
      seeding: true,
    };
  }

  const sourceMeals: MacroAutofillRequest["sourceMeals"] = [];
  const targetIndices: number[] = [];
  const skippedIndices: number[] = [];
  meals.forEach((meal, index) => {
    const mealItems = grouped.get(meal.mealName);
    if (!mealItems || mealItems.length === 0) {
      skippedIndices.push(index);
      return;
    }
    sourceMeals.push({ name: meal.mealName, items: mealItems });
    targetIndices.push(index);
  });
  return { sourceMeals, targetIndices, skippedIndices, seeding: false };
}

/**
 * Applies estimates BY INDEX. Returns null — the caller shows an error and
 * applies nothing — when `targetIndices.length !== estimates.length` or any
 * index is out of range for `meals`.
 *
 * Never matches on `name`: that is the bug this replaces. `estimates.find(e =>
 * e.name === m.mealName)` silently left a renamed row with its old numbers, and
 * the route already guarantees one estimate per sent meal in the same order
 * (lib/llm/estimate-meal-macros.ts:115-117), which is what makes index mapping
 * safe. The input array is never mutated.
 */
export function applyMacroEstimates<T extends MacroMealTarget>(
  meals: T[],
  targetIndices: number[],
  estimates: { calories: number; protein: number; carbs: number; fats: number }[]
): T[] | null {
  if (targetIndices.length !== estimates.length) return null;
  if (targetIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= meals.length)) {
    return null;
  }
  const next = [...meals];
  targetIndices.forEach((target, k) => {
    const estimate = estimates[k];
    next[target] = {
      ...next[target],
      calories: estimate.calories,
      protein: estimate.protein,
      carbs: estimate.carbs,
      fats: estimate.fats,
    };
  });
  return next;
}

/** Frozen copy for the two autofill states the component can produce itself. */
export const AUTOFILL_NO_SOURCE_MESSAGE =
  "None of these meals have foods to estimate from. A macro meal is matched to the foods plan by name, so rename a meal to match, or enter its targets by hand.";
export const AUTOFILL_MISALIGNED_MESSAGE =
  "The estimates didn't line up with the meals sent. Nothing was changed — please try again.";
