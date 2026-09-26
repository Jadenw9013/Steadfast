import { beforeAll, describe, expect, it } from "vitest";
import { getFoodItem, getExerciseItem, getCurrentFoodCatalogVersion, getCurrentExerciseCatalogVersion } from "@/lib/ai-coach/catalog/loader";
import { DRAFT_EXERCISE_CATALOG_VERSION } from "@/lib/ai-coach/artifacts/drafts/exercise-catalog";
import { enableDraftExerciseCatalog } from "@/lib/ai-coach/catalog/draft-exercise-catalog";
import { computeNutrientTotals, aggregateGramsByFood, type RecipeComponent } from "@/lib/ai-coach/nutrition-totals";
import { checkPolicyVersionUsable, ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { checkMealComposition } from "@/lib/ai-coach/composition-feasibility";
import { inCodeFoodCatalogSource } from "@/lib/ai-coach/catalog/food-source";

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

describe("T-2038 — exercise catalog version routing", () => {
  const DRAFT_ID = "chair-squat";

  // The draft resolves only where a server-side module has deliberately enabled
  // it through the guarded loader; it is never in a client bundle and never in
  // production. See tests/unit/ai-coach-exercise-catalog-draft.test.ts.
  beforeAll(() => {
    enableDraftExerciseCatalog();
  });

  it("still serves the three fixture items unchanged under exercise-fixture-v1", () => {
    // T-2005 decision (2): EXERCISE_CATALOG_VERSION is pinned by
    // runSnapshotSchema, so every stored AiCoachRun.inputSnapshot depends on
    // these three items staying byte-identical.
    expect(getCurrentExerciseCatalogVersion()).toBe("exercise-fixture-v1");
    expect(getExerciseItem("goblet-squat", EXERCISE_V)).toEqual({
      success: true,
      item: {
        id: "goblet-squat", catalogVersion: "exercise-fixture-v1", name: "Goblet squat",
        modality: "STRENGTH", requiredEquipment: ["HOME_BASIC", "FULL_GYM"], substitutionIds: ["bodyweight-squat"],
      },
    });
    expect(getExerciseItem("bodyweight-squat", EXERCISE_V)).toEqual({
      success: true,
      item: {
        id: "bodyweight-squat", catalogVersion: "exercise-fixture-v1", name: "Bodyweight squat",
        modality: "STRENGTH", requiredEquipment: ["NONE", "HOME_BASIC", "FULL_GYM"], substitutionIds: [],
      },
    });
    expect(getExerciseItem("brisk-walk", EXERCISE_V)).toEqual({
      success: true,
      item: {
        id: "brisk-walk", catalogVersion: "exercise-fixture-v1", name: "Brisk walk",
        modality: "CARDIO", requiredEquipment: ["NONE", "HOME_BASIC", "FULL_GYM"], substitutionIds: [],
      },
    });
  });

  it("serves the draft catalog under its own version, projected into the ExerciseItem shape", () => {
    const result = getExerciseItem(DRAFT_ID, DRAFT_EXERCISE_CATALOG_VERSION);
    expect(result).toMatchObject({
      success: true,
      item: {
        id: DRAFT_ID,
        catalogVersion: DRAFT_EXERCISE_CATALOG_VERSION,
        name: "Chair squat",
        modality: "STRENGTH",
        requiredEquipment: ["NONE", "HOME_BASIC", "FULL_GYM"],
      },
    });
    // Equipment IDs are mapped from the artifact tier vocabulary, not copied.
    const gymOnly = getExerciseItem("barbell-back-squat", DRAFT_EXERCISE_CATALOG_VERSION);
    expect(gymOnly).toMatchObject({ success: true, item: { requiredEquipment: ["FULL_GYM"] } });
  });

  it("keeps the two catalogs from leaking into each other", () => {
    expect(getExerciseItem(DRAFT_ID, EXERCISE_V)).toMatchObject({ success: false, error: "UNKNOWN_ID" });
    expect(getExerciseItem("bodyweight-squat", DRAFT_EXERCISE_CATALOG_VERSION)).toMatchObject({
      success: false,
      error: "UNKNOWN_ID",
    });
  });

  it("rejects a stale exercise catalog version exactly as it did before", () => {
    expect(getExerciseItem("bodyweight-squat", "exercise-fixture-v0")).toMatchObject({
      success: false,
      error: "CATALOG_VERSION_MISMATCH",
    });
    expect(getExerciseItem(DRAFT_ID, "exercise-fixture-v0")).toMatchObject({
      success: false,
      error: "UNKNOWN_ID",
    });
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

  it("T-2000: accepts a candidate whose policyVersion matches the supplied runtime policy artifact key", () => {
    expect(checkPolicyVersionUsable("live-release-policy-key", "live-release-policy-key")).toEqual({
      usable: true,
    });
  });

  it("T-2000: rejects a candidate whose policyVersion does not match the supplied runtime policy artifact key", () => {
    expect(checkPolicyVersionUsable("other", "live-release-policy-key")).toMatchObject({
      usable: false,
      error: "UNKNOWN_POLICY_VERSION",
    });
  });

  it("T-2000: revocation wins over a matching runtime policy artifact key", () => {
    expect(checkPolicyVersionUsable("policy-fixture-v0", "policy-fixture-v0")).toMatchObject({
      usable: false,
      error: "POLICY_REVOKED",
    });
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

  it("T-2036: explicit source: inCodeFoodCatalogSource produces identical result to omitting source", () => {
    const withoutSource = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "peanut-butter", catalogVersion: FOOD_V, grams: 32 }],
      allergies: ["peanut"],
    });
    const withSource = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "peanut-butter", catalogVersion: FOOD_V, grams: 32 }],
      allergies: ["peanut"],
      source: inCodeFoodCatalogSource,
    });
    expect(withSource).toEqual(withoutSource);
  });

  it("T-2036: computeNutrientTotals with and without source produces identical results", () => {
    const components: RecipeComponent[] = [
      { foodId: "chicken-breast-raw", catalogVersion: FOOD_V, grams: 150 },
      { foodId: "brown-rice-cooked", catalogVersion: FOOD_V, grams: 120 },
    ];
    const withoutSource = computeNutrientTotals(components);
    const withSource = computeNutrientTotals(components, inCodeFoodCatalogSource);
    expect(withSource).toEqual(withoutSource);
  });

  it("T-2036: checkMealComposition with allergenDeclarations on legacy item falls back to array semantics", () => {
    const legacyArrayResult = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "peanut-butter", catalogVersion: FOOD_V, grams: 32 }],
      allergies: ["peanut"],
    });
    const structuredResult = checkMealComposition({
      ...baseInput,
      components: [{ foodId: "peanut-butter", catalogVersion: FOOD_V, grams: 32 }],
      allergies: ["peanut"],
      allergenDeclarations: {
        status: "CONFIRMED",
        noKnownAllergens: false,
        items: [
          {
            category: "PEANUT",
            specificity: null,
            kind: "ALLERGY",
            crossContactAvoidanceRequired: "NO",
          },
        ],
      },
    });
    expect(structuredResult).toEqual(legacyArrayResult);
  });
});
