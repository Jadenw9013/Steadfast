import { foodItemSchema, type FoodItem } from "./schema";

/**
 * A04 — SYNTHETIC FIXTURE food catalog. See schema.ts's module docstring:
 * this is engineering shape, not reviewed content (gate G02).
 */
export const FOOD_CATALOG_VERSION = "food-fixture-v1";

const RAW_FOOD_CATALOG: FoodItem[] = [
  {
    id: "chicken-breast-raw", catalogVersion: FOOD_CATALOG_VERSION, name: "Chicken breast, raw",
    sourceId: "FIXTURE-001", energyMethod: "SYNTHETIC_FIXTURE", servingGrams: 100,
    energyKcalPerServing: 120, proteinGPerServing: 22.5, carbsGPerServing: 0, fatGPerServing: 2.6,
    allergens: [], dietaryTags: ["GLUTEN_FREE", "DAIRY_FREE"], hasCompleteMicronutrients: false,
  },
  {
    id: "brown-rice-cooked", catalogVersion: FOOD_CATALOG_VERSION, name: "Brown rice, cooked",
    sourceId: "FIXTURE-002", energyMethod: "SYNTHETIC_FIXTURE", servingGrams: 100,
    energyKcalPerServing: 112, proteinGPerServing: 2.3, carbsGPerServing: 23.5, fatGPerServing: 0.8,
    allergens: [], dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE", "DAIRY_FREE"], hasCompleteMicronutrients: false,
  },
  {
    id: "peanut-butter", catalogVersion: FOOD_CATALOG_VERSION, name: "Peanut butter",
    sourceId: "FIXTURE-003", energyMethod: "SYNTHETIC_FIXTURE", servingGrams: 32,
    energyKcalPerServing: 190, proteinGPerServing: 7, carbsGPerServing: 8, fatGPerServing: 16,
    allergens: ["PEANUT"], dietaryTags: ["VEGETARIAN", "VEGAN", "DAIRY_FREE"], hasCompleteMicronutrients: false,
  },
  {
    id: "whole-milk", catalogVersion: FOOD_CATALOG_VERSION, name: "Whole milk",
    sourceId: "FIXTURE-004", energyMethod: "SYNTHETIC_FIXTURE", servingGrams: 244,
    energyKcalPerServing: 149, proteinGPerServing: 7.7, carbsGPerServing: 11.7, fatGPerServing: 8,
    allergens: ["MILK"], dietaryTags: ["VEGETARIAN", "GLUTEN_FREE"], hasCompleteMicronutrients: false,
  },
  {
    id: "broccoli-steamed", catalogVersion: FOOD_CATALOG_VERSION, name: "Broccoli, steamed",
    sourceId: "FIXTURE-005", energyMethod: "SYNTHETIC_FIXTURE", servingGrams: 91,
    energyKcalPerServing: 31, proteinGPerServing: 2.6, carbsGPerServing: 6, fatGPerServing: 0.3,
    allergens: [], dietaryTags: ["VEGETARIAN", "VEGAN", "GLUTEN_FREE", "DAIRY_FREE"], hasCompleteMicronutrients: false,
  },
  {
    // Deliberately no GLUTEN_FREE tag — exercises the allergen/tag rejection path.
    id: "whole-wheat-bread", catalogVersion: FOOD_CATALOG_VERSION, name: "Whole wheat bread",
    sourceId: "FIXTURE-006", energyMethod: "SYNTHETIC_FIXTURE", servingGrams: 32,
    energyKcalPerServing: 81, proteinGPerServing: 4, carbsGPerServing: 14, fatGPerServing: 1.1,
    allergens: ["WHEAT", "GLUTEN"], dietaryTags: ["VEGETARIAN", "VEGAN", "DAIRY_FREE"], hasCompleteMicronutrients: false,
  },
];

export const FOOD_CATALOG: ReadonlyMap<string, FoodItem> = new Map(
  RAW_FOOD_CATALOG.map((raw) => {
    const item = foodItemSchema.parse(raw);
    return [item.id, item];
  })
);
