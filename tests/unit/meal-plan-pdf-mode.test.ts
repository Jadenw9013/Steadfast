import { describe, expect, it } from "vitest";
import {
  renderMealPlanPdf,
  resolveMealPlanPdfContent,
  type MealPlanPdfData,
} from "@/lib/pdf/meal-plan-pdf";

/**
 * T-101 review finding 1 — the client-facing PDF export must be planMode-aware.
 *
 * Since T-101, `items` and `macroTargets` coexist on every meal-plan version
 * (carry-forward keeps both so mode switching is reversible), so a MACROS plan
 * routinely carries the previous foods plan's items and that plan's food-level
 * `planExtras`. Rendering either in macro mode would give the client a
 * downloadable document listing last week's foods as their current plan.
 *
 * `resolveMealPlanPdfContent` is the gate the PDF document renders from, so
 * these assertions pin the behavior without parsing PDF bytes (react-pdf
 * subsets fonts, so rendered text is not recoverable from the buffer).
 */

const FOOD_ITEMS = [
  { mealName: "Breakfast", foodName: "Oats", quantity: "80", unit: "g", servingDescription: null },
  { mealName: "Lunch", foodName: "Chicken breast", quantity: "200", unit: "g", servingDescription: "1 fillet" },
];

const MACRO_TARGETS = [
  { mealName: "Meal 1", calories: 500, protein: 40, carbs: 50, fats: 15 },
  { mealName: "Meal 2", calories: 700, protein: 50, carbs: 70, fats: 20 },
];

const PLAN_EXTRAS = {
  dayOverrides: [
    {
      label: "High Carb Day",
      weekdays: ["Monday"],
      mealAdjustments: [
        { mealName: "Breakfast", changes: [{ type: "add" as const, food: "Rice cakes", newPortion: "2" }] },
      ],
    },
  ],
};

describe("resolveMealPlanPdfContent — planMode gate", () => {
  it("renders macro targets and zero food rows for a MACROS plan carrying foods forward", () => {
    const data: MealPlanPdfData = {
      clientName: "Test Client",
      planMode: "MACROS",
      items: FOOD_ITEMS,
      macroTargets: MACRO_TARGETS,
      planExtras: PLAN_EXTRAS,
      supportContent: "Hit your protein.",
    };

    const resolved = resolveMealPlanPdfContent(data);

    expect(resolved.mode).toBe("MACROS");
    // The whole point: carried-forward foods never reach the client's PDF.
    expect(resolved.foodItems).toEqual([]);
    // Nor do the previous foods plan's food-level day overrides.
    expect(resolved.planExtras).toBeNull();
    expect(resolved.macroTargets).toEqual(MACRO_TARGETS);
    expect(resolved.supportContent).toBe("Hit your protein.");
  });

  it("renders an empty macro state rather than foods when a MACROS plan has no targets", () => {
    const resolved = resolveMealPlanPdfContent({
      clientName: "Test Client",
      planMode: "MACROS",
      items: FOOD_ITEMS,
      macroTargets: [],
      planExtras: PLAN_EXTRAS,
    });

    expect(resolved.mode).toBe("MACROS");
    expect(resolved.foodItems).toEqual([]);
    expect(resolved.macroTargets).toEqual([]);
    expect(resolved.planExtras).toBeNull();
  });

  it("is unchanged for a MEAL_PLAN plan: foods and plan extras render, macro targets do not", () => {
    const resolved = resolveMealPlanPdfContent({
      clientName: "Test Client",
      planMode: "MEAL_PLAN",
      items: FOOD_ITEMS,
      macroTargets: MACRO_TARGETS,
      planExtras: PLAN_EXTRAS,
    });

    expect(resolved.mode).toBe("MEAL_PLAN");
    expect(resolved.foodItems).toEqual(FOOD_ITEMS);
    expect(resolved.planExtras).toEqual(PLAN_EXTRAS);
    // Foods-mode output stays byte-identical to before the mode gate.
    expect(resolved.macroTargets).toEqual([]);
  });

  it("drops plan notes in MEAL_PLAN mode even when the caller passes them (single decision site)", () => {
    // Review r2 finding 2a: the export route now passes `supportContent`
    // unconditionally, so this resolver is the only place the mode rule lives.
    // The foods PDF still carries no notes (regression safety — it never has),
    // which is the documented asymmetry with the in-app foods view.
    const resolved = resolveMealPlanPdfContent({
      clientName: "Test Client",
      planMode: "MEAL_PLAN",
      items: FOOD_ITEMS,
      supportContent: "Notes the coach wrote for the foods week.",
    });

    expect(resolved.mode).toBe("MEAL_PLAN");
    expect(resolved.supportContent).toBeNull();
  });

  it("treats an omitted planMode as MEAL_PLAN (callers predating macro mode)", () => {
    const resolved = resolveMealPlanPdfContent({ clientName: "Test Client", items: FOOD_ITEMS });

    expect(resolved.mode).toBe("MEAL_PLAN");
    expect(resolved.foodItems).toEqual(FOOD_ITEMS);
    expect(resolved.macroTargets).toEqual([]);
  });

  it("renders a valid PDF document in both modes", async () => {
    const macros = await renderMealPlanPdf({
      clientName: "Test Client",
      planMode: "MACROS",
      items: FOOD_ITEMS,
      macroTargets: MACRO_TARGETS,
      planExtras: PLAN_EXTRAS,
      supportContent: "Hit your protein.",
    });
    const foods = await renderMealPlanPdf({
      clientName: "Test Client",
      planMode: "MEAL_PLAN",
      items: FOOD_ITEMS,
      planExtras: PLAN_EXTRAS,
    });

    for (const buffer of [macros, foods]) {
      expect(buffer.length).toBeGreaterThan(0);
      expect(Buffer.from(buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
  }, 30_000);
});
