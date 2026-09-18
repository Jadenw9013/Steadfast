import { describe, it, expect, vi } from "vitest";
import {
  buildFoodsDraftInput,
  shouldProceedWithModeSwitch,
  foodsEditorSignature,
  macroEditorSignature,
} from "@/lib/meal-plans/editor-state";
import type { MealGroup } from "@/types/meal-plan";

const meals: MealGroup[] = [
  {
    mealName: "Breakfast",
    items: [
      {
        id: "a",
        foodName: "Oats",
        quantity: "1",
        unit: "cup",
        servingDescription: "1 cup",
        calories: 300,
        protein: 10,
        carbs: 50,
        fats: 5,
      },
    ],
  },
  {
    mealName: "Lunch",
    items: [
      {
        id: "b",
        foodName: "Chicken",
        quantity: "6",
        unit: "oz",
        servingDescription: "6 oz",
        calories: 280,
        protein: 52,
        carbs: 0,
        fats: 6,
      },
    ],
  },
];

describe("buildFoodsDraftInput", () => {
  it("always sets planMode: MEAL_PLAN", () => {
    const result = buildFoodsDraftInput({
      clientId: "client_1",
      weekStartDate: "2026-09-14",
      meals,
      planExtras: null,
      supportContent: "",
    });
    expect(result.planMode).toBe("MEAL_PLAN");
  });

  it("flattens meals in order", () => {
    const result = buildFoodsDraftInput({
      clientId: "client_1",
      weekStartDate: "2026-09-14",
      meals,
      planExtras: null,
      supportContent: "",
    });
    expect(result.items.map((i) => i.mealName)).toEqual(["Breakfast", "Lunch"]);
    expect(result.items.map((i) => i.foodName)).toEqual(["Oats", "Chicken"]);
  });

  it("omits supportContent when the string is empty", () => {
    const result = buildFoodsDraftInput({
      clientId: "client_1",
      weekStartDate: "2026-09-14",
      meals,
      planExtras: null,
      supportContent: "",
    });
    expect(result.supportContent).toBeUndefined();
  });

  it("passes supportContent through when non-empty", () => {
    const result = buildFoodsDraftInput({
      clientId: "client_1",
      weekStartDate: "2026-09-14",
      meals,
      planExtras: null,
      supportContent: "Drink more water",
    });
    expect(result.supportContent).toBe("Drink more water");
  });

  // code-review r2 NIT-1: a whitespace-only notes box must be treated as "no
  // notes" here too, matching `foodsEditorSignature`'s write semantics — a
  // coach who types only spaces would otherwise get no unsaved-changes
  // warning before the toggle discards it, yet the string would have been
  // persisted on Save.
  it("treats a whitespace-only supportContent the same as empty", () => {
    const result = buildFoodsDraftInput({
      clientId: "client_1",
      weekStartDate: "2026-09-14",
      meals,
      planExtras: null,
      supportContent: "   ",
    });
    expect(result.supportContent).toBeUndefined();
  });
});

// T-800 code-review r1, MAJOR-3: the plan-mode toggle's confirm guard, carried
// across from team/sprint-1 so a coach can never lose unsaved foods/macros
// typed before a draft exists.
describe("shouldProceedWithModeSwitch", () => {
  const base = {
    current: "MEAL_PLAN" as const,
    next: "MACROS" as const,
    pending: false,
    hasUnsavedChanges: false,
  };

  it("proceeds immediately when there is nothing unsaved", () => {
    const confirmDiscard = vi.fn(() => false);
    expect(shouldProceedWithModeSwitch({ ...base, confirmDiscard })).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("asks for confirmation when there are unsaved changes, and proceeds only if confirmed", () => {
    const confirmYes = vi.fn(() => true);
    expect(shouldProceedWithModeSwitch({ ...base, hasUnsavedChanges: true, confirmDiscard: confirmYes })).toBe(true);
    expect(confirmYes).toHaveBeenCalledTimes(1);

    const confirmNo = vi.fn(() => false);
    expect(shouldProceedWithModeSwitch({ ...base, hasUnsavedChanges: true, confirmDiscard: confirmNo })).toBe(false);
    expect(confirmNo).toHaveBeenCalledTimes(1);
  });

  it("never proceeds when next === current, even with unsaved changes, and never asks", () => {
    const confirmDiscard = vi.fn(() => true);
    expect(
      shouldProceedWithModeSwitch({ ...base, next: base.current, hasUnsavedChanges: true, confirmDiscard })
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("never proceeds while a switch is already pending, even with no unsaved changes, and never asks", () => {
    const confirmDiscard = vi.fn(() => true);
    expect(shouldProceedWithModeSwitch({ ...base, pending: true, confirmDiscard })).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });
});

describe("foodsEditorSignature", () => {
  it("is stable across id-only differences and changes when content changes", () => {
    const a: MealGroup[] = [{ mealName: "Breakfast", items: [{ id: "a", foodName: "Oats", quantity: "1", unit: "cup", servingDescription: "", calories: 300, protein: 10, carbs: 50, fats: 5 }] }];
    const b: MealGroup[] = [{ mealName: "Breakfast", items: [{ id: "different-id", foodName: "Oats", quantity: "1", unit: "cup", servingDescription: "", calories: 300, protein: 10, carbs: 50, fats: 5 }] }];
    expect(foodsEditorSignature(a, null, "")).toBe(foodsEditorSignature(b, null, ""));

    const c: MealGroup[] = [{ mealName: "Breakfast", items: [{ id: "a", foodName: "Rice", quantity: "1", unit: "cup", servingDescription: "", calories: 300, protein: 10, carbs: 50, fats: 5 }] }];
    expect(foodsEditorSignature(a, null, "")).not.toBe(foodsEditorSignature(c, null, ""));
  });

  it("treats an empty box and an all-whitespace box as the same 'no notes'", () => {
    expect(foodsEditorSignature([], null, "")).toBe(foodsEditorSignature([], null, "   "));
  });
});

describe("macroEditorSignature", () => {
  it("is stable across extra id fields and changes when a target changes", () => {
    const a = [{ id: "x", mealName: "Breakfast", calories: 500, protein: 40, carbs: 50, fats: 15 }];
    const b = [{ id: "y", mealName: "Breakfast", calories: 500, protein: 40, carbs: 50, fats: 15 }];
    expect(macroEditorSignature(a)).toBe(macroEditorSignature(b));

    const c = [{ id: "x", mealName: "Breakfast", calories: 600, protein: 40, carbs: 50, fats: 15 }];
    expect(macroEditorSignature(a)).not.toBe(macroEditorSignature(c));
  });
});
