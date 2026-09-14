import { describe, expect, it } from "vitest";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { availableSubstitutions, representFixturePlan, isTargetPreserving } from "@/lib/ai-coach/representation";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";
import { getFoodItem } from "@/lib/ai-coach/catalog/loader";
const answers: IntakeAnswers = { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 };
describe("target-preserving meal representations", () => {
  it("switches macros to practical meals and back without replacing the prescription", () => {
    const base = buildInitialFixturePlan(answers, "stable-rx", "MACROS").payload;
    const meals = representFixturePlan(base, answers, "MEALS");
    expect(meals.payload?.meals?.days).toHaveLength(7);
    expect(meals.payload?.nutrition).toEqual(base.nutrition);
    const macro = representFixturePlan(meals.payload!, answers, "MACROS");
    expect(macro.payload?.nutrition?.prescriptionId).toBe("stable-rx"); expect(macro.payload?.meals).toBeNull();
  });
  it("swaps only a curated equivalent and checks all targets again", () => {
    const base = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    const changed = representFixturePlan(base, answers, "MEALS", { day: 1, mealId: base.meals!.days[0].meals[0].id, foodId: "brown-rice-cooked", replacementId: "fixture-grain-alternative" });
    expect(changed.payload).not.toBeNull(); expect(isTargetPreserving(base, changed.payload!, answers)).toBe(true);
    expect(base.meals!.days[0].meals[0].ingredients[1].foodId).toBe("brown-rice-cooked");
  });
  it("only offers feasible catalog substitutions and none for unverifiable constraints", () => {
    const plan = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    const offers = availableSubstitutions(plan, answers); expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) expect(representFixturePlan(plan, answers, "MEALS", offer).payload).not.toBeNull();
    expect(availableSubstitutions(plan, { ...answers, allergies: ["unverifiable"] })).toEqual([]);
  });
  it("rejects arbitrary food substitutions and new food constraints", () => {
    const base = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    expect(representFixturePlan(base, answers, "MEALS", { day: 1, mealId: base.meals!.days[0].meals[0].id, foodId: "brown-rice-cooked", replacementId: "peanut-butter" }).payload).toBeNull();
    expect(representFixturePlan({ ...base, meals: null }, { ...answers, allergies: ["unverifiable"] }, "MEALS").payload).toBeNull();
  });
  it("refuses altered targets labeled as a representation change", () => {
    const base = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    const tampered = structuredClone(base); tampered.nutrition!.targets.energyKcal -= 100;
    expect(isTargetPreserving(base, tampered, answers)).toBe(false);
  });
  it("retains old catalog records without making new substitutions exist retroactively", () => {
    expect(getFoodItem("brown-rice-cooked", "food-fixture-v1").success).toBe(true);
    expect(getFoodItem("fixture-grain-alternative", "food-fixture-v1").success).toBe(false);
  });
});
