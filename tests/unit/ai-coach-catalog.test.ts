import { beforeAll, describe, expect, it } from "vitest";
import { getFoodItem, getExerciseItem, getCurrentFoodCatalogVersion, getCurrentExerciseCatalogVersion, foodCatalogIsServedInCode, exerciseCatalogIsServedInCode } from "@/lib/ai-coach/catalog/loader";
import { DRAFT_EXERCISE_CATALOG_VERSION } from "@/lib/ai-coach/artifacts/drafts/exercise-catalog";
import { disableDraftExerciseCatalog, enableDraftExerciseCatalog } from "@/lib/ai-coach/catalog/draft-exercise-catalog";
import { getDraftExerciseCatalog } from "@/lib/ai-coach/catalog/exercise-catalog";
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
    // T-2040 changed the *error*, not the verdict: `food-fixture-v0` is not in
    // the registry, so this build cannot resolve that catalog at all. It was
    // CATALOG_VERSION_MISMATCH, which claimed the reference was wrong; it is
    // now CATALOG_VERSION_NOT_SERVED, which says only that the key is not
    // carried here. Still `success: false`, still no throw.
    const result = getFoodItem("chicken-breast-raw", "food-fixture-v0");
    expect(result).toMatchObject({ success: false, error: "CATALOG_VERSION_NOT_SERVED" });
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

  it("reports a stale exercise catalog version as a catalog this build does not serve", () => {
    // T-2040: `exercise-fixture-v0` is not a key in the registry, so neither
    // reference below can be judged by this build. Both stay `success: false`.
    expect(getExerciseItem("bodyweight-squat", "exercise-fixture-v0")).toMatchObject({
      success: false,
      error: "CATALOG_VERSION_NOT_SERVED",
    });
    expect(getExerciseItem(DRAFT_ID, "exercise-fixture-v0")).toMatchObject({
      success: false,
      error: "CATALOG_VERSION_NOT_SERVED",
    });
  });
});

describe("T-2040 — catalog references resolve by key", () => {
  /** Runs `body` with the T-2038 draft catalog unavailable, as it always is in
   *  production, and restores whatever this file had registered before. */
  function withDraftUnavailable(body: () => void) {
    const wasEnabled = getDraftExerciseCatalog() !== null;
    disableDraftExerciseCatalog();
    try {
      body();
    } finally {
      if (wasEnabled) enableDraftExerciseCatalog();
    }
  }

  // The in-code catalogs are the fixture keys this build happens to carry. A
  // key it does not carry is "not served" — the reviewed artifact set is the
  // authority for it — and must be distinguishable from a reference this build
  // can check and finds wrong.
  it("resolves the served food keys exactly as before", () => {
    expect(getFoodItem("chicken-breast-raw", "food-fixture-v2")).toMatchObject({
      success: true,
      item: { name: "Chicken breast, raw", catalogVersion: "food-fixture-v2" },
    });
    // The legacy key keeps its own map: the v2-only item is absent from it.
    expect(getFoodItem("brown-rice-cooked", "food-fixture-v1")).toMatchObject({ success: true });
    expect(getFoodItem("fixture-grain-alternative", "food-fixture-v1")).toMatchObject({
      success: false,
      error: "UNKNOWN_ID",
    });
  });

  it("reports a key this build does not carry as NOT_SERVED, not as a bad reference", () => {
    expect(getFoodItem("chicken-breast-raw", "usda-beginner-v1")).toEqual({
      success: false,
      error: "CATALOG_VERSION_NOT_SERVED",
    });
    // `exercise-beginner-v1` is the draft key. Unavailable — which is always
    // the case in production — it is a catalog this build does not carry.
    withDraftUnavailable(() => {
      expect(getExerciseItem("goblet-squat", "exercise-beginner-v1")).toEqual({
        success: false,
        error: "CATALOG_VERSION_NOT_SERVED",
      });
    });
  });

  it("still reports an unknown id inside a served catalog as UNKNOWN_ID", () => {
    expect(getFoodItem("does-not-exist", "food-fixture-v2")).toEqual({
      success: false,
      error: "UNKNOWN_ID",
    });
    expect(getExerciseItem("does-not-exist", "exercise-fixture-v1")).toEqual({
      success: false,
      error: "UNKNOWN_ID",
    });
    expect(getExerciseItem("goblet-squat", "exercise-fixture-v1")).toMatchObject({ success: true });
  });

  it("names which catalogs this build serves", () => {
    expect(foodCatalogIsServedInCode("food-fixture-v2")).toBe(true);
    expect(foodCatalogIsServedInCode("food-fixture-v1")).toBe(true);
    expect(foodCatalogIsServedInCode("usda-beginner-v1")).toBe(false);
    expect(foodCatalogIsServedInCode("food-fixture-v0")).toBe(false);
    expect(exerciseCatalogIsServedInCode("exercise-fixture-v1")).toBe(true);
    expect(exerciseCatalogIsServedInCode("exercise-fixture-v0")).toBe(false);
    // The draft key is served only where the content is actually available,
    // which is never in production (T-2038).
    withDraftUnavailable(() => {
      expect(exerciseCatalogIsServedInCode("exercise-beginner-v1")).toBe(false);
      enableDraftExerciseCatalog();
      expect(exerciseCatalogIsServedInCode("exercise-beginner-v1")).toBe(true);
    });
  });

  it("keeps the lookup-error consumers failing closed on a not-served key", () => {
    // composition-feasibility and nutrition-totals surface the error string
    // rather than the payload. Neither may start succeeding.
    const components: RecipeComponent[] = [
      { foodId: "chicken-breast-raw", catalogVersion: "usda-beginner-v1", grams: 100 },
    ];
    const feasibility = checkMealComposition({
      components,
      allergies: [],
      dietaryRestrictions: [],
      nutritionPermission: "ALLOW",
      policyVersion: ACTIVE_POLICY_VERSION,
    });
    expect(feasibility).toMatchObject({
      feasible: false,
      reasons: [{ code: "CATALOG_REFERENCE_INVALID", detail: { error: "CATALOG_VERSION_NOT_SERVED" } }],
    });
    expect(computeNutrientTotals(components)).toMatchObject({
      success: false,
      error: "CATALOG_VERSION_NOT_SERVED",
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
