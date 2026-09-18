import { describe, it, expect } from "vitest";
import { resolveDisplayPlanMode, isMislabeledMacroPlan } from "@/lib/meal-plans/display-mode";

describe("resolveDisplayPlanMode", () => {
  it("MACROS + 0 targets + 2 items renders as MEAL_PLAN (mislabeled foods plan)", () => {
    expect(resolveDisplayPlanMode("MACROS", { items: 2, macroTargets: 0 })).toBe("MEAL_PLAN");
  });

  it("MACROS + 0 targets + 0 items stays MACROS (a genuinely empty macro plan)", () => {
    expect(resolveDisplayPlanMode("MACROS", { items: 0, macroTargets: 0 })).toBe("MACROS");
  });

  it("MACROS + 2 targets + 2 items stays MACROS", () => {
    expect(resolveDisplayPlanMode("MACROS", { items: 2, macroTargets: 2 })).toBe("MACROS");
  });

  it("MEAL_PLAN always stays MEAL_PLAN", () => {
    expect(resolveDisplayPlanMode("MEAL_PLAN", { items: 0, macroTargets: 0 })).toBe("MEAL_PLAN");
    expect(resolveDisplayPlanMode("MEAL_PLAN", { items: 3, macroTargets: 3 })).toBe("MEAL_PLAN");
  });
});

describe("isMislabeledMacroPlan", () => {
  it("is true only for MACROS + 0 targets + items > 0", () => {
    expect(isMislabeledMacroPlan("MACROS", { items: 1, macroTargets: 0 })).toBe(true);
    expect(isMislabeledMacroPlan("MACROS", { items: 0, macroTargets: 0 })).toBe(false);
    expect(isMislabeledMacroPlan("MACROS", { items: 1, macroTargets: 1 })).toBe(false);
    expect(isMislabeledMacroPlan("MEAL_PLAN", { items: 1, macroTargets: 0 })).toBe(false);
  });
});
