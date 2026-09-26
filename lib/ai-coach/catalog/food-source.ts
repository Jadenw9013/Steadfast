import type { CatalogLookupResult } from "./loader";
import { getFoodItem } from "./loader";
import type { FoodItem, Allergen, DietaryTag } from "./schema";
import type { FoodCatalogContent, SourcedFoodCatalogItem } from "../artifacts/schema";
import { FOOD_CATALOG_VERSION } from "./food-catalog";

export type SourcedAllergenFacts = NonNullable<SourcedFoodCatalogItem["allergenFactsV2"]>;
export type SourcedAmountBasis = NonNullable<SourcedFoodCatalogItem["amountBasis"]>;

export type ResolvedFoodItem = FoodItem & {
  foodState?: "RAW" | "COOKED" | "PREPARED" | "NOT_APPLICABLE";
  allergenFactsV2?: SourcedAllergenFacts; // present only for SOURCED_V2 items
  amountBasis?: SourcedAmountBasis;
  purchaseUnit?: {
    unit: "GRAM" | "MILLILITRE" | "EACH";
    gramsPerUnit: number | null;
    packSizeGrams: number | null;
    provenance?: "SOURCE_PORTION" | "UNKNOWN";
  } | null;
};

export interface FoodCatalogSource {
  get(id: string, catalogVersion: string): CatalogLookupResult<ResolvedFoodItem>;
  readonly catalogVersion: string;
}

/** The shipped in-code fixture catalog. The default for every existing caller. */
export const inCodeFoodCatalogSource: FoodCatalogSource = {
  catalogVersion: FOOD_CATALOG_VERSION,
  get(id: string, catalogVersion: string): CatalogLookupResult<ResolvedFoodItem> {
    return getFoodItem(id, catalogVersion);
  },
};

/** Wraps a SOURCED_V2 food-catalog content object. Test and tooling use only. */
export function sourcedFoodCatalogSource(content: FoodCatalogContent): FoodCatalogSource {
  const version = `${content.artifactKey}:v${content.version}`;
  const itemMap = new Map<string, SourcedFoodCatalogItem>();
  for (const item of content.items) {
    itemMap.set(item.id, item);
  }

  return {
    catalogVersion: version,
    get(id: string, requestedCatalogVersion: string): CatalogLookupResult<ResolvedFoodItem> {
      if (requestedCatalogVersion !== version && requestedCatalogVersion !== content.artifactKey) {
        return { success: false, error: "CATALOG_VERSION_MISMATCH" };
      }
      const rawItem = itemMap.get(id);
      if (!rawItem) {
        return { success: false, error: "UNKNOWN_ID" };
      }

      // Map patternTags into dietaryTags
      const dietaryTags: DietaryTag[] = [];
      if (rawItem.patternTags?.includes("VEGAN")) {
        dietaryTags.push("VEGAN");
      }
      if (rawItem.patternTags?.includes("LACTO_OVO_VEGETARIAN") || rawItem.patternTags?.includes("VEGAN")) {
        dietaryTags.push("VEGETARIAN");
      }

      const resolved: ResolvedFoodItem = {
        id: rawItem.id,
        catalogVersion: version,
        name: rawItem.name,
        sourceId: rawItem.source.sourceId,
        energyMethod: rawItem.energyFact?.method ?? "SOURCE_REPORTED",
        servingGrams: rawItem.servingGrams,
        energyKcalPerServing: rawItem.nutrients.energyKcal,
        proteinGPerServing: rawItem.nutrients.proteinGrams,
        carbsGPerServing: rawItem.nutrients.carbohydrateGrams,
        fatGPerServing: rawItem.nutrients.fatGrams,
        allergens: [] as Allergen[],
        dietaryTags,
        hasCompleteMicronutrients: rawItem.nutrients.missingNutrientIds.length === 0,
        foodState: rawItem.foodState,
        allergenFactsV2: rawItem.allergenFactsV2,
        amountBasis: rawItem.amountBasis,
      };

      return { success: true, item: resolved };
    },
  };
}
