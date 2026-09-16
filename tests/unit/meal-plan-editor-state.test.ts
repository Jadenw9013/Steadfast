import { describe, it, expect, vi } from "vitest";

/**
 * T-102a (review round 1) — the two coach-editor rules the plan-mode toggle
 * made load-bearing:
 *
 *  1. Finding 1 — toggling plan mode swaps the entire editor and throws away
 *     everything it holds in `useState`. `shouldProceedWithModeSwitch` +
 *     `foodsEditorSignature` / `macroEditorSignature` decide when a coach must
 *     confirm first.
 *  2. Finding 2 — each editor authors exactly one representation, so the draft
 *     it creates must say `planMode` explicitly. The literal now lives in
 *     `buildFoodsDraftInput` / `buildMacroDraftInput`, so deleting it fails
 *     here instead of silently publishing a foods plan labelled MACROS.
 *
 * These helpers are pure and DOM-free by construction (this repo has no jsdom /
 * React testing dependency and adding one needs its own ticket), which is why
 * they live in `lib/` rather than inline in the components.
 */

import {
  PLAN_MODE_SWITCH_WARNING,
  shouldProceedWithModeSwitch,
  foodsEditorSignature,
  macroEditorSignature,
  buildFoodsDraftInput,
  buildMacroDraftInput,
} from "@/lib/meal-plans/editor-state";
import {
  groupItemsToMeals,
  type EditableMacroMeal,
  type MacroMealTarget,
  type MealGroup,
} from "@/types/meal-plan";

const OATS = {
  id: "row-1",
  foodName: "Oats",
  quantity: "80",
  unit: "g",
  servingDescription: "80 g",
  calories: 300,
  protein: 10,
  carbs: 54,
  fats: 5,
};

function mealsWithOats(): MealGroup[] {
  return [{ mealName: "Breakfast", items: [{ ...OATS }] }];
}

// ── Finding 1: the toggle's guard ─────────────────────────────────────────────

