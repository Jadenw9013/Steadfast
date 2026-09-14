import { FOOD_CATALOG, FOOD_CATALOG_VERSION } from "./food-catalog";
import { EXERCISE_CATALOG, EXERCISE_CATALOG_VERSION } from "./exercise-catalog";
import type { FoodItem, ExerciseItem } from "./schema";

/**
 * A04 — versioned catalog loaders.
 *
 * A caller always names the catalog version it expects alongside the item
 * ID (docs/ai-coach/05: "catalog recipe/food IDs and versions"). A
 * reference to an unknown ID, or a known ID under a version this loader
 * no longer serves, is rejected rather than silently resolved against
 * whatever the current version happens to be — a stale plan payload must
 * never be reinterpreted against catalog content it was never validated
 * against.
 */

export type CatalogLookupError = "UNKNOWN_ID" | "CATALOG_VERSION_MISMATCH";
export type CatalogLookupResult<T> = { success: true; item: T } | { success: false; error: CatalogLookupError };

export function getFoodItem(id: string, catalogVersion: string): CatalogLookupResult<FoodItem> {
  const item = FOOD_CATALOG.get(id);
  if (!item) return { success: false, error: "UNKNOWN_ID" };
  if (item.catalogVersion !== catalogVersion) return { success: false, error: "CATALOG_VERSION_MISMATCH" };
  return { success: true, item };
}

export function getExerciseItem(id: string, catalogVersion: string): CatalogLookupResult<ExerciseItem> {
  const item = EXERCISE_CATALOG.get(id);
  if (!item) return { success: false, error: "UNKNOWN_ID" };
  if (item.catalogVersion !== catalogVersion) return { success: false, error: "CATALOG_VERSION_MISMATCH" };
  return { success: true, item };
}

export function getCurrentFoodCatalogVersion(): string {
  return FOOD_CATALOG_VERSION;
}

export function getCurrentExerciseCatalogVersion(): string {
  return EXERCISE_CATALOG_VERSION;
}
