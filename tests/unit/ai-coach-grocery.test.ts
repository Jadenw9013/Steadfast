import { describe, expect, it } from "vitest";
import { buildGroceryList, type GroceryLine } from "@/lib/ai-coach/grocery";
import {
  inCodeFoodCatalogSource,
  sourcedFoodCatalogSource,
  type FoodCatalogSource,
  type ResolvedFoodItem,
} from "@/lib/ai-coach/catalog/food-source";
import { loadDraftUnsignedFoodCatalog } from "@/lib/ai-coach/artifacts/drafts/loader";
import { aggregateGramsByFood } from "@/lib/ai-coach/nutrition-totals";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import type { PlanPayload } from "@/lib/ai-coach/plan-contract";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";

const draftCatalog = loadDraftUnsignedFoodCatalog();
const draftSource = sourcedFoodCatalogSource(draftCatalog.content);

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

describe("A07 — grocery aggregation and purchase vs consumed quantities", () => {
  it("produces consumed grams exactly equal to aggregateGramsByFood for a week", () => {
    const plan = buildInitialFixturePlan(answers, "test-rx", "MEALS").payload;
    expect(plan?.meals).not.toBeNull();
    const days = plan!.meals!.days;

    const allComponents = days.flatMap((d) =>
      d.meals.flatMap((m) =>
        m.ingredients.map((ing) => ({
          foodId: ing.foodId,
          catalogVersion: ing.catalogVersion,
          grams: ing.grams,
        }))
      )
    );
    const expectedAggregated = aggregateGramsByFood(allComponents);

    const grocery = buildGroceryList(days, inCodeFoodCatalogSource);

    expect(grocery.lines.length).toBe(expectedAggregated.size);
    for (const line of grocery.lines) {
      expect(line.consumedGrams).toBe(expectedAggregated.get(line.foodId));
    }
  });

  it("handles a legacy in-code catalog week safely without throwing, producing null purchases with reasons", () => {
    const plan = buildInitialFixturePlan(answers, "test-rx", "MEALS").payload;
    const days = plan!.meals!.days;

    const result = buildGroceryList(days, inCodeFoodCatalogSource);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.anyPurchaseUnknown).toBe(true);

    for (const line of result.lines) {
      expect(line.purchase).toBeNull();
      expect(line.purchaseUnknownReason).toBe("NO_EDIBLE_PORTION");
    }
  });

  it("produces SAME_STATE_AS_CONSUMED when consumed state matches record state and edible portion is 1", () => {
    const testSource: FoodCatalogSource = {
      catalogVersion: "test:v1",
      get(id: string) {
        return {
          success: true,
          item: {
            id,
            catalogVersion: "test:v1",
            name: "Whole Rolled Oats",
            sourceId: "test",
            energyMethod: "SOURCE_REPORTED",
            servingGrams: 100,
            energyKcalPerServing: 389,
            proteinGPerServing: 16.9,
            carbsGPerServing: 66.3,
            fatGPerServing: 6.9,
            allergens: [],
            dietaryTags: ["VEGAN"],
            hasCompleteMicronutrients: true,
            foodState: "RAW",
            amountBasis: {
              basisGrams: 100,
              ediblePortionFactor: 1,
              ediblePortionProvenance: "SOURCE_REPORTED",
              householdMeasures: [],
              yieldMethod: "NONE_APPLIED",
            },
          },
        };
      },
    };

    const testDays: NonNullable<PlanPayload["meals"]>["days"] = [
      {
        day: 1,
        meals: [
          {
            id: "m1",
            name: "Oats",
            servings: 1,
            preparation: "Serve raw.",
            ingredients: [
              {
                foodId: "oats-raw",
                catalogVersion: "test:v1",
                grams: 200,
                state: "RAW",
              },
            ],
          },
        ],
      },
    ];

    const result = buildGroceryList(testDays, testSource);
    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.foodId).toBe("oats-raw");
    expect(line.consumedGrams).toBe(200);
    expect(line.consumedState).toBe("RAW");
    expect(line.purchase).not.toBeNull();
    expect(line.purchase?.basis).toBe("SAME_STATE_AS_CONSUMED");
    expect(line.purchase?.grams).toBe(200);
    expect(line.purchase?.unit).toBe("GRAM");
    expect(line.purchaseUnknownReason).toBeNull();
  });

  it("produces SOURCE_EDIBLE_PORTION and grams > consumedGrams when edible portion factor < 1", () => {
    const testSource: FoodCatalogSource = {
      catalogVersion: "test:v1",
      get(id: string) {
        return {
          success: true,
          item: {
            id,
            catalogVersion: "test:v1",
            name: "Fresh Banana with Peel",
            sourceId: "test",
            energyMethod: "SOURCE_REPORTED",
            servingGrams: 100,
            energyKcalPerServing: 89,
            proteinGPerServing: 1.1,
            carbsGPerServing: 22.8,
            fatGPerServing: 0.3,
            allergens: [],
            dietaryTags: ["VEGAN"],
            hasCompleteMicronutrients: true,
            foodState: "RAW",
            amountBasis: {
              basisGrams: 100,
              ediblePortionFactor: 0.64, // 64% edible portion
              ediblePortionProvenance: "SOURCE_REPORTED",
              householdMeasures: [],
              yieldMethod: "NONE_APPLIED",
            },
          },
        };
      },
    };

    const testDays: NonNullable<PlanPayload["meals"]>["days"] = [
      {
        day: 1,
        meals: [
          {
            id: "m1",
            name: "Banana Snack",
            servings: 1,
            preparation: "Peel and serve.",
            ingredients: [
              {
                foodId: "banana-raw",
                catalogVersion: "test:v1",
                grams: 100,
                state: "RAW",
              },
            ],
          },
        ],
      },
    ];

    const result = buildGroceryList(testDays, testSource);
    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.foodId).toBe("banana-raw");
    expect(line.consumedGrams).toBe(100);
    expect(line.purchase).not.toBeNull();
    expect(line.purchase?.basis).toBe("SOURCE_EDIBLE_PORTION");
    expect(line.purchase!.grams).toBe(156.3);
    expect(line.purchase!.grams).toBeGreaterThan(100);
    expect(line.purchaseUnknownReason).toBeNull();
  });

  it("returns purchase: null with NO_YIELD_FACTOR when food was cooked from raw with no reported yield", () => {
    // Chicken breast raw fdc-2646170 consumed as COOKED: v1 has yieldMethod: "NONE_APPLIED"
    const testDays: NonNullable<PlanPayload["meals"]>["days"] = [
      {
        day: 1,
        meals: [
          {
            id: "m1",
            name: "Cooked Chicken",
            servings: 1,
            preparation: "Cook through.",
            ingredients: [
              {
                foodId: "fdc-2646170",
                catalogVersion: draftSource.catalogVersion,
                grams: 150,
                state: "COOKED",
              },
            ],
          },
        ],
      },
    ];

    const result = buildGroceryList(testDays, draftSource);
    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.foodId).toBe("fdc-2646170");
    expect(line.consumedGrams).toBe(150);
    expect(line.consumedState).toBe("COOKED");
    expect(line.purchase).toBeNull();
    expect(line.purchaseUnknownReason).toBe("NO_YIELD_FACTOR");
    expect(result.anyPurchaseUnknown).toBe(true);
  });

  it("handles purchaseUnit with gramsPerUnit and packSizeGrams correctly", () => {
    const stubSource: FoodCatalogSource = {
      catalogVersion: "stub:v1",
      get(id: string, catalogVersion: string) {
        if (id === "unit-food-1") {
          const item: ResolvedFoodItem = {
            id: "unit-food-1",
            catalogVersion: "stub:v1",
            name: "Apples",
            sourceId: "stub",
            energyMethod: "SOURCE_REPORTED",
            servingGrams: 100,
            energyKcalPerServing: 52,
            proteinGPerServing: 0.3,
            carbsGPerServing: 14,
            fatGPerServing: 0.2,
            allergens: [],
            dietaryTags: ["VEGAN"],
            hasCompleteMicronutrients: true,
            foodState: "RAW",
            amountBasis: {
              basisGrams: 100,
              ediblePortionFactor: 1,
              ediblePortionProvenance: "SOURCE_REPORTED",
              householdMeasures: [],
              yieldMethod: "NONE_APPLIED",
            },
            purchaseUnit: {
              unit: "EACH",
              gramsPerUnit: 150,
              packSizeGrams: null,
              provenance: "SOURCE_PORTION",
            },
          };
          return { success: true, item };
        }
        if (id === "pack-food-2") {
          const item: ResolvedFoodItem = {
            id: "pack-food-2",
            catalogVersion: "stub:v1",
            name: "Yogurt Cups",
            sourceId: "stub",
            energyMethod: "SOURCE_REPORTED",
            servingGrams: 100,
            energyKcalPerServing: 100,
            proteinGPerServing: 10,
            carbsGPerServing: 5,
            fatGPerServing: 0,
            allergens: [],
            dietaryTags: ["VEGETARIAN"],
            hasCompleteMicronutrients: true,
            foodState: "PREPARED",
            amountBasis: {
              basisGrams: 100,
              ediblePortionFactor: 1,
              ediblePortionProvenance: "SOURCE_REPORTED",
              householdMeasures: [],
              yieldMethod: "NONE_APPLIED",
            },
            purchaseUnit: {
              unit: "EACH",
              gramsPerUnit: 150,
              packSizeGrams: 600, // 4-pack of 150g = 600g
              provenance: "SOURCE_PORTION",
            },
          };
          return { success: true, item };
        }
        if (id === "missing-unit-food-3") {
          const item: ResolvedFoodItem = {
            id: "missing-unit-food-3",
            catalogVersion: "stub:v1",
            name: "Bulk Grain",
            sourceId: "stub",
            energyMethod: "SOURCE_REPORTED",
            servingGrams: 100,
            energyKcalPerServing: 350,
            proteinGPerServing: 10,
            carbsGPerServing: 70,
            fatGPerServing: 2,
            allergens: [],
            dietaryTags: ["VEGAN"],
            hasCompleteMicronutrients: true,
            foodState: "RAW",
            amountBasis: {
              basisGrams: 100,
              ediblePortionFactor: 1,
              ediblePortionProvenance: "SOURCE_REPORTED",
              householdMeasures: [],
              yieldMethod: "NONE_APPLIED",
            },
            purchaseUnit: {
              unit: "EACH",
              gramsPerUnit: null, // absent gramsPerUnit
              packSizeGrams: null,
              provenance: "UNKNOWN",
            },
          };
          return { success: true, item };
        }
        return { success: false, error: "UNKNOWN_ID" };
      },
    };

    const testDays: NonNullable<PlanPayload["meals"]>["days"] = [
      {
        day: 1,
        meals: [
          {
            id: "m1",
            name: "Snacks",
            servings: 1,
            preparation: "Enjoy.",
            ingredients: [
              { foodId: "unit-food-1", catalogVersion: "stub:v1", grams: 250, state: "RAW" },
              { foodId: "pack-food-2", catalogVersion: "stub:v1", grams: 400, state: "READY_TO_EAT" },
              { foodId: "missing-unit-food-3", catalogVersion: "stub:v1", grams: 300, state: "RAW" },
            ],
          },
        ],
      },
    ];

    const result = buildGroceryList(testDays, stubSource);
    expect(result.lines).toHaveLength(3);

    // 1. unit-food-1: 250g consumed, gramsPerUnit 150 -> ceil(250 / 150) = 2 units
    const line1 = result.lines.find((l) => l.foodId === "unit-food-1")!;
    expect(line1.purchase).not.toBeNull();
    expect(line1.purchase?.grams).toBe(250);
    expect(line1.purchase?.unit).toBe("EACH");
    expect(line1.purchase?.units).toBe(2);
    expect(line1.purchaseUnknownReason).toBeNull();

    // 2. pack-food-2: 400g consumed, packSize 600g -> ceil(400/600)*600 = 600g, units = ceil(600/150) = 4 units
    const line2 = result.lines.find((l) => l.foodId === "pack-food-2")!;
    expect(line2.purchase).not.toBeNull();
    expect(line2.purchase?.grams).toBe(600);
    expect(line2.purchase?.unit).toBe("EACH");
    expect(line2.purchase?.units).toBe(4);
    expect(line2.purchaseUnknownReason).toBeNull();

    // 3. missing-unit-food-3: gramsPerUnit is null -> units is null, purchaseUnknownReason is NO_PURCHASE_UNIT
    // purchase is still non-null because grams (300g) are known
    const line3 = result.lines.find((l) => l.foodId === "missing-unit-food-3")!;
    expect(line3.purchase).not.toBeNull();
    expect(line3.purchase?.grams).toBe(300);
    expect(line3.purchase?.units).toBeNull();
    expect(line3.purchaseUnknownReason).toBe("NO_PURCHASE_UNIT");

    // Invariant check across lines without the NO_PURCHASE_UNIT special-case:
    for (const line of [line1, line2]) {
      const isExactlyOneNonNull =
        (line.purchase === null && line.purchaseUnknownReason !== null) ||
        (line.purchase !== null && line.purchaseUnknownReason === null);
      expect(isExactlyOneNonNull).toBe(true);
    }
  });
});
