import { describe, expect, it } from "vitest";
import { getFoodItem, getExerciseItem, getCurrentFoodCatalogVersion, getCurrentExerciseCatalogVersion } from "@/lib/ai-coach/catalog/loader";
import { computeNutrientTotals, aggregateGramsByFood, type RecipeComponent } from "@/lib/ai-coach/nutrition-totals";
import { checkPolicyVersionUsable, ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { checkMealComposition } from "@/lib/ai-coach/composition-feasibility";

const FOOD_V = getCurrentFoodCatalogVersion();
const EXERCISE_V = getCurrentExerciseCatalogVersion();

describe("A04 — catalog loaders", () => {
  it("resolves a known food item at its declared version", () => {
    const result = getFoodItem("chicken-breast-raw", FOOD_V);
    expect(result).toMatchObject({ success: true, item: { name: "Chicken breast, raw" } });
  });

  it("rejects an unknown food id rather than returning undefined silently", () => {
    const result = getFoodItem("hallucinated-food-id", FOOD_V);
    expect(result).toMatchObject({ success: false, error: "UNKNOWN_ID" });
  });

  it("rejects a known food id referenced under a stale/wrong catalog version", () => {
    const result = getFoodItem("chicken-breast-raw", "food-fixture-v0");
    expect(result).toMatchObject({ success: false, error: "CATALOG_VERSION_MISMATCH" });
  });

  it("resolves a known exercise item and rejects an unknown one", () => {
    expect(getExerciseItem("bodyweight-squat", EXERCISE_V)).toMatchObject({ success: true });
    expect(getExerciseItem("nonexistent-exercise", EXERCISE_V)).toMatchObject({ success: false, error: "UNKNOWN_ID" });
  });
});

describe("A04 — deterministic nutrient totals", () => {
  it("scales per-serving nutrients by grams and sums across components", () => {
    const components: RecipeComponent[] = [
      { foodId: "chicken-breast-raw", catalogVersion: FOOD_V, grams: 200 }, // 2x serving
      { foodId: "brown-rice-cooked", catalogVersion: FOOD_V, grams: 100 }, // 1x serving
    ];
    const result = computeNutrientTotals(components);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.totals.energyKcal).toBeCloseTo(120 * 2 + 112, 5);
    expect(result.totals.proteinG).toBeCloseTo(22.5 * 2 + 2.3, 5);
    expect(result.byComponent).toHaveLength(2);
  });

  it("fails the whole computation on an unresolved catalog reference rather than dropping it", () => {
    const components: RecipeComponent[] = [
      { foodId: "chicken-breast-raw", catalogVersion: FOOD_V, grams: 100 },
      { foodId: "hallucinated-food-id", catalogVersion: FOOD_V, grams: 50 },
    ];
    const result = computeNutrientTotals(components);
    expect(result).toMatchObject({ success: false, error: "UNKNOWN_ID", foodId: "hallucinated-food-id" });
  });

  it("propagates incomplete-micronutrient status rather than hiding it", () => {
    const result = computeNutrientTotals([{ foodId: "chicken-breast-raw", catalogVersion: FOOD_V, grams: 100 }]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.totals.hasCompleteMicronutrients).toBe(false);
  });

  it("aggregates grams per food across a multiweek set of components", () => {
    const week1: RecipeComponent[] = [{ foodId: "brown-rice-cooked", catalogVersion: FOOD_V, grams: 150 }];
    const week2: RecipeComponent[] = [
      { foodId: "brown-rice-cooked", catalogVersion: FOOD_V, grams: 100 },
      { foodId: "broccoli-steamed", catalogVersion: FOOD_V, grams: 91 },
    ];
    const aggregated = aggregateGramsByFood([...week1, ...week2]);
    expect(aggregated.get("brown-rice-cooked")).toBe(250);
    expect(aggregated.get("broccoli-steamed")).toBe(91);
  });
});

