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
 *
 * T-2040 — references resolve **by catalog key**, through an explicit
 * registry. The maps below are the fixture catalogs this build happens to
 * carry; they are not the authority on what a valid catalog key is. The
 * reviewed artifact set is (`artifacts/repository.ts:911,927`
 * `getReviewedFoodItem` / `getReviewedExerciseItem`, reached through
 * `autonomy/gate.ts`'s `catalogItemsValid`). So a key that is absent from the
 * registry is reported as `CATALOG_VERSION_NOT_SERVED` — "this build cannot
 * resolve that catalog" — and **not** as `UNKNOWN_ID` or
 * `CATALOG_VERSION_MISMATCH`, which both mean "that reference is wrong".
 * `planPayloadSchema` treats the distinction as the difference between an
 * invalid plan and a plan this build cannot check itself, which is what keeps
 * a live-bound plan from rendering as a blank screen on the nine read paths
 * listed in board/tickets/T-2040.md.
 */

export type CatalogLookupError =
  | "UNKNOWN_ID"
  | "CATALOG_VERSION_MISMATCH"
  | "CATALOG_VERSION_NOT_SERVED";
export type CatalogLookupResult<T> = { success: true; item: T } | { success: false; error: CatalogLookupError };

type ItemCatalog<T> = ReadonlyMap<string, T>;

/** Catalog keys this build carries in code, by key. */
const FOOD_CATALOGS: ReadonlyMap<string, ItemCatalog<FoodItem>> = new Map([
  [FOOD_CATALOG_VERSION, FOOD_CATALOG],
  ["food-fixture-v1", LEGACY_FOOD_CATALOG],
]);

/**
 * Exercise keys this build carries in code, by key. The draft entry resolves
 * through {@link getDraftExerciseCatalog}, which returns `null` in production
 * and in any process that has not deliberately enabled it (T-2038), so the
 * draft key is *served* only where the content is actually available;
 * everywhere else it reports `CATALOG_VERSION_NOT_SERVED` like any other key
 * this build cannot resolve.
 */
const EXERCISE_CATALOGS: ReadonlyMap<string, () => ItemCatalog<ExerciseItem> | null> = new Map([
  [EXERCISE_CATALOG_VERSION, () => EXERCISE_CATALOG],
  [DRAFT_EXERCISE_CATALOG_VERSION, getDraftExerciseCatalog],
]);

function resolve<T extends { catalogVersion: string }>(
  catalog: ItemCatalog<T> | null | undefined,
  id: string,
  catalogVersion: string
): CatalogLookupResult<T> {
  if (!catalog) return { success: false, error: "CATALOG_VERSION_NOT_SERVED" };
  const item = catalog.get(id);
  if (!item) return { success: false, error: "UNKNOWN_ID" };
  // Defensive: a registry entry must be keyed by the version its own items
  // declare. Kept from the pre-registry loader so a mis-keyed map is reported
  // rather than silently resolved.
  if (item.catalogVersion !== catalogVersion) return { success: false, error: "CATALOG_VERSION_MISMATCH" };
  return { success: true, item };
}

export function getFoodItem(id: string, catalogVersion: string): CatalogLookupResult<FoodItem> {
  return resolve(FOOD_CATALOGS.get(catalogVersion), id, catalogVersion);
}

export function getExerciseItem(id: string, catalogVersion: string): CatalogLookupResult<ExerciseItem> {
  // T-2038: the draft catalog is resolved only where a server-side module has
  // enabled it through the guarded loader (`catalog/draft-exercise-catalog.ts`),
  // never through a static import of the JSON, so its content stays out of every
  // client bundle and out of production entirely. `null` here means "not
  // available", reported as CATALOG_VERSION_NOT_SERVED rather than thrown, because
  // this function runs inside planPayloadSchema's superRefine on every parse of
  // every stored plan.
  return resolve(EXERCISE_CATALOGS.get(catalogVersion)?.(), id, catalogVersion);
}

/** Whether this build carries the named food catalog in code. */
export function foodCatalogIsServedInCode(catalogVersion: string): boolean {
  return FOOD_CATALOGS.has(catalogVersion);
}

/** Whether this build carries the named exercise catalog in code, right now. */
export function exerciseCatalogIsServedInCode(catalogVersion: string): boolean {
  return (EXERCISE_CATALOGS.get(catalogVersion)?.() ?? null) !== null;
}

export function getCurrentFoodCatalogVersion(): string {
  return FOOD_CATALOG_VERSION;
}

export function getCurrentExerciseCatalogVersion(): string {
  return EXERCISE_CATALOG_VERSION;
}
