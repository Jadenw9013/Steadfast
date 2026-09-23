import { describe, it, expect } from "vitest";
import { isPlanEmptyForMode } from "@/lib/meal-plans/publish-guard";
import { emptyPlanMessage } from "@/lib/meal-plans/publish-messages";

describe("isPlanEmptyForMode", () => {
  it("MACROS with 0 targets is empty, even with items", () => {
    expect(isPlanEmptyForMode("MACROS", { items: 5, macroTargets: 0 })).toBe(true);
  });

  it("MACROS with 2 targets is not empty", () => {
    expect(isPlanEmptyForMode("MACROS", { items: 0, macroTargets: 2 })).toBe(false);
  });

  it("MEAL_PLAN with 0 items is empty, even with targets", () => {
    expect(isPlanEmptyForMode("MEAL_PLAN", { items: 0, macroTargets: 3 })).toBe(true);
  });

  it("MEAL_PLAN with 3 items is not empty", () => {
    expect(isPlanEmptyForMode("MEAL_PLAN", { items: 3, macroTargets: 0 })).toBe(false);
  });
});

describe("emptyPlanMessage", () => {
  it("returns the frozen MEAL_PLAN sentence", () => {
    expect(emptyPlanMessage("MEAL_PLAN")).toBe("Add at least one food before publishing.");
  });

  it("returns the frozen MACROS sentence", () => {
    expect(emptyPlanMessage("MACROS")).toBe(
      "Add at least one meal with macro targets before publishing."
    );
  });
});
