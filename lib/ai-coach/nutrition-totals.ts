import { z } from "zod";
import { getFoodItem, type CatalogLookupError } from "./catalog/loader";

/**
 * A04 — deterministic, source-aware nutrient totals.
 *
 * Every total traces back to the exact catalog item/version it was
 * computed from; an unresolved reference fails the whole computation
 * rather than being dropped or treated as zero (docs/ai-coach/05: missing
 * micronutrients "remain unknown", never invented). Energy is the
 * source's own per-serving value scaled by grams — this file does not
 * recompute energy from macros (see 21 CFR 101.9 in docs/ai-coach/13 for
 * why label-style macro-energy reconciliation is a distinct, non-trivial
 * concern this fixture does not attempt).
 */

export const recipeComponentSchema = z.object({
  foodId: z.string().min(1),
  catalogVersion: z.string().min(1),
  grams: z.number().positive(),
}).strict();
export type RecipeComponent = z.infer<typeof recipeComponentSchema>;

export interface NutrientTotals {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  hasCompleteMicronutrients: boolean;
}

export type ComputeTotalsResult =
  | { success: true; totals: NutrientTotals; byComponent: { foodId: string; totals: NutrientTotals }[] }
  | { success: false; error: CatalogLookupError; foodId: string };

export function computeNutrientTotals(components: RecipeComponent[]): ComputeTotalsResult {
  const byComponent: { foodId: string; totals: NutrientTotals }[] = [];
  const totals: NutrientTotals = { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, hasCompleteMicronutrients: true };

  for (const component of components) {
    const lookup = getFoodItem(component.foodId, component.catalogVersion);
    if (!lookup.success) {
      return { success: false, error: lookup.error, foodId: component.foodId };
    }

    const scale = component.grams / lookup.item.servingGrams;
    const componentTotals: NutrientTotals = {
      energyKcal: lookup.item.energyKcalPerServing * scale,
      proteinG: lookup.item.proteinGPerServing * scale,
      carbsG: lookup.item.carbsGPerServing * scale,
      fatG: lookup.item.fatGPerServing * scale,
      hasCompleteMicronutrients: lookup.item.hasCompleteMicronutrients,
    };
    byComponent.push({ foodId: component.foodId, totals: componentTotals });

    totals.energyKcal += componentTotals.energyKcal;
    totals.proteinG += componentTotals.proteinG;
    totals.carbsG += componentTotals.carbsG;
    totals.fatG += componentTotals.fatG;
    totals.hasCompleteMicronutrients = totals.hasCompleteMicronutrients && componentTotals.hasCompleteMicronutrients;
  }

  return { success: true, totals, byComponent };
}

/** Sums raw grams per food item across an entire week's components — the source-aware basis for a grocery list. A07 owns turning this into practical purchasable quantities. */
export function aggregateGramsByFood(componentsAcrossWeek: RecipeComponent[]): Map<string, number> {
  const byFood = new Map<string, number>();
  for (const component of componentsAcrossWeek) {
    byFood.set(component.foodId, (byFood.get(component.foodId) ?? 0) + component.grams);
  }
  return byFood;
}
