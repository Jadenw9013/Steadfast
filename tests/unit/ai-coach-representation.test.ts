import { describe, expect, it } from "vitest";
import { buildInitialFixturePlan, composeFixtureMeals } from "@/lib/ai-coach/initial-plan";
import {
  availableSubstitutions,
  representFixturePlan,
  isTargetPreserving,
  substitutionOptionsFor,
  mealTargetsMatch,
} from "@/lib/ai-coach/representation";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";
import { getFoodItem } from "@/lib/ai-coach/catalog/loader";
import { FOOD_SUBSTITUTIONS } from "@/lib/ai-coach/catalog/food-catalog";
import { loadDraftUnsignedMealTemplates } from "@/lib/ai-coach/artifacts/drafts/loader";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import type { PlanPayload } from "@/lib/ai-coach/plan-contract";

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

  /**
   * Golden hashes captured from the pre-change code at base commit `408bf8f`
   * (clean tree) before this ticket touched `representation.ts`; see
   * board/evidence/T-2040.md for the capture command. They pin the
   * representation output for the existing fixture plan so the
   * `FOOD_CATALOG_VERSION` -> `payload.catalogVersions.food` rewrite and the
   * deleted re-labelling assignment cannot move it.
   */
  it("produces byte-identical representations for the existing fixture plan", () => {
    const stableMacro = buildInitialFixturePlan(answers, "stable-rx", "MACROS").payload;
    const meals = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    const represented = representFixturePlan(stableMacro, answers, "MEALS");
    const back = representFixturePlan(represented.payload!, answers, "MACROS");
    const sub = representFixturePlan(meals, answers, "MEALS", {
      day: 1,
      mealId: meals.meals!.days[0].meals[0].id,
      foodId: "brown-rice-cooked",
      replacementId: "fixture-grain-alternative",
    });
    expect({
      "represent.MACROS->MEALS.stable-rx": contentHash(represented.payload),
      "represent.MACROS->MEALS.stable-rx.decision": contentHash(represented.decision),
      "represent.MEALS->MACROS.stable-rx": contentHash(back.payload),
      "represent.substitution.rx": contentHash(sub.payload),
      "represent.substitution.rx.decision": contentHash(sub.decision),
      "availableSubstitutions.rx": contentHash(availableSubstitutions(meals, answers)),
    }).toEqual({
      "represent.MACROS->MEALS.stable-rx": "524c08330980659b2a369dd338adc361dca118404d89ebeb7252732bea9964af",
      "represent.MACROS->MEALS.stable-rx.decision": "a072bb3cd15c1af2acf50672de89167d780a9bf1e3e9e4aefd8c2cbabb90a3f4",
      "represent.MEALS->MACROS.stable-rx": "ba7e85ffa3a1eddab540cbb6d7d1c0a4f870c3f06b88f425075bd35691b73991",
      "represent.substitution.rx": "61d05702257a2885e5d363367d70a276706cd4f05224396609661574bdd80308",
      "represent.substitution.rx.decision": "a072bb3cd15c1af2acf50672de89167d780a9bf1e3e9e4aefd8c2cbabb90a3f4",
      "availableSubstitutions.rx": "87c19a131e1722a20d3a0baee3015d63c8ea0e090443987a3a5f5ff581b45806",
    });
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

describe("T-2040 — a plan bound to a catalog this build does not carry", () => {
  /** Training-only plan on a reviewed food catalog key the loader does not serve. */
  const liveKeyedPlan = () => {
    const base = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    return {
      ...base,
      contentKind: "REVIEWED_LIVE_V1" as const,
      catalogVersions: { ...base.catalogVersions, food: "usda-beginner-v1" },
    };
  };

  it("does not compose fixture meals into it, and degrades instead of disappearing", () => {
    const plan = liveKeyedPlan();
    const result = representFixturePlan(plan, answers, "MEALS");
    expect(result.payload).toBeNull();
    expect(result.decision.reasonCodes).toEqual(["NO_FEASIBLE_MEALS"]);
    // The plan itself is untouched: its food catalog key is not re-labelled.
    expect(plan.catalogVersions.food).toBe("usda-beginner-v1");
  });

  it("offers no substitutions and does not throw (the workspace read path)", () => {
    expect(() => availableSubstitutions(liveKeyedPlan(), answers)).not.toThrow();
    expect(availableSubstitutions(liveKeyedPlan(), answers)).toEqual([]);
  });

  it("still refuses a substitution whose ingredient key disagrees with the plan", () => {
    // The `:44` rewrite compares against the plan's own key instead of the
    // compile-time constant. It must not widen acceptance.
    const base = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    const mismatched = structuredClone(base);
    mismatched.meals!.days[0].meals[0].ingredients[1].catalogVersion = "food-fixture-v1";
    const result = representFixturePlan(mismatched, answers, "MEALS", {
      day: 1,
      mealId: base.meals!.days[0].meals[0].id,
      foodId: "brown-rice-cooked",
      replacementId: "fixture-grain-alternative",
    });
    expect(result.payload).toBeNull();
    expect(result.decision.reasonCodes).toEqual(["NO_FEASIBLE_MEALS"]);
  });

  it("(12) a payload bound to 'food-catalog' still returns NO_FEASIBLE_MEALS at the :85 gate, unchanged", () => {
    const base = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    const plan: PlanPayload = {
      ...base,
      contentKind: "REVIEWED_LIVE_V1",
      catalogVersions: { ...base.catalogVersions, food: "food-catalog" },
    };
    const result = representFixturePlan(plan, answers, "MEALS");
    expect(result.payload).toBeNull();
    expect(result.decision.reasonCodes).toEqual(["NO_FEASIBLE_MEALS"]);
    expect(plan.catalogVersions.food).toBe("food-catalog");
  });
});

describe("S-36a defect 2 — mealTargetsMatch's optional runtimePolicyArtifactKey", () => {
  it("(13) accepts a payload whose policyVersion is a live key with the 4th argument, and refuses it without the argument", () => {
    const meals = buildInitialFixturePlan(answers, "rx", "MEALS").payload.meals!;
    const livePayload: PlanPayload = {
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: "rx",
        method: "SYNTHETIC_CATALOG_MATCH",
        targets: { energyKcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
        tolerancePercent: 100,
        assumptions: [],
      },
      meals,
      strength: [],
      cardio: [],
      policyVersion: "policy-live-x",
      catalogVersions: { food: "food-fixture-v2", exercise: "exercise-fixture-v1" },
    };

    expect(mealTargetsMatch(livePayload, answers, undefined, "policy-live-x")).toBe(true);
    expect(mealTargetsMatch(livePayload, answers)).toBe(false);
  });
});

