import type { PlanPayload } from "./plan-contract";
import type { FoodCatalogSource } from "./catalog/food-source";

export type GroceryLine = {
  foodId: string;
  catalogVersion: string;
  name: string;
  consumedGrams: number;
  consumedState: "RAW" | "COOKED" | "READY_TO_EAT";
  purchase: {
    grams: number;
    unit: "GRAM" | "MILLILITRE" | "EACH";
    units: number | null;
    basis: "SAME_STATE_AS_CONSUMED" | "SOURCE_EDIBLE_PORTION" | "SOURCE_YIELD_FACTOR";
  } | null;
  purchaseUnknownReason: "NO_YIELD_FACTOR" | "NO_EDIBLE_PORTION" | "NO_PURCHASE_UNIT" | null;
};

export function buildGroceryList(
  days: NonNullable<PlanPayload["meals"]>["days"],
  source: FoodCatalogSource
): { lines: GroceryLine[]; anyPurchaseUnknown: boolean } {
  // Aggregate consumed grams and state by (foodId, catalogVersion)
  type AggregatedItem = {
    foodId: string;
    catalogVersion: string;
    consumedGrams: number;
    consumedState: "RAW" | "COOKED" | "READY_TO_EAT";
  };

  const map = new Map<string, AggregatedItem>();

  for (const day of days) {
    for (const meal of day.meals) {
      for (const ingredient of meal.ingredients) {
        const key = `${ingredient.foodId}::${ingredient.catalogVersion}`;
        const existing = map.get(key);
        if (existing) {
          existing.consumedGrams += ingredient.grams;
        } else {
          map.set(key, {
            foodId: ingredient.foodId,
            catalogVersion: ingredient.catalogVersion,
            consumedGrams: ingredient.grams,
            consumedState: ingredient.state,
          });
        }
      }
    }
  }

  const lines: GroceryLine[] = [];

  for (const item of map.values()) {
    const lookup = source.get(item.foodId, item.catalogVersion);
    const name = lookup.success ? lookup.item.name : item.foodId;

    if (!lookup.success || !lookup.item.amountBasis) {
      // Legacy catalog or missing amountBasis: purchase cannot be established
      lines.push({
        foodId: item.foodId,
        catalogVersion: item.catalogVersion,
        name,
        consumedGrams: item.consumedGrams,
        consumedState: item.consumedState,
        purchase: null,
        purchaseUnknownReason: "NO_EDIBLE_PORTION",
      });
      continue;
    }

    const { amountBasis, foodState } = lookup.item;
    const recordState = foodState ?? "RAW";

    // Cooking state transition check
    if ((item.consumedState === "COOKED" || item.consumedState === "READY_TO_EAT") && recordState === "RAW") {
      const yieldMethod = amountBasis.yieldMethod as string;
      if (yieldMethod !== "SOURCE_REPORTED") {
        // v1 carries yieldMethod: "NONE_APPLIED", so yield factor is unavailable
        lines.push({
          foodId: item.foodId,
          catalogVersion: item.catalogVersion,
          name,
          consumedGrams: item.consumedGrams,
          consumedState: item.consumedState,
          purchase: null,
          purchaseUnknownReason: "NO_YIELD_FACTOR",
        });
        continue;
      }
    }

    // Edible portion check
    if (amountBasis.ediblePortionFactor === null || amountBasis.ediblePortionFactor <= 0) {
      lines.push({
        foodId: item.foodId,
        catalogVersion: item.catalogVersion,
        name,
        consumedGrams: item.consumedGrams,
        consumedState: item.consumedState,
        purchase: null,
        purchaseUnknownReason: "NO_EDIBLE_PORTION",
      });
      continue;
    }

    const factor = amountBasis.ediblePortionFactor;
    const basis = factor === 1 ? "SAME_STATE_AS_CONSUMED" : "SOURCE_EDIBLE_PORTION";
    let purchaseGrams = factor === 1 ? item.consumedGrams : Math.round((item.consumedGrams / factor) * 10) / 10;

    const purchaseUnit = lookup.item.purchaseUnit;
    let unit: "GRAM" | "MILLILITRE" | "EACH" = "GRAM";
    let units: number | null = null;
    let purchaseUnknownReason: "NO_YIELD_FACTOR" | "NO_EDIBLE_PORTION" | "NO_PURCHASE_UNIT" | null = null;

    if (purchaseUnit) {
      unit = purchaseUnit.unit;
      if (purchaseUnit.packSizeGrams !== null && purchaseUnit.packSizeGrams > 0) {
        purchaseGrams = Math.ceil(purchaseGrams / purchaseUnit.packSizeGrams) * purchaseUnit.packSizeGrams;
      }
      if (purchaseUnit.gramsPerUnit !== null && purchaseUnit.gramsPerUnit > 0) {
        units = Math.ceil(purchaseGrams / purchaseUnit.gramsPerUnit);
      } else {
        units = null;
        purchaseUnknownReason = "NO_PURCHASE_UNIT";
      }
    }

    if (purchaseUnknownReason !== null) {
      lines.push({
        foodId: item.foodId,
        catalogVersion: item.catalogVersion,
        name,
        consumedGrams: item.consumedGrams,
        consumedState: item.consumedState,
        purchase: null,
        purchaseUnknownReason,
      });
    } else {
      lines.push({
        foodId: item.foodId,
        catalogVersion: item.catalogVersion,
        name,
        consumedGrams: item.consumedGrams,
        consumedState: item.consumedState,
        purchase: {
          grams: purchaseGrams,
          unit,
          units,
          basis,
        },
        purchaseUnknownReason: null,
      });
    }
  }

  // Stable sort by foodId ASC
  lines.sort((a, b) => a.foodId.localeCompare(b.foodId));

  const anyPurchaseUnknown = lines.some((line) => line.purchaseUnknownReason !== null);

  return { lines, anyPurchaseUnknown };
}
