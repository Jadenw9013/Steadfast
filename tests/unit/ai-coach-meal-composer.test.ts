import { describe, expect, it } from "vitest";
import { composeWeekFromTemplates, type ComposeTemplatesInput } from "@/lib/ai-coach/meal-composer";
import {
  loadDraftUnsignedMealTemplates,
  loadDraftUnsignedFoodCatalog,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import {
  sourcedFoodCatalogSource,
  type FoodCatalogSource,
} from "@/lib/ai-coach/catalog/food-source";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { mealTargetsMatch } from "@/lib/ai-coach/representation";
import type { PlanPayload } from "@/lib/ai-coach/plan-contract";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";
import type { MealTemplateSet, PortionRange } from "@/lib/ai-coach/catalog/meal-template-schema";
import { composeMealsToPrescriptionWithReasons } from "@/lib/ai-coach/initial-plan";
import type { Prescription } from "@/lib/ai-coach/prescription";
import { computeNutrientTotals } from "@/lib/ai-coach/nutrition-totals";

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
  it("composes a realistic 2200 kcal / 150P / 250C / 70F prescription at 10% tolerance", () => {
    const input = makeBaseInput();
    input.targets = { energyKcal: 2200, proteinG: 150, carbsG: 250, fatG: 70 };
    input.tolerancePercent = 10;
    input.maxRepeatsPerWeek = 3;
    input.constraints = {
      ...input.constraints,
      patternTags: ["OMNIVORE"],
      dietaryRestrictions: [],
      budgetBand: "FLEXIBLE",
      prepTimeBand: "OVER_60",
    };

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error(JSON.stringify(result.reasons));

    expect(result.days).toHaveLength(7);
    for (const totals of result.perDayTotals) {
      for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) {
        expect(
          Math.abs(totals[key] - input.targets[key]),
          `${key}: achieved ${totals[key]}, target ${input.targets[key]}`
        ).toBeLessThanOrEqual((input.targets[key] * input.tolerancePercent) / 100);
      }
    }

    const repeats = new Map<string, number>();
    for (const day of result.days) {
      for (const meal of day.meals) {
        const templateId = meal.id.replace(/^template-meal-\d+-/, "");
        repeats.set(templateId, (repeats.get(templateId) ?? 0) + 1);
      }
    }
    for (const [templateId, count] of repeats) {
      expect(count, `${templateId} repeat count`).toBeLessThanOrEqual(input.maxRepeatsPerWeek);
    }
  });

  it("selects different macro-fit templates for materially different prescriptions", () => {
    const lowInput = makeBaseInput();
    lowInput.targets = { energyKcal: 1600, proteinG: 100, carbsG: 180, fatG: 50 };
    lowInput.tolerancePercent = 10;
    lowInput.maxRepeatsPerWeek = 7;
    lowInput.constraints = {
      ...lowInput.constraints,
      patternTags: ["OMNIVORE"],
      dietaryRestrictions: [],
      budgetBand: "FLEXIBLE",
      prepTimeBand: "OVER_60",
    };
    const highInput: ComposeTemplatesInput = {
      ...lowInput,
      targets: { energyKcal: 3000, proteinG: 190, carbsG: 350, fatG: 100 },
    };

    const low = composeWeekFromTemplates(lowInput);
    const high = composeWeekFromTemplates(highInput);
    expect(low.feasible).toBe(true);
    expect(high.feasible).toBe(true);
    if (!low.feasible || !high.feasible) throw new Error("expected both prescriptions to compose");

    const selectedIds = (result: typeof low) =>
      result.days[0].meals.map((meal) => meal.id.replace(/^template-meal-\d+-/, ""));
    expect(selectedIds(low)).not.toEqual(selectedIds(high));
  });

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
    expect(noFeasible?.detail?.worstMacro).toBeDefined();
    expect("days" in result).toBe(false);
  });

  it("fails at rounding boundary when exact solution rounds to 5g outside tolerance", () => {
    const input = makeBaseInput();
    // Tiny tolerance (0.01%) so that 5g rounding inevitably pushes macros outside tolerance
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
          let portionDef: PortionRange | null = null;
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
            expect(ing.grams, `Ingredient ${ing.foodId} min bound`).toBeGreaterThanOrEqual(
              portionDef.minGrams
            );
            expect(ing.grams, `Ingredient ${ing.foodId} max bound`).toBeLessThanOrEqual(
              portionDef.maxGrams
            );
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
        const categories = (res.item.allergenFactsV2?.categories ?? []).map((cat) => {
          if (cat.category === "MILK") {
            return {
              ...cat,
              presence: id === "fdc-330137" ? ("PRESENT" as const) : ("VERIFIED_ABSENT" as const),
              crossContact: "VERIFIED_ABSENT" as const,
            };
          }
          return cat;
        });
        return {
          success: true,
          item: {
            ...res.item,
            allergenFactsV2: res.item.allergenFactsV2
              ? {
                  ...res.item.allergenFactsV2,
                  categories,
                }
              : undefined,
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
    // Create a stub template set with only din-omni-low-chicken-broccoli in DINNER slot
    const stubTemplateSet: MealTemplateSet = {
      ...templateSet,
      templates: templateSet.templates.filter(
        (t) => t.slot !== "DINNER" || t.id === "din-omni-low-chicken-broccoli" || t.isComponent
      ),
    };

    const stubSource: FoodCatalogSource = {
      catalogVersion: catalogSource.catalogVersion,
      get(id: string, version: string) {
        const res = catalogSource.get(id, version);
        if (!res.success) return res;
        const categories = (res.item.allergenFactsV2?.categories ?? []).map((cat) => {
          if (cat.category === "PEANUT") {
            return {
              ...cat,
              presence: id === "fdc-747447" ? ("PRESENT" as const) : ("VERIFIED_ABSENT" as const),
              crossContact: "VERIFIED_ABSENT" as const,
            };
          }
          return cat;
        });
        return {
          success: true,
          item: {
            ...res.item,
            allergenFactsV2: res.item.allergenFactsV2
              ? {
                  ...res.item.allergenFactsV2,
                  categories,
                }
              : undefined,
          },
        };
      },
    };

    const stubInput: ComposeTemplatesInput = {
      ...makeBaseInput(),
      templateSet: stubTemplateSet,
      source: stubSource,
      constraints: {
        ...makeBaseInput().constraints,
        patternTags: ["OMNIVORE"],
        patternMandatory: false,
        dietaryRestrictions: [],
        allergies: ["peanut"],
      },
    };

    const result = composeWeekFromTemplates(stubInput);
    // Unconditional assertion: must fail because dinner slot has zero survivors
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");

    // Assert the failure reasons explicitly name the parent template ID
    const parentReason = result.reasons.find(
      (r) => r.detail?.templateId === "din-omni-low-chicken-broccoli"
    );
    expect(parentReason).toBeDefined();
    expect(parentReason?.code).toBe("ALLERGEN_CONFLICT");
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

  it("fails via the step-5 re-verify authority guard when source answers change after filtering", () => {
    let oatLookupCount = 0;
    const stubSource: FoodCatalogSource = {
      catalogVersion: catalogSource.catalogVersion,
      get(id: string, version: string) {
        const res = catalogSource.get(id, version);
        if (!res.success) return res;
        if (id === "fdc-168873") oatLookupCount++;
        const categories = (res.item.allergenFactsV2?.categories ?? []).map((category) =>
          category.category === "PEANUT"
            ? {
                ...category,
                presence:
                  id === "fdc-168873" && oatLookupCount >= 5
                    ? ("PRESENT" as const)
                    : ("VERIFIED_ABSENT" as const),
                crossContact: "VERIFIED_ABSENT" as const,
              }
            : category
        );
        return {
          success: true,
          item: {
            ...res.item,
            allergenFactsV2: res.item.allergenFactsV2
              ? { ...res.item.allergenFactsV2, categories }
              : undefined,
          },
        };
      },
    };

    const input = makeBaseInput();
    input.source = stubSource;
    input.constraints.allergies = ["peanut"];

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    expect(oatLookupCount).toBeGreaterThanOrEqual(5);
    expect(
      result.reasons.some(
        (reason) => reason.code === "ALLERGEN_CONFLICT" && reason.detail?.phase === "FINAL_REVERIFY"
      )
    ).toBe(true);
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
        const templateId = meal.id.replace(/^template-meal-\d+-/, "");
        const t = templatesById.get(templateId);
        expect(t, `Template ${templateId} must exist`).toBeDefined();
        expect(t!.patternTags).toContain("VEGAN");
      }
    }
  });

  it.each(["VEGAN", "PESCATARIAN", "OMNIVORE"] as const)(
    "enforces mandatory %s dietary-pattern filtering",
    (pattern) => {
      const input = makeBaseInput();
      input.maxRepeatsPerWeek = 7;
      input.constraints = {
        ...input.constraints,
        patternTags: [pattern],
        patternMandatory: true,
        dietaryRestrictions: [],
        budgetBand: "FLEXIBLE",
        prepTimeBand: "OVER_60",
      };

      const result = composeWeekFromTemplates(input);
      expect(result.feasible).toBe(true);
      if (!result.feasible) throw new Error(JSON.stringify(result.reasons));

      const templatesById = new Map(
        templateSet.templates.map((template) => [template.id, template])
      );
      for (const day of result.days) {
        for (const meal of day.meals) {
          const templateId = meal.id.replace(/^template-meal-\d+-/, "");
          expect(templatesById.get(templateId)?.patternTags).toContain(pattern);
        }
      }
    }
  );

  it("enforces budget and prep time bands so LOW/MIN_15_30 client never receives FLEXIBLE or MIN_30_60", () => {
    const input = makeBaseInput();
    input.constraints.budgetBand = "LOW";
    input.constraints.prepTimeBand = "MIN_15_30";

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    const templatesById = new Map(templateSet.templates.map((t) => [t.id, t]));
    for (const day of result.days) {
      for (const meal of day.meals) {
        const templateId = meal.id.replace(/^template-meal-\d+-/, "");
        const t = templatesById.get(templateId);
        expect(t, `Template ${templateId} must exist`).toBeDefined();
        expect(t!.budgetBand).not.toBe("FLEXIBLE");
        expect(t!.budgetBand).not.toBe("MODERATE");
        expect(t!.prepTimeBand).not.toBe("MIN_30_60");
        expect(t!.prepTimeBand).not.toBe("OVER_60");
      }
    }

    // Also assert that requesting UNDER_15 when no VEGAN dinner satisfies it fails closed cleanly
    const under15Input = {
      ...input,
      constraints: {
        ...input.constraints,
        prepTimeBand: "UNDER_15" as const,
      },
    };
    const under15Result = composeWeekFromTemplates(under15Input);
    expect(under15Result.feasible).toBe(false);
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

  it("composeMealsToPrescriptionWithReasons merges answers allergies and enforces permission", () => {
    const testRx: Prescription = {
      method: "REVIEWED_PRESCRIPTION_V1",
      energyMethodStructureId: "test",
      parameterSetDigest: "test",
      targetEnergyKcal: 1050,
      maintenanceEnergyKcal: 2000,
      projectedWeeklyWeightChangeKg: 0,
      appliedBoundIds: [],
      proteinG: 45,
      carbohydrateRangeG: { min: 200, max: 220 },
      fatRangeG: { min: 5, max: 15 },
      tolerancePercent: 20,
      assumptions: [],
    };

    const answersWithPeanut: IntakeAnswers = {
      ...baseAnswers,
      allergies: ["peanut"],
      dietaryRestrictions: ["VEGAN"],
    };

    // Caller passes empty constraints.allergies, but answers has "peanut"
    const options = {
      templateSet,
      source: catalogSource,
      constraints: {
        patternTags: ["VEGAN"] as ("OMNIVORE" | "LACTO_OVO_VEGETARIAN" | "VEGAN" | "PESCATARIAN")[],
        patternMandatory: true,
        budgetBand: "LOW" as const,
        prepTimeBand: "MIN_15_30" as const,
        equipment: ["NONE", "MICROWAVE", "STOVETOP", "OVEN", "FULL_KITCHEN"] as (
          | "NONE"
          | "MICROWAVE"
          | "STOVETOP"
          | "OVEN"
          | "FULL_KITCHEN"
        )[],
        refrigeration: "FRIDGE_AND_FREEZER" as const,
        allergies: [],
        dietaryRestrictions: ["VEGAN"],
        dislikedFoodIds: [],
      },
      nutritionPermission: "ALLOW" as const,
    };

    const res = composeMealsToPrescriptionWithReasons(
      answersWithPeanut,
      testRx,
      catalogSource.catalogVersion,
      options
    );

    // The answer-owned allergy is merged even though the options bag is
    // empty. Draft items cannot verify PEANUT absence, so composition must
    // fail closed; this assertion cannot be skipped behind `if (res.meals)`.
    expect(res.meals).toBeNull();
    expect(res.reasons.some((reason) => reason.code === "UNVERIFIABLE_ALLERGY")).toBe(true);

    // When nutritionPermission is PAUSED, it must return meals: null with structured reasons
    const pausedRes = composeMealsToPrescriptionWithReasons(
      answersWithPeanut,
      testRx,
      catalogSource.catalogVersion,
      {
        ...options,
        nutritionPermission: "PAUSED",
      }
    );
    expect(pausedRes.meals).toBeNull();
    expect(pausedRes.reasons.length).toBeGreaterThan(0);
    expect(pausedRes.reasons.some((r) => r.code === "NUTRITION_DOMAIN_NOT_ALLOWED")).toBe(true);
  });

  it("reports the macros from the retained best rounded iterate when no solution is in tolerance", () => {
    const selectedIds = new Set([
      "bf-vegan-low-oatmeal",
      "lu-lacto-low-egg-pita-salad",
      "din-lacto-low-egg-rice-bowl",
    ]);
    const fixedTemplates = templateSet.templates
      .filter((template) => template.isComponent || selectedIds.has(template.id))
      .map((template) => ({
        ...template,
        ingredients: template.ingredients.map((ingredient) =>
          ingredient.kind === "FOOD"
            ? {
                ...ingredient,
                scaling: "FIXED" as const,
                portion: {
                  ...ingredient.portion,
                  minGrams: ingredient.portion.nominalGrams,
                  maxGrams: ingredient.portion.nominalGrams,
                },
              }
            : ingredient
        ),
      }));
    const fixedSet: MealTemplateSet = { ...templateSet, templates: fixedTemplates };
    const input = makeBaseInput();
    input.templateSet = fixedSet;
    input.targets = { energyKcal: 5000, proteinG: 400, carbsG: 600, fatG: 200 };
    input.tolerancePercent = 1;
    input.maxRepeatsPerWeek = 7;
    input.constraints = {
      ...input.constraints,
      patternTags: ["PESCATARIAN"],
      dietaryRestrictions: [],
      budgetBand: "FLEXIBLE",
      prepTimeBand: "OVER_60",
    };

    const fixedById = new Map(fixedTemplates.map((template) => [template.id, template]));
    const expectedComponents = fixedTemplates
      .filter((template) => selectedIds.has(template.id))
      .flatMap((template) =>
        template.ingredients.flatMap((ingredient) => {
          const foods =
            ingredient.kind === "FOOD"
              ? [ingredient]
              : (fixedById.get(ingredient.templateId)?.ingredients ?? []).filter(
                  (nested) => nested.kind === "FOOD"
                );
          return foods.flatMap((food) =>
            food.kind === "FOOD"
              ? [
                  {
                    foodId: food.foodId,
                    catalogVersion: food.catalogVersion,
                    grams:
                      food.portion.nominalGrams *
                      (ingredient.kind === "COMPONENT_TEMPLATE" ? ingredient.servings : 1),
                  },
                ]
              : []
          );
        })
      );
    const expected = computeNutrientTotals(expectedComponents, catalogSource);
    expect(expected.success).toBe(true);
    if (!expected.success) throw new Error("fixture foods must resolve");

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    const reason = result.reasons.find((candidate) => candidate.code === "NO_FEASIBLE_MEALS");
    expect(reason).toBeDefined();
    const worstMacro = reason?.detail?.worstMacro as "energyKcal" | "proteinG" | "carbsG" | "fatG";
    expect(Number(reason?.detail?.achieved)).toBe(expected.totals[worstMacro]);
  });

  // -------------------------------------------------------------------------
  // S-36a — four defects fixed so the composer can succeed against a bound
  // catalog. Each test here fails on `team/sprint-1@faed556`.
  // -------------------------------------------------------------------------

  it("a full-kitchen client reaches every template that needs an appliance", () => {
    // S-36a defect 1 regression: on faed556 a client who declares only
    // FULL_KITCHEN is checked by set membership against `requiredEquipment`,
    // so every STOVETOP/OVEN/MICROWAVE template is rejected and DINNER has
    // zero survivors (`faed556`: NO_FEASIBLE_MEALS, detail.slot === "DINNER").
    const input = makeBaseInput();
    input.targets = { energyKcal: 2200, proteinG: 150, carbsG: 250, fatG: 70 };
    input.tolerancePercent = 10;
    input.maxRepeatsPerWeek = 3;
    input.constraints = {
      ...input.constraints,
      patternTags: ["OMNIVORE"],
      patternMandatory: false,
      dietaryRestrictions: [],
      budgetBand: "FLEXIBLE",
      prepTimeBand: "OVER_60",
      equipment: ["FULL_KITCHEN"],
    };

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error(JSON.stringify(result.reasons));

    const templatesById = new Map(templateSet.templates.map((t) => [t.id, t]));
    const applianceTemplatesUsed = new Set<string>();
    for (const day of result.days) {
      for (const meal of day.meals) {
        const templateId = meal.id.replace(/^template-meal-\d+-/, "");
        const t = templatesById.get(templateId);
        if (t && !(t.requiredEquipment.length === 1 && t.requiredEquipment[0] === "NONE")) {
          applianceTemplatesUsed.add(templateId);
        }
      }
    }
    expect(
      applianceTemplatesUsed.size,
      "a FULL_KITCHEN-only client must be able to reach at least one appliance-requiring template"
    ).toBeGreaterThan(0);
  });

  it("a MICROWAVE-only client still rejects a STOVETOP template (the lattice widens, it does not erase the filter)", () => {
    const dinnerStovetop = templateSet.templates.find(
      (t) =>
        !t.isComponent &&
        t.slot === "DINNER" &&
        t.requiredEquipment.length === 1 &&
        t.requiredEquipment[0] === "STOVETOP"
    );
    expect(dinnerStovetop, "fixture must contain a STOVETOP-only dinner template").toBeDefined();

    const restrictedSet: MealTemplateSet = {
      ...templateSet,
      templates: templateSet.templates.filter(
        (t) => t.isComponent || t.slot !== "DINNER" || t.id === dinnerStovetop!.id
      ),
    };

    const input = makeBaseInput();
    input.templateSet = restrictedSet;
    input.constraints = {
      ...input.constraints,
      equipment: ["MICROWAVE"],
      patternTags: [],
      patternMandatory: false,
      dietaryRestrictions: [],
      budgetBand: "FLEXIBLE",
      prepTimeBand: "OVER_60",
    };

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");

    const noFeasible = result.reasons.find(
      (r) => r.code === "NO_FEASIBLE_MEALS" && r.detail?.slot === "DINNER"
    );
    expect(noFeasible).toBeDefined();
    const equipmentRejection = result.reasons.find(
      (r) =>
        r.code === "DIETARY_RESTRICTION_UNSATISFIED" &&
        r.detail?.templateId === dinnerStovetop!.id &&
        r.detail?.reason === "EQUIPMENT_UNAVAILABLE"
    );
    expect(equipmentRejection).toBeDefined();
  });

  it("payloadCatalogVersion restamps every emitted ingredient while resolution still succeeds against the template's declared version", () => {
    const input = makeBaseInput();
    input.payloadCatalogVersion = "food-catalog";

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error(JSON.stringify(result.reasons));

    for (const day of result.days) {
      for (const meal of day.meals) {
        for (const ing of meal.ingredients) {
          expect(ing.catalogVersion).toBe("food-catalog");
        }
      }
    }
  });

  it("omitting payloadCatalogVersion reproduces today's emitted ingredients byte for byte", () => {
    const input = makeBaseInput();
    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error("unreachable");

    for (const day of result.days) {
      for (const meal of day.meals) {
        for (const ing of meal.ingredients) {
          expect(ing.catalogVersion).toBe(catalogSource.catalogVersion);
        }
      }
    }
  });

  it("returns CATALOG_REFERENCE_INVALID before any solve when the injected source disagrees with payloadCatalogVersion", () => {
    const input = makeBaseInput();
    input.payloadCatalogVersion = "food-catalog";
    input.source = {
      catalogVersion: "food-catalog-v2:v2",
      get: catalogSource.get.bind(catalogSource),
    };

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    expect(result.reasons).toEqual([
      {
        code: "CATALOG_REFERENCE_INVALID",
        detail: { expected: "food-catalog", actual: "food-catalog-v2:v2" },
      },
    ]);
  });

  it("a two-argument runtime policy key composes while omitting it on the same input returns POLICY_UNKNOWN_VERSION", () => {
    const input = makeBaseInput();
    input.policyVersion = "policy-live-x";
    input.runtimePolicyArtifactKey = "policy-live-x";

    const result = composeWeekFromTemplates(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) throw new Error(JSON.stringify(result.reasons));

    const withoutKey = composeWeekFromTemplates({ ...input, runtimePolicyArtifactKey: undefined });
    expect(withoutKey.feasible).toBe(false);
    if (withoutKey.feasible) throw new Error("unreachable");
    expect(withoutKey.reasons.some((r) => r.code === "POLICY_UNKNOWN_VERSION")).toBe(true);
  });
});