describe("A04 — policy version compatibility/revocation", () => {
  it("accepts the currently active policy version", () => {
    expect(checkPolicyVersionUsable(ACTIVE_POLICY_VERSION)).toEqual({ usable: true });
  });

  it("rejects a revoked policy version with a distinct reason from an unknown one", () => {
    expect(checkPolicyVersionUsable("policy-fixture-v0")).toMatchObject({ usable: false, error: "POLICY_REVOKED" });
    expect(checkPolicyVersionUsable("policy-that-never-existed")).toMatchObject({ usable: false, error: "UNKNOWN_POLICY_VERSION" });
  });
});

describe("A04 — feasible composition", () => {
  const baseInput = {
    components: [{ foodId: "chicken-breast-raw", catalogVersion: FOOD_V, grams: 100 }] as RecipeComponent[],
    allergies: [] as string[],
    dietaryRestrictions: [] as string[],
    nutritionPermission: "ALLOW" as const,
    policyVersion: ACTIVE_POLICY_VERSION,
  };

  it("is feasible for a plain composition with no restrictions", () => {
    expect(checkMealComposition(baseInput)).toEqual({ feasible: true });
  });

  it("blocks composition when the nutrition domain is not ALLOW, independent of content", () => {
    const result = checkMealComposition({ ...baseInput, nutritionPermission: "PAUSED" });
    expect(result).toMatchObject({ feasible: false, reasons: [{ code: "NUTRITION_DOMAIN_NOT_ALLOWED" }] });
  });

  it("blocks composition against a revoked policy version", () => {
    const result = checkMealComposition({ ...baseInput, policyVersion: "policy-fixture-v0" });
    expect(result).toMatchObject({ feasible: false, reasons: [{ code: "POLICY_VERSION_REVOKED" }] });
  });

  it("flags a declared allergen present in a composed food (concealed-allergy case)", () => {
    const result = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "peanut-butter", catalogVersion: FOOD_V, grams: 32 }],
      allergies: ["peanut"],
    });
    expect(result).toMatchObject({ feasible: false, reasons: [{ code: "ALLERGEN_CONFLICT", detail: { foodId: "peanut-butter", allergen: "PEANUT" } }] });
  });

  it("conservatively blocks on an allergy it cannot map to a known catalog allergen, rather than ignoring it", () => {
    const result = checkMealComposition({ ...baseInput, allergies: ["some rare thing not in our catalog"] });
    expect(result).toMatchObject({ feasible: false, reasons: [{ code: "UNVERIFIABLE_ALLERGY" }] });
  });

  it("rejects a food missing a required dietary tag (gluten-free violated by wheat bread)", () => {
    const result = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "whole-wheat-bread", catalogVersion: FOOD_V, grams: 32 }],
      dietaryRestrictions: ["gluten free"],
    });
    expect(result).toMatchObject({ feasible: false, reasons: [{ code: "DIETARY_RESTRICTION_UNSATISFIED", detail: { foodId: "whole-wheat-bread", restriction: "GLUTEN_FREE" } }] });
  });

  it("rejects a hallucinated catalog id inside an otherwise-valid composition", () => {
    const result = checkMealComposition({ ...baseInput, components: [{ foodId: "hallucinated-food-id", catalogVersion: FOOD_V, grams: 100 }] });
    expect(result).toMatchObject({ feasible: false, reasons: [{ code: "CATALOG_REFERENCE_INVALID" }] });
  });

  it("accumulates multiple independent reasons rather than stopping at the first", () => {
    const result = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "peanut-butter", catalogVersion: FOOD_V, grams: 32 }],
      allergies: ["peanut"],
      nutritionPermission: "HOLD_ONLY",
    });
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    const codes = result.reasons.map((r) => r.code).sort();
    expect(codes).toEqual(["ALLERGEN_CONFLICT", "NUTRITION_DOMAIN_NOT_ALLOWED"]);
  });
});
