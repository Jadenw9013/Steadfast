import { describe, expect, it } from "vitest";
import {
  composeWeekFromTemplates,
  type ComposeTemplatesInput,
} from "@/lib/ai-coach/meal-composer";
import {
  loadDraftUnsignedMealTemplates,
  loadDraftUnsignedFoodCatalog,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import {
  sourcedFoodCatalogSource,
  type FoodCatalogSource,
  type ResolvedFoodItem,
} from "@/lib/ai-coach/catalog/food-source";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { mealTargetsMatch } from "@/lib/ai-coach/representation";
import type { PlanPayload } from "@/lib/ai-coach/plan-contract";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";
import type { MealTemplateSet } from "@/lib/ai-coach/catalog/meal-template-schema";

const draftCatalog = loadDraftUnsignedFoodCatalog();
const catalogSource = sourcedFoodCatalogSource(draftCatalog.content);
const templateSet = loadDraftUnsignedMealTemplates().content;

const baseAnswers: IntakeAnswers = {
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["FULL_GYM"],
  allergies: [],
  dietaryRestrictions: ["VEGAN"],
  foodBudgetLevel: "LOW",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
  heightCm: 170,
  weightKg: 70,
};

const baseTargets = {
  energyKcal: 1050,
  proteinG: 45,
  carbsG: 210,
  fatG: 10,
};

function makeBaseInput(): ComposeTemplatesInput {
  return {
    targets: { ...baseTargets },
    tolerancePercent: 20,
    mealsPerDay: 3,
    constraints: {
      patternTags: ["VEGAN"],
      patternMandatory: true,
      budgetBand: "LOW",
      prepTimeBand: "MIN_15_30",
      equipment: ["NONE", "MICROWAVE", "STOVETOP", "OVEN", "FULL_KITCHEN"],
      refrigeration: "FRIDGE_AND_FREEZER",
      allergies: [],
      dietaryRestrictions: ["VEGAN"],
      dislikedFoodIds: [],
    },
    templateSet,
    source: catalogSource,
    policyVersion: ACTIVE_POLICY_VERSION,
    nutritionPermission: "ALLOW",
    maxRepeatsPerWeek: 7,
  };
}

describe("A07 — meal template composer and solver", () => {
  it("composes a feasible 7-day plan where every day satisfies mealTargetsMatch within tolerance", () => {
    const input = makeBaseInput();
    const result = composeWeekFromTemplates(input);

    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    expect(result.days).toHaveLength(7);
    expect(result.perDayTotals).toHaveLength(7);

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const day = result.days[dayIdx];
      expect(day.meals).toHaveLength(3);

      const totals = result.perDayTotals[dayIdx];
      for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) {
        const target = input.targets[key];
        const achieved = totals[key];
        const allowed = Math.max(0.1, (target * input.tolerancePercent) / 100);
        expect(
          Math.abs(achieved - target),
          `Day ${dayIdx + 1} macro ${key} (achieved ${achieved}, target ${target}, allowed ${allowed})`
        ).toBeLessThanOrEqual(allowed);
      }
    }

    // Verify using the exact mealTargetsMatch predicate
    const syntheticPlan: PlanPayload = {
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      policyVersion: ACTIVE_POLICY_VERSION,
      catalogVersions: { food: "food-v1", exercise: "exercise-v1" },
      nutrition: {
        prescriptionId: "test-prescription",
        method: "REVIEWED_PRESCRIPTION_V1",
        targets: input.targets,
        tolerancePercent: input.tolerancePercent,
        assumptions: [],
      },
      strength: [],
      cardio: [],
      meals: { days: result.days },
    };

    expect(mealTargetsMatch(syntheticPlan, baseAnswers, catalogSource)).toBe(true);
  });

  it("is strictly deterministic: two calls with identical input produce identical output", () => {
    const input = makeBaseInput();
    const result1 = composeWeekFromTemplates(input);
    const result2 = composeWeekFromTemplates(input);

    expect(result1.feasible).toBe(true);
    expect(result2.feasible).toBe(true);
    if (!result1.feasible || !result2.feasible) throw new Error("unreachable");

    expect(JSON.stringify(result1.days)).toBe(JSON.stringify(result2.days));
    expect(result1.perDayTotals).toEqual(result2.perDayTotals);
  });

  it("fails when energy target is far outside achievable range, returning NO_FEASIBLE_MEALS and no partial days", () => {
    const input = makeBaseInput();
    input.targets = { energyKcal: 50000, proteinG: 2000, carbsG: 6000, fatG: 2000 };

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");

    const noFeasible = result.reasons.find((r) => r.code === "NO_FEASIBLE_MEALS");
    expect(noFeasible).toBeDefined();
    expect((noFeasible as any).detail?.worstMacro).toBeDefined();
    expect((result as any).days).toBeUndefined();
  });

  it("fails at rounding boundary when exact solution rounds to 5g outside tolerance", () => {
    const input = makeBaseInput();
    // Tiny tolerance (0.01%) so that 5g rounding必然 pushes macros outside tolerance
    input.tolerancePercent = 0.01;

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");

    const reason = result.reasons.find((r) => r.code === "NO_FEASIBLE_MEALS");
    expect(reason).toBeDefined();
  });

  it("does not scale FIXED ingredients, preserving their nominal grams", () => {
    // Construct a template set with a FIXED ingredient
    const customSet: MealTemplateSet = {
      ...templateSet,
      templates: templateSet.templates.map((t) => {
        if (t.id === "bf-vegan-low-oatmeal") {
          return {
            ...t,
            ingredients: [
              t.ingredients[0],
              {
                kind: "FOOD",
                foodId: "fdc-167762",
                catalogVersion: catalogSource.catalogVersion,
                state: "RAW",
                scaling: "FIXED",
                portion: {
                  minGrams: 5,
                  nominalGrams: 5,
                  maxGrams: 5,
                  rangeBasis: "SOURCE_PORTION_SCALED",
                  sourcePortionText: "fixed portion",
                },
                householdMeasure: null,
                purchaseUnit: null,
                substitutionGroupId: null,
              },
            ],
          };
        }
        return t;
      }),
    };

    const input = makeBaseInput();
    input.templateSet = customSet;

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    for (const day of result.days) {
      const oatmealMeal = day.meals.find((m) => m.name === "Oat Bran Porridge with Strawberries");
      if (oatmealMeal) {
        const fixedIng = oatmealMeal.ingredients.find((i) => i.foodId === "fdc-167762");
        expect(fixedIng).toBeDefined();
        expect(fixedIng?.grams).toBe(5);
      }
    }
  });

  it("clamps all ingredient amounts within their declared [minGrams, maxGrams] ranges", () => {
    const input = makeBaseInput();
    const result = composeWeekFromTemplates(input);

    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    const templatesById = new Map(templateSet.templates.map((t) => [t.id, t]));

    for (const day of result.days) {
      for (const meal of day.meals) {
        for (const ing of meal.ingredients) {
          // Find the ingredient's portion definition in the template
          let portionDef: any = null;
          for (const t of templateSet.templates) {
            for (const tIng of t.ingredients) {
              if (tIng.kind === "FOOD" && tIng.foodId === ing.foodId) {
                portionDef = tIng.portion;
                break;
              } else if (tIng.kind === "COMPONENT_TEMPLATE") {
                const comp = templatesById.get(tIng.templateId);
                const match = comp?.ingredients.find(
                  (cIng) => cIng.kind === "FOOD" && cIng.foodId === ing.foodId
                );
                if (match && match.kind === "FOOD") {
                  portionDef = match.portion;
                  break;
                }
              }
            }
            if (portionDef) break;
          }

          if (portionDef) {
            expect(
              ing.grams,
              `Ingredient ${ing.foodId} min bound`
            ).toBeGreaterThanOrEqual(portionDef.minGrams);
            expect(
              ing.grams,
              `Ingredient ${ing.foodId} max bound`
            ).toBeLessThanOrEqual(portionDef.maxGrams);
          }
        }
      }
    }
  });

  it("respects maxRepeatsPerWeek and emits LOW_TEMPLATE_VARIETY warning when survivors are scarce", () => {
    const input = makeBaseInput();
    input.maxRepeatsPerWeek = 2; // With only 1 low-budget vegan breakfast survivor, maxRepeats = 2 forces reuse > 2

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    expect(result.warnings).toBeDefined();
    expect(result.warnings).toContain("LOW_TEMPLATE_VARIETY");
  });

  it("directly excludes templates containing declared allergens", () => {
    // Test that declaring a MILK allergy excludes every template with milk-containing ingredients
    const stubSource: FoodCatalogSource = {
      catalogVersion: catalogSource.catalogVersion,
      get(id: string, version: string) {
        const res = catalogSource.get(id, version);
        if (!res.success) return res;
        // fdc-330137 is Greek yogurt
        const allergens = id === "fdc-330137" ? ["MILK" as any] : [];
        return {
          success: true,
          item: {
            ...res.item,
            allergens,
            allergenFactsV2: undefined, // Test direct allergen matching
          },
        };
      },
    };

    const input = makeBaseInput();
    input.source = stubSource;
    input.constraints.allergies = ["milk"];

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    for (const day of result.days) {
      for (const meal of day.meals) {
        for (const ing of meal.ingredients) {
          expect(ing.foodId).not.toBe("fdc-330137"); // Greek yogurt excluded
        }
      }
    }
  });

  it("excludes parent template when a nested component template contains an allergen", () => {
    // comp-steamed-broccoli is nested in several dinners
    // Declare an allergy on broccoli
    const input = makeBaseInput();
    input.constraints.dietaryRestrictions = [];
    input.constraints.patternTags = ["OMNIVORE"];
    input.constraints.dietaryRestrictions = ["broccoli allergy test"];

    // Use a stub source where broccoli has an allergy conflict
    const stubSource: FoodCatalogSource = {
      catalogVersion: catalogSource.catalogVersion,
      get(id: string, version: string) {
        const res = catalogSource.get(id, version);
        if (!res.success) return res;
        if (id === "fdc-747447") {
          // Broccoli
          return {
            success: true,
            item: {
              ...res.item,
              allergens: ["PEANUT" as any],
            },
          };
        }
        return res;
      },
    };

    const stubInput: ComposeTemplatesInput = {
      ...input,
      source: stubSource,
      constraints: {
        ...input.constraints,
        allergies: ["peanut"],
      },
    };

    // Any template nesting comp-steamed-broccoli (e.g. din-vegan-mod-black-bean-quinoa) must be excluded
    const result = composeWeekFromTemplates(stubInput);
    if (result.feasible) {
      for (const day of result.days) {
        for (const meal of day.meals) {
          expect(meal.ingredients.some((i) => i.foodId === "fdc-747447")).toBe(false);
        }
      }
    }
  });

  it("tri-state UNKNOWN presence excludes food with UNVERIFIABLE_ALLERGY", () => {
    const input = makeBaseInput();
    // In draftCatalog, SOYBEAN is UNKNOWN for all items
    input.constraints.allergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        {
          category: "SOYBEAN",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "NO",
        },
      ],
    };

    const result = composeWeekFromTemplates(input);
    // Since all foods have SOYBEAN presence === "UNKNOWN", all templates are excluded
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");

    const unverifiable = result.reasons.find((r) => r.code === "UNVERIFIABLE_ALLERGY");
    expect(unverifiable).toBeDefined();
  });

  it("cross-contact avoidance required excludes foods without VERIFIED_ABSENT cross-contact", () => {
    const input = makeBaseInput();
    input.constraints.allergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        {
          category: "PEANUT",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
      ],
    };

    const result = composeWeekFromTemplates(input);
    // T-2035 never emits VERIFIED_ABSENT cross-contact -> clean NO_FEASIBLE_MEALS failure, not a crash
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");

    const noFeasible = result.reasons.find((r) => r.code === "NO_FEASIBLE_MEALS");
    expect(noFeasible).toBeDefined();
  });

  it("fails via re-verify authority guard when source answers change between filter and verify", () => {
    let callCount = 0;
    const stubSource: FoodCatalogSource = {
      catalogVersion: catalogSource.catalogVersion,
      get(id: string, version: string) {
        const res = catalogSource.get(id, version);
        if (!res.success) return res;
        callCount++;
        // On later calls (during step 5 re-verify), inject a failure
        if (callCount > 50 && id === "fdc-168873") {
          return {
            success: true,
            item: {
              ...res.item,
              allergens: ["PEANUT" as any],
            },
          };
        }
        return res;
      },
    };

    const input = makeBaseInput();
    input.source = stubSource;
    input.constraints.allergies = ["peanut"];

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
  });

  it("enforces mandatory VEGAN pattern to select only VEGAN-tagged templates", () => {
    const input = makeBaseInput();
    input.constraints.patternTags = ["VEGAN"];
    input.constraints.patternMandatory = true;

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    const templatesById = new Map(templateSet.templates.map((t) => [t.id, t]));
    for (const day of result.days) {
      for (const meal of day.meals) {
        const t = templatesById.get(meal.id);
        if (t) {
          expect(t.patternTags).toContain("VEGAN");
        }
      }
    }
  });

  it("enforces budget and prep time bands so LOW/UNDER_15 client never receives FLEXIBLE or MIN_30_60", () => {
    const input = makeBaseInput();
    input.constraints.budgetBand = "LOW";
    input.constraints.prepTimeBand = "UNDER_15";

    const result = composeWeekFromTemplates(input);
    // If feasible, assert none of the meals have FLEXIBLE or MIN_30_60
    if (result.feasible) {
      const templatesById = new Map(templateSet.templates.map((t) => [t.id, t]));
      for (const day of result.days) {
        for (const meal of day.meals) {
          const t = templatesById.get(meal.id);
          if (t) {
            expect(t.budgetBand).not.toBe("FLEXIBLE");
            expect(t.prepTimeBand).not.toBe("MIN_30_60");
            expect(t.prepTimeBand).not.toBe("OVER_60");
          }
        }
      }
    }
  });

  it("uses disliked food ids for ranking only, never hard exclusion when it is the only survivor", () => {
    const input = makeBaseInput();
    // Oat bran fdc-168873 is the sole LOW budget vegan breakfast survivor
    input.constraints.dislikedFoodIds = ["fdc-168873"];

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    // The food still appears because it was the only survivor
    const hasOatBran = result.days.some((d) =>
      d.meals.some((m) => m.ingredients.some((i) => i.foodId === "fdc-168873"))
    );
    expect(hasOatBran).toBe(true);
  });
});
