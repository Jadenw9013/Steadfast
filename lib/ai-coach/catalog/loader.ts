import { DRAFT_EXERCISE_CATALOG_VERSION } from "./draft-catalog-version";
import { FOOD_CATALOG, FOOD_CATALOG_VERSION, LEGACY_FOOD_CATALOG } from "./food-catalog";
import { EXERCISE_CATALOG, EXERCISE_CATALOG_VERSION, getDraftExerciseCatalog } from "./exercise-catalog";
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
  const item = (catalogVersion === "food-fixture-v1" ? LEGACY_FOOD_CATALOG : FOOD_CATALOG).get(id);
  if (!item) return { success: false, error: "UNKNOWN_ID" };
  if (item.catalogVersion !== catalogVersion) return { success: false, error: "CATALOG_VERSION_MISMATCH" };
  return { success: true, item };
}

export function getExerciseItem(id: string, catalogVersion: string): CatalogLookupResult<ExerciseItem> {
  // T-2038: the draft catalog is resolved only where a server-side module has
  // enabled it through the guarded loader (`catalog/draft-exercise-catalog.ts`),
  // never through a static import of the JSON, so its content stays out of every
  // client bundle and out of production entirely. `null` here means "not
  // available", reported as UNKNOWN_ID rather than thrown, because this function
  // runs inside planPayloadSchema's superRefine on every parse of every stored plan.
  const catalog =
    catalogVersion === DRAFT_EXERCISE_CATALOG_VERSION ? getDraftExerciseCatalog() : EXERCISE_CATALOG;
  const item = catalog?.get(id);
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
