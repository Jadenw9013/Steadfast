import { describe, expect, it } from "vitest";
import { buildInitialFixturePlan, composeFixtureMeals } from "@/lib/ai-coach/initial-plan";
import {
  availableSubstitutions,
  representFixturePlan,
  isTargetPreserving,
  substitutionOptionsFor,
} from "@/lib/ai-coach/representation";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";
import { getFoodItem } from "@/lib/ai-coach/catalog/loader";
import { FOOD_SUBSTITUTIONS } from "@/lib/ai-coach/catalog/food-catalog";
import { loadDraftUnsignedMealTemplates } from "@/lib/ai-coach/artifacts/drafts/loader";
import { contentHash } from "@/lib/ai-coach/canonical-json";

const answers: IntakeAnswers = {
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE"],
  allergies: [],
  dietaryRestrictions: [],
  foodBudgetLevel: "LOW",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
  heightCm: 170,
  weightKg: 70,
};

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

  it("T-2036: substitutionOptionsFor with no template set returns FOOD_SUBSTITUTIONS", () => {
    expect(substitutionOptionsFor("brown-rice-cooked")).toEqual(FOOD_SUBSTITUTIONS["brown-rice-cooked"]);
  });

  it("T-2036: substitutionOptionsFor with template set returns group members excluding food itself", () => {
    const templates = loadDraftUnsignedMealTemplates().content;
    const options = substitutionOptionsFor("fdc-2646170", templates);
    expect(options).toContain("fdc-174515");
    expect(options).not.toContain("fdc-2646170");
  });

  it("T-2036: golden hash of composeFixtureMeals matches pre-edit baseline", () => {
    const expectedGoldenHashes: Record<number, string> = {
      0.5: "1f3b37f1267464df0f6c1ee42d5f58116192a17edb122fb4e962eec8551c87c8",
      1: "05b6fe46bff28c7c669bec372a886c60ff6a2da351794678c649e129ef54d19b",
      1.37: "9f0438ad259f690e49249a33cdedd81f2577f3caef61a58ed41a3425a56fa8fd",
      2: "12d73f066d1ea108d345e77137abe3481d6a6d7df7dad60122e29aff3318fece",
    };

    for (const [scaleStr, expectedHash] of Object.entries(expectedGoldenHashes)) {
      const scale = Number(scaleStr);
      const meals = composeFixtureMeals(answers, scale);
      expect(contentHash(meals)).toBe(expectedHash);
    }
  });
});