describe("shouldProceedWithModeSwitch", () => {
  const confirmYes = () => true;
  const confirmNo = () => false;

  it("switches immediately when there is nothing typed — no dialog at all", () => {
    const confirmDiscard = vi.fn(confirmYes);
    const proceed = shouldProceedWithModeSwitch({
      current: "MEAL_PLAN",
      next: "MACROS",
      pending: false,
      hasUnsavedChanges: false,
      confirmDiscard,
    });
    expect(proceed).toBe(true);
    // Load-bearing: a fresh page load must keep its one-tap toggle.
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("requires a confirmation when there is unsaved content", () => {
    const confirmDiscard = vi.fn(confirmYes);
    const proceed = shouldProceedWithModeSwitch({
      current: "MEAL_PLAN",
      next: "MACROS",
      pending: false,
      hasUnsavedChanges: true,
      confirmDiscard,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(proceed).toBe(true);
  });

  it("does NOT switch when the coach cancels the confirmation", () => {
    const confirmDiscard = vi.fn(confirmNo);
    const proceed = shouldProceedWithModeSwitch({
      current: "MEAL_PLAN",
      next: "MACROS",
      pending: false,
      hasUnsavedChanges: true,
      confirmDiscard,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    // The toggle returns early on false, so `mode` never changes, the editor
    // never unmounts, and the typed content survives.
    expect(proceed).toBe(false);
  });

  it("is a no-op for the already-active mode, even with unsaved content", () => {
    const confirmDiscard = vi.fn(confirmYes);
    expect(
      shouldProceedWithModeSwitch({
        current: "MACROS",
        next: "MACROS",
        pending: false,
        hasUnsavedChanges: true,
        confirmDiscard,
      })
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("ignores clicks while a switch is already in flight", () => {
    const confirmDiscard = vi.fn(confirmYes);
    expect(
      shouldProceedWithModeSwitch({
        current: "MEAL_PLAN",
        next: "MACROS",
        pending: true,
        hasUnsavedChanges: true,
        confirmDiscard,
      })
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("warns about losing work, not about the mode change itself", () => {
    expect(PLAN_MODE_SWITCH_WARNING).toMatch(/unsaved/i);
    expect(PLAN_MODE_SWITCH_WARNING).toMatch(/lost/i);
  });
});

describe("foodsEditorSignature (what the foods editor would lose)", () => {
  const seededItems = [
    {
      mealName: "Breakfast",
      foodName: "Oats",
      quantity: "80",
      unit: "g",
      servingDescription: "80 g",
      calories: 300,
      protein: 10,
      carbs: 54,
      fats: 5,
    },
  ];

  it("is unchanged by the random row ids regenerated on every load", () => {
    // Both calls produce fresh crypto.randomUUID() ids. If ids leaked into the
    // signature, every published week would prompt on its first toggle.
    const a = foodsEditorSignature(groupItemsToMeals(seededItems), null, "");
    const b = foodsEditorSignature(groupItemsToMeals(seededItems), null, "");
    expect(a).toBe(b);
  });

  it("does not flag an untouched published week — the DB row still holds it", () => {
    const seed = groupItemsToMeals(seededItems);
    const baseline = foodsEditorSignature(seed, null, "");
    expect(foodsEditorSignature(seed, null, "")).toBe(baseline);
  });

  it("flags a typed food item", () => {
    const baseline = foodsEditorSignature([], null, "");
    expect(foodsEditorSignature(mealsWithOats(), null, "")).not.toBe(baseline);
  });

  it("flags an edited portion on an existing item", () => {
    const before = mealsWithOats();
    const after = mealsWithOats();
    after[0].items[0].quantity = "120";
    expect(foodsEditorSignature(after, null, "")).not.toBe(
      foodsEditorSignature(before, null, "")
    );
  });

  it("flags a renamed meal that has no items yet", () => {
    const before: MealGroup[] = [{ mealName: "Meal 1", items: [] }];
    const after: MealGroup[] = [{ mealName: "Post-workout", items: [] }];
    expect(foodsEditorSignature(after, null, "")).not.toBe(
      foodsEditorSignature(before, null, "")
    );
  });

  it("flags typed support content", () => {
    expect(foodsEditorSignature([], null, "Drink water")).not.toBe(
      foodsEditorSignature([], null, "")
    );
  });

  it("treats a whitespace-only notes box as empty — matches the write path", () => {
    expect(foodsEditorSignature([], null, "   \n ")).toBe(
      foodsEditorSignature([], null, "")
    );
  });

  it("flags plan extras added from the empty-state CTA", () => {
    expect(foodsEditorSignature([], {}, "")).not.toBe(
      foodsEditorSignature([], null, "")
    );
  });
});

describe("macroEditorSignature (what the macros editor would lose)", () => {
  const target: MacroMealTarget = {
    mealName: "Breakfast",
    calories: 500,
    protein: 40,
    carbs: 50,
    fats: 15,
  };

  it("ignores the client-side row id", () => {
    // What the macros editor actually holds is `EditableMacroMeal[]` — the
    // target plus a `crypto.randomUUID()` row id regenerated on every load. The
    // signature takes the id-free supertype, so passing editor rows straight in
    // (as macro-plan-editor.tsx does) must not leak the id.
    const rowA: EditableMacroMeal = { ...target, id: "a" };
    const rowB: EditableMacroMeal = { ...target, id: "b" };
    expect(macroEditorSignature([rowA])).toBe(macroEditorSignature([rowB]));
  });

  it("does not flag untouched seeded targets", () => {
    expect(macroEditorSignature([target])).toBe(macroEditorSignature([target]));
  });

  it("flags an edited macro number", () => {
    expect(macroEditorSignature([{ ...target, protein: 45 }])).not.toBe(
      macroEditorSignature([target])
    );
  });

  it("flags an added meal row", () => {
    expect(macroEditorSignature([target, { ...target, mealName: "Lunch" }])).not.toBe(
      macroEditorSignature([target])
    );
  });
});

// ── Finding 2: each editor stamps its own planMode ────────────────────────────

describe("buildFoodsDraftInput (the foods editor's createDraftMealPlan payload)", () => {
  const args = {
    clientId: "client-1",
    weekStartDate: "2026-09-14",
    meals: mealsWithOats(),
    planExtras: null,
    supportContent: "",
  };

  it("always stamps planMode: MEAL_PLAN", () => {
    // THE regression guard. Without it the draft inherits CoachClient.planMode,
    // so a coach who toggled to MACROS and kept typing foods would publish a
    // foods plan labelled MACROS — invisible to the client (T-102a criterion 3).
    expect(buildFoodsDraftInput(args).planMode).toBe("MEAL_PLAN");
  });

  it("stamps MEAL_PLAN for an empty plan too", () => {
    expect(buildFoodsDraftInput({ ...args, meals: [] }).planMode).toBe("MEAL_PLAN");
  });

  it("sends the typed foods as flat, sorted items", () => {
    const input = buildFoodsDraftInput(args);
    expect(input.items).toEqual([
      expect.objectContaining({ mealName: "Breakfast", foodName: "Oats", sortOrder: 0 }),
    ]);
    expect(input.clientId).toBe("client-1");
    expect(input.weekStartDate).toBe("2026-09-14");
  });

  it("sends an explicit null for an empty notes box, never undefined (T-101)", () => {
    // `undefined` means "not touched" on the create path and carries the
    // previous published plan's notes forward.
    expect(buildFoodsDraftInput({ ...args, supportContent: "" }).supportContent).toBeNull();
    expect(buildFoodsDraftInput({ ...args, supportContent: "  " }).supportContent).toBeNull();
    expect(buildFoodsDraftInput({ ...args, supportContent: "Hydrate" }).supportContent).toBe(
      "Hydrate"
    );
  });

  it("omits planExtras rather than sending null when none are configured", () => {
    expect(buildFoodsDraftInput(args).planExtras).toBeUndefined();
    expect(buildFoodsDraftInput({ ...args, planExtras: {} }).planExtras).toEqual({});
  });
});

describe("buildMacroDraftInput (the macros editor's createDraftMealPlan payload)", () => {
  const args = {
    clientId: "client-1",
    weekStartDate: "2026-09-14",
    meals: [
      { id: "row-1", mealName: "Breakfast", calories: 500, protein: 40, carbs: 50, fats: 15 },
    ],
  };

  it("always stamps planMode: MACROS", () => {
    expect(buildMacroDraftInput(args).planMode).toBe("MACROS");
  });

  it("stamps MACROS for an empty plan too", () => {
    expect(buildMacroDraftInput({ ...args, meals: [] }).planMode).toBe("MACROS");
  });

  it("sends the macro targets with sortOrder and no client-side ids", () => {
    const input = buildMacroDraftInput(args);
    expect(input.macroTargets).toEqual([
      { mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
    ]);
    expect(input.macroTargets[0]).not.toHaveProperty("id");
  });

  it("never sends food items — the two builders are disjoint", () => {
    expect(buildMacroDraftInput(args)).not.toHaveProperty("items");
    expect(buildFoodsDraftInput({
      clientId: "c",
      weekStartDate: "2026-09-14",
      meals: [],
      planExtras: null,
      supportContent: "",
    })).not.toHaveProperty("macroTargets");
  });
});
