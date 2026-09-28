import type { PlanPayload } from "./plan-contract";
import type { FoodCatalogSource, ResolvedFoodItem } from "./catalog/food-source";
import type { MealTemplate, MealTemplateSet } from "./catalog/meal-template-schema";
import type { RecipeComponent, NutrientTotals } from "./nutrition-totals";
import { computeNutrientTotals } from "./nutrition-totals";
import { checkMealComposition, type FeasibilityReason } from "./composition-feasibility";
import type { AiDomainPermission } from "@/app/generated/prisma/client";
import type { AllergenDeclarations } from "./intake-contract";

export type ComposeConstraints = {
  patternTags: ("OMNIVORE" | "LACTO_OVO_VEGETARIAN" | "VEGAN" | "PESCATARIAN")[];
  patternMandatory: boolean;
  budgetBand: "LOW" | "MODERATE" | "FLEXIBLE";
  prepTimeBand: "UNDER_15" | "MIN_15_30" | "MIN_30_60" | "OVER_60";
  equipment: ("NONE" | "MICROWAVE" | "STOVETOP" | "OVEN" | "FULL_KITCHEN")[];
  refrigeration: "NONE" | "FRIDGE" | "FRIDGE_AND_FREEZER";
  allergies: string[];
  allergenDeclarations?: AllergenDeclarations;
  dietaryRestrictions: string[];
  dislikedFoodIds: string[]; // ranking-only, never a hard exclusion (T-2002)
};

export type ComposeTemplatesInput = {
  targets: { energyKcal: number; proteinG: number; carbsG: number; fatG: number };
  tolerancePercent: number;
  mealsPerDay: number; // 3 or 4
  constraints: ComposeConstraints;
  templateSet: MealTemplateSet;
  source: FoodCatalogSource;
  policyVersion: string;
  nutritionPermission: AiDomainPermission;
  maxRepeatsPerWeek: number; // default 3
};

export type ComposeReason =
  | FeasibilityReason
  | { code: "NO_FEASIBLE_MEALS"; detail?: Record<string, string> };

export type ComposeTemplatesResult =
  | {
      feasible: true;
      days: NonNullable<PlanPayload["meals"]>["days"];
      perDayTotals: NutrientTotals[];
      warnings?: string[];
    }
  | { feasible: false; reasons: ComposeReason[] };

export function isWithinMacroTolerance(
  achieved: number,
  target: number,
  tolerancePercent: number
): boolean {
  const allowed = Math.max(0.1, (target * tolerancePercent) / 100);
  return Math.abs(achieved - target) <= allowed;
}

const BUDGET_LEVEL: Record<string, number> = {
  LOW: 1,
  MODERATE: 2,
  FLEXIBLE: 3,
};

const PREP_LEVEL: Record<string, number> = {
  UNDER_15: 1,
  MIN_15_30: 2,
  MIN_30_60: 3,
  OVER_60: 4,
};

const REFRIG_LEVEL: Record<string, number> = {
  NONE: 1,
  FRIDGE: 2,
  FRIDGE_AND_FREEZER: 3,
};

type FlattenedIngredient = {
  foodId: string;
  catalogVersion: string;
  state: "RAW" | "COOKED" | "READY_TO_EAT";
  scaling: "SCALES" | "FIXED";
  minGrams: number;
  nominalGrams: number;
  maxGrams: number;
};

type MacroTargets = ComposeTemplatesInput["targets"];
type MacroKey = keyof MacroTargets;
type MacroTotals = MacroTargets;

const MACRO_KEYS: MacroKey[] = ["energyKcal", "proteinG", "carbsG", "fatG"];
const MAX_COMBINATIONS = 4_096;
const MAX_CONTINUOUS_SWEEPS = 160;
const MAX_ROUNDED_SWEEPS = 80;

type DayIngredientState = FlattenedIngredient & {
  currentGrams: number;
  item: ResolvedFoodItem;
};

type PreparedTemplate = {
  template: MealTemplate;
  ingredients: Omit<DayIngredientState, "currentGrams">[];
  nominalTotals: MacroTotals;
  dislikedCount: number;
  patternMismatch: number;
};

type MacroScore = {
  maxDeviationRatio: number;
  sumSquaredDeviation: number;
  worstMacro: MacroKey;
};

type SolvedCombination = {
  templates: MealTemplate[];
  ingredientsByMeal: DayIngredientState[][];
  totals: NutrientTotals;
  score: MacroScore;
  withinTolerance: boolean;
  dislikedCount: number;
  patternMismatch: number;
  idKey: string;
};

function itemPerGram(item: ResolvedFoodItem, key: MacroKey): number {
  const servingValue =
    key === "energyKcal"
      ? item.energyKcalPerServing
      : key === "proteinG"
        ? item.proteinGPerServing
        : key === "carbsG"
          ? item.carbsGPerServing
          : item.fatGPerServing;
  return servingValue / item.servingGrams;
}

function computeMacros(ingredients: DayIngredientState[]): NutrientTotals {
  const totals: NutrientTotals = {
    energyKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    hasCompleteMicronutrients: true,
  };

  for (const ingredient of ingredients) {
    for (const key of MACRO_KEYS) {
      totals[key] += itemPerGram(ingredient.item, key) * ingredient.currentGrams;
    }
    totals.hasCompleteMicronutrients =
      totals.hasCompleteMicronutrients && ingredient.item.hasCompleteMicronutrients;
  }

  return totals;
}

function scoreMacros(
  achieved: MacroTotals,
  targets: MacroTargets,
  tolerancePercent: number
): MacroScore {
  let maxDeviationRatio = -1;
  let sumSquaredDeviation = 0;
  let worstMacro: MacroKey = "energyKcal";

  for (const key of MACRO_KEYS) {
    const allowed = Math.max(0.1, (targets[key] * tolerancePercent) / 100);
    const ratio = Math.abs(achieved[key] - targets[key]) / allowed;
    sumSquaredDeviation += ratio * ratio;
    if (ratio > maxDeviationRatio) {
      maxDeviationRatio = ratio;
      worstMacro = key;
    }
  }

  return { maxDeviationRatio, sumSquaredDeviation, worstMacro };
}

function compareMacroScores(a: MacroScore, b: MacroScore): number {
  const maxDifference = a.maxDeviationRatio - b.maxDeviationRatio;
  if (Math.abs(maxDifference) > 1e-9) return maxDifference;
  return a.sumSquaredDeviation - b.sumSquaredDeviation;
}

function allMacrosWithinTolerance(
  achieved: MacroTotals,
  targets: MacroTargets,
  tolerancePercent: number
): boolean {
  return MACRO_KEYS.every((key) =>
    isWithinMacroTolerance(achieved[key], targets[key], tolerancePercent)
  );
}

function roundedGrams(value: number, minGrams: number, maxGrams: number): number {
  return Math.min(maxGrams, Math.max(minGrams, Math.round(value / 5) * 5));
}

function cloneCombinationIngredients(templates: PreparedTemplate[]): DayIngredientState[][] {
  return templates.map((prepared) =>
    prepared.ingredients.map((ingredient) => ({
      ...ingredient,
      currentGrams: ingredient.nominalGrams,
    }))
  );
}

/**
 * Deterministic box-constrained weighted least-squares solve followed by a
 * rounded 5 g coordinate search. Every visited state is scored and the best
 * one is retained, so the iteration cap can never discard a better iterate.
 */
function solveTemplateCombination(
  preparedTemplates: PreparedTemplate[],
  targets: MacroTargets,
  tolerancePercent: number
): SolvedCombination {
  const ingredientsByMeal = cloneCombinationIngredients(preparedTemplates);
  const allIngredients = ingredientsByMeal.flat();
  const scalable = allIngredients.filter((ingredient) => ingredient.scaling === "SCALES");

  let bestGrams = allIngredients.map((ingredient) => ingredient.currentGrams);
  let bestScore = scoreMacros(computeMacros(allIngredients), targets, tolerancePercent);

  const rememberIfBetter = () => {
    const totals = computeMacros(allIngredients);
    const score = scoreMacros(totals, targets, tolerancePercent);
    if (compareMacroScores(score, bestScore) < 0) {
      bestScore = score;
      bestGrams = allIngredients.map((ingredient) => ingredient.currentGrams);
    }
  };

  for (let sweep = 0; sweep < MAX_CONTINUOUS_SWEEPS; sweep++) {
    let largestMove = 0;

    for (const ingredient of scalable) {
      const totals = computeMacros(allIngredients);
      let numerator = 0;
      let denominator = 0;

      for (const key of MACRO_KEYS) {
        const allowed = Math.max(0.1, (targets[key] * tolerancePercent) / 100);
        const coefficient = itemPerGram(ingredient.item, key);
        const residual = totals[key] - targets[key];
        numerator += (coefficient * residual) / (allowed * allowed);
        denominator += (coefficient * coefficient) / (allowed * allowed);
      }

      if (denominator <= 0) continue;
      const next = Math.min(
        ingredient.maxGrams,
        Math.max(ingredient.minGrams, ingredient.currentGrams - numerator / denominator)
      );
      largestMove = Math.max(largestMove, Math.abs(next - ingredient.currentGrams));
      ingredient.currentGrams = next;
      rememberIfBetter();
    }

    if (largestMove < 1e-7) break;
  }

  allIngredients.forEach((ingredient, index) => {
    ingredient.currentGrams =
      ingredient.scaling === "FIXED"
        ? ingredient.nominalGrams
        : roundedGrams(bestGrams[index], ingredient.minGrams, ingredient.maxGrams);
  });

  let roundedTotals = computeMacros(allIngredients);
  let roundedScore = scoreMacros(roundedTotals, targets, tolerancePercent);

  // Search the rounded lattice one coordinate at a time. Testing the
  // coordinate optimum plus both bounds makes progress deterministic and
  // convergent without inventing out-of-band quantities.
  for (let sweep = 0; sweep < MAX_ROUNDED_SWEEPS; sweep++) {
    let bestMove:
      | { ingredient: DayIngredientState; grams: number; totals: NutrientTotals; score: MacroScore }
      | undefined;

    for (const ingredient of scalable) {
      const current = ingredient.currentGrams;
      let numerator = 0;
      let denominator = 0;

      for (const key of MACRO_KEYS) {
        const allowed = Math.max(0.1, (targets[key] * tolerancePercent) / 100);
        const coefficient = itemPerGram(ingredient.item, key);
        const residual = roundedTotals[key] - targets[key];
        numerator += (coefficient * residual) / (allowed * allowed);
        denominator += (coefficient * coefficient) / (allowed * allowed);
      }

      const coordinateOptimum =
        denominator > 0
          ? Math.min(
              ingredient.maxGrams,
              Math.max(ingredient.minGrams, current - numerator / denominator)
            )
          : current;
      const candidateValues = new Set<number>([
        roundedGrams(coordinateOptimum, ingredient.minGrams, ingredient.maxGrams),
        roundedGrams(coordinateOptimum - 5, ingredient.minGrams, ingredient.maxGrams),
        roundedGrams(coordinateOptimum + 5, ingredient.minGrams, ingredient.maxGrams),
        ingredient.minGrams,
        ingredient.maxGrams,
      ]);

      for (const candidate of candidateValues) {
        if (candidate === current) continue;
        ingredient.currentGrams = candidate;
        const totals = computeMacros(allIngredients);
        const score = scoreMacros(totals, targets, tolerancePercent);
        ingredient.currentGrams = current;

        if (
          compareMacroScores(score, roundedScore) < 0 &&
          (!bestMove || compareMacroScores(score, bestMove.score) < 0)
        ) {
          bestMove = { ingredient, grams: candidate, totals, score };
        }
      }
    }

    if (!bestMove) break;
    bestMove.ingredient.currentGrams = bestMove.grams;
    roundedTotals = bestMove.totals;
    roundedScore = bestMove.score;
  }

  return {
    templates: preparedTemplates.map(({ template }) => template),
    ingredientsByMeal,
    totals: roundedTotals,
    score: roundedScore,
    withinTolerance: allMacrosWithinTolerance(roundedTotals, targets, tolerancePercent),
    dislikedCount: preparedTemplates.reduce((total, template) => total + template.dislikedCount, 0),
    patternMismatch: preparedTemplates.reduce(
      (total, template) => total + template.patternMismatch,
      0
    ),
    idKey: preparedTemplates.map(({ template }) => template.id).join("|"),
  };
}

function flattenTemplateIngredients(
  template: MealTemplate,
  templatesById: Map<string, MealTemplate>
): FlattenedIngredient[] {
  const result: FlattenedIngredient[] = [];
  for (const ing of template.ingredients) {
    if (ing.kind === "FOOD") {
      result.push({
        foodId: ing.foodId,
        catalogVersion: ing.catalogVersion,
        state: ing.state,
        scaling: ing.scaling,
        minGrams: ing.portion.minGrams,
        nominalGrams: ing.portion.nominalGrams,
        maxGrams: ing.portion.maxGrams,
      });
    } else if (ing.kind === "COMPONENT_TEMPLATE") {
      const target = templatesById.get(ing.templateId);
      if (target) {
        for (const nIng of target.ingredients) {
          if (nIng.kind === "FOOD") {
            result.push({
              foodId: nIng.foodId,
              catalogVersion: nIng.catalogVersion,
              state: nIng.state,
              scaling: nIng.scaling,
              minGrams: nIng.portion.minGrams * ing.servings,
              nominalGrams: nIng.portion.nominalGrams * ing.servings,
              maxGrams: nIng.portion.maxGrams * ing.servings,
            });
          }
        }
      }
    }
  }
  return result;
}

export function composeWeekFromTemplates(input: ComposeTemplatesInput): ComposeTemplatesResult {
  const templatesById = new Map<string, MealTemplate>();
  for (const t of input.templateSet.templates) {
    templatesById.set(t.id, t);
  }

  const clientBudget = BUDGET_LEVEL[input.constraints.budgetBand] ?? 3;
  const clientPrep = PREP_LEVEL[input.constraints.prepTimeBand] ?? 4;
  const clientRefrig = REFRIG_LEVEL[input.constraints.refrigeration] ?? 3;
  const clientEquipment = new Set(input.constraints.equipment);
  clientEquipment.add("NONE"); // NONE is always available

  // 1. Filter
  const survivors: MealTemplate[] = [];
  const rejectionReasons: FeasibilityReason[] = [];

  for (const t of input.templateSet.templates) {
    if (t.isComponent) continue;

    // Pattern constraint
    if (input.constraints.patternMandatory && input.constraints.patternTags.length > 0) {
      const matches = t.patternTags.some((tag) => input.constraints.patternTags.includes(tag));
      if (!matches) {
        rejectionReasons.push({
          code: "DIETARY_RESTRICTION_UNSATISFIED",
          detail: { templateId: t.id, reason: "PATTERN_MISMATCH" },
        });
        continue;
      }
    }

    // Budget constraint
    const templateBudget = BUDGET_LEVEL[t.budgetBand] ?? 1;
    if (templateBudget > clientBudget) {
      rejectionReasons.push({
        code: "DIETARY_RESTRICTION_UNSATISFIED",
        detail: { templateId: t.id, reason: "BUDGET_EXCEEDED" },
      });
      continue;
    }

    // Prep time constraint
    const templatePrep = PREP_LEVEL[t.prepTimeBand] ?? 1;
    if (templatePrep > clientPrep) {
      rejectionReasons.push({
        code: "DIETARY_RESTRICTION_UNSATISFIED",
        detail: { templateId: t.id, reason: "PREP_TIME_EXCEEDED" },
      });
      continue;
    }

    // Equipment constraint
    const hasEquipment = t.requiredEquipment.every((eq) => clientEquipment.has(eq));
    if (!hasEquipment) {
      rejectionReasons.push({
        code: "DIETARY_RESTRICTION_UNSATISFIED",
        detail: { templateId: t.id, reason: "EQUIPMENT_UNAVAILABLE" },
      });
      continue;
    }

    // Refrigeration constraint
    const templateRefrig = REFRIG_LEVEL[t.requiredRefrigeration] ?? 1;
    if (templateRefrig > clientRefrig) {
      rejectionReasons.push({
        code: "DIETARY_RESTRICTION_UNSATISFIED",
        detail: { templateId: t.id, reason: "REFRIGERATION_UNAVAILABLE" },
      });
      continue;
    }

    // Check ingredients resolution and checkMealComposition
    const flatIngredients = flattenTemplateIngredients(t, templatesById);
    let resolutionFailed = false;
    for (const ing of flatIngredients) {
      const lookup = input.source.get(ing.foodId, ing.catalogVersion);
      if (!lookup.success) {
        resolutionFailed = true;
        rejectionReasons.push({
          code: "CATALOG_REFERENCE_INVALID",
          detail: { templateId: t.id, foodId: ing.foodId, error: lookup.error },
        });
        break;
      }
    }
    if (resolutionFailed) continue;

    const nominalComponents: RecipeComponent[] = flatIngredients.map((ing) => ({
      foodId: ing.foodId,
      catalogVersion: ing.catalogVersion,
      grams: ing.nominalGrams,
    }));

    const check = checkMealComposition({
      components: nominalComponents,
      allergies: input.constraints.allergies,
      dietaryRestrictions: input.constraints.dietaryRestrictions,
      allergenDeclarations: input.constraints.allergenDeclarations,
      nutritionPermission: input.nutritionPermission,
      policyVersion: input.policyVersion,
      source: input.source,
    });

    if (!check.feasible) {
      for (const r of check.reasons) {
        rejectionReasons.push({
          ...r,
          detail: { templateId: t.id, ...r.detail },
        });
      }
      continue;
    }

    survivors.push(t);
  }

  // 2. Coverage check
  const slots: ("BREAKFAST" | "LUNCH" | "DINNER" | "SNACK")[] = [
    "BREAKFAST",
    "LUNCH",
    "DINNER",
    "SNACK",
  ];
  const requiredSlots = slots.slice(0, input.mealsPerDay);

  const survivorsBySlot = new Map<string, MealTemplate[]>();
  for (const slot of requiredSlots) {
    survivorsBySlot.set(
      slot,
      survivors.filter((t) => t.slot === slot)
    );
  }

  for (const slot of requiredSlots) {
    const list = survivorsBySlot.get(slot) ?? [];
    if (list.length === 0) {
      return {
        feasible: false,
        reasons: [{ code: "NO_FEASIBLE_MEALS", detail: { slot } }, ...rejectionReasons],
      };
    }
  }

  // 3. Prepare and score whole-day template combinations. Macro fit is the
  // primary selection signal; dislikes, pattern preference and id remain
  // deterministic tie-breakers rather than hard exclusions.
  const preparedBySlot = new Map<string, PreparedTemplate[]>();
  const warningSet = new Set<string>();
  const maxRepeats = Math.max(1, input.maxRepeatsPerWeek ?? 3);
  const minNeeded = Math.ceil(7 / maxRepeats);
  const dislikedSet = new Set(input.constraints.dislikedFoodIds);

  for (const slot of requiredSlots) {
    const prepared: PreparedTemplate[] = [];
    const slotSurvivors = survivorsBySlot.get(slot) ?? [];
    if (slotSurvivors.length < minNeeded) warningSet.add("LOW_TEMPLATE_VARIETY");

    for (const template of slotSurvivors) {
      const flattened = flattenTemplateIngredients(template, templatesById);
      const ingredients: PreparedTemplate["ingredients"] = [];

      for (const ingredient of flattened) {
        const lookup = input.source.get(ingredient.foodId, ingredient.catalogVersion);
        if (!lookup.success) {
          return {
            feasible: false,
            reasons: [
              {
                code: "CATALOG_REFERENCE_INVALID",
                detail: {
                  templateId: template.id,
                  foodId: ingredient.foodId,
                  error: lookup.error,
                },
              },
            ],
          };
        }
        ingredients.push({ ...ingredient, item: lookup.item });
      }

      const nominalStates = ingredients.map((ingredient) => ({
        ...ingredient,
        currentGrams: ingredient.nominalGrams,
      }));
      prepared.push({
        template,
        ingredients,
        nominalTotals: computeMacros(nominalStates),
        dislikedCount: flattened.filter((ingredient) => dislikedSet.has(ingredient.foodId)).length,
        patternMismatch:
          input.constraints.patternTags.length === 0 ||
          template.patternTags.some((tag) => input.constraints.patternTags.includes(tag))
            ? 0
            : 1,
      });
    }

    prepared.sort((a, b) => {
      if (a.dislikedCount !== b.dislikedCount) return a.dislikedCount - b.dislikedCount;
      if (a.patternMismatch !== b.patternMismatch) return a.patternMismatch - b.patternMismatch;
      return a.template.id.localeCompare(b.template.id);
    });
    preparedBySlot.set(slot, prepared);
  }

  let combinations: PreparedTemplate[][] = [[]];
  for (let slotIndex = 0; slotIndex < requiredSlots.length; slotIndex++) {
    const slot = requiredSlots[slotIndex];
    const next = combinations.flatMap((partial) =>
      (preparedBySlot.get(slot) ?? []).map((template) => [...partial, template])
    );

    if (next.length > MAX_COMBINATIONS) {
      const targetFraction = (slotIndex + 1) / requiredSlots.length;
      const partialTargets: MacroTargets = {
        energyKcal: input.targets.energyKcal * targetFraction,
        proteinG: input.targets.proteinG * targetFraction,
        carbsG: input.targets.carbsG * targetFraction,
        fatG: input.targets.fatG * targetFraction,
      };
      next.sort((a, b) => {
        const sumNominal = (templates: PreparedTemplate[]): MacroTotals =>
          templates.reduce<MacroTotals>(
            (total, template) => ({
              energyKcal: total.energyKcal + template.nominalTotals.energyKcal,
              proteinG: total.proteinG + template.nominalTotals.proteinG,
              carbsG: total.carbsG + template.nominalTotals.carbsG,
              fatG: total.fatG + template.nominalTotals.fatG,
            }),
            { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
          );
        const macroOrder = compareMacroScores(
          scoreMacros(sumNominal(a), partialTargets, input.tolerancePercent),
          scoreMacros(sumNominal(b), partialTargets, input.tolerancePercent)
        );
        if (macroOrder !== 0) return macroOrder;
        return a
          .map(({ template }) => template.id)
          .join("|")
          .localeCompare(b.map(({ template }) => template.id).join("|"));
      });
      combinations = next.slice(0, MAX_COMBINATIONS);
    } else {
      combinations = next;
    }
  }

  // Keep deterministic round-robin combinations in a bounded/beam-searched
  // pool so variety remains possible even when nominal macro scoring prunes.
  const combinationsByKey = new Map(
    combinations.map((combination) => [
      combination.map(({ template }) => template.id).join("|"),
      combination,
    ])
  );
  for (let day = 0; day < 7; day++) {
    const fallback = requiredSlots.map((slot) => {
      const templates = preparedBySlot.get(slot)!;
      return templates[day % templates.length];
    });
    combinationsByKey.set(fallback.map(({ template }) => template.id).join("|"), fallback);
  }

  const solvedCombinations = [...combinationsByKey.values()].map((combination) =>
    solveTemplateCombination(combination, input.targets, input.tolerancePercent)
  );
  solvedCombinations.sort((a, b) => {
    if (a.withinTolerance !== b.withinTolerance) return a.withinTolerance ? -1 : 1;
    const macroOrder = compareMacroScores(a.score, b.score);
    if (macroOrder !== 0) return macroOrder;
    if (a.dislikedCount !== b.dislikedCount) return a.dislikedCount - b.dislikedCount;
    if (a.patternMismatch !== b.patternMismatch) return a.patternMismatch - b.patternMismatch;
    return a.idKey.localeCompare(b.idKey);
  });

  const repeatCounts = new Map<string, number>();
  const enforceRepeatLimit = new Map<string, boolean>(
    requiredSlots.map((slot) => [slot, (preparedBySlot.get(slot)?.length ?? 0) >= minNeeded])
  );
  const finalDays: NonNullable<PlanPayload["meals"]>["days"] = [];
  const perDayTotals: NutrientTotals[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const candidate = solvedCombinations.find((solution) => {
      if (!solution.withinTolerance) return false;
      return solution.templates.every((template) => {
        if (!enforceRepeatLimit.get(template.slot)) return true;
        return (repeatCounts.get(template.id) ?? 0) < maxRepeats;
      });
    });

    if (!candidate) {
      const bestAvailable =
        solvedCombinations.find((solution) =>
          solution.templates.every((template) => {
            if (!enforceRepeatLimit.get(template.slot)) return true;
            return (repeatCounts.get(template.id) ?? 0) < maxRepeats;
          })
        ) ?? solvedCombinations[0];
      const worstMacro = bestAvailable.score.worstMacro;
      return {
        feasible: false,
        reasons: [
          {
            code: "NO_FEASIBLE_MEALS",
            detail: {
              day: String(dayIndex + 1),
              worstMacro,
              achieved: String(bestAvailable.totals[worstMacro]),
              target: String(input.targets[worstMacro]),
            },
          },
        ],
      };
    }

    for (const template of candidate.templates) {
      repeatCounts.set(template.id, (repeatCounts.get(template.id) ?? 0) + 1);
    }

    const allDayIngredients = candidate.ingredientsByMeal.flat();
    const dayComponents: RecipeComponent[] = allDayIngredients.map((i) => ({
      foodId: i.foodId,
      catalogVersion: i.catalogVersion,
      grams: i.currentGrams,
    }));

    const totalsResult = computeNutrientTotals(dayComponents, input.source);
    if (!totalsResult.success) {
      return {
        feasible: false,
        reasons: [
          {
            code: "CATALOG_REFERENCE_INVALID",
            detail: { foodId: totalsResult.foodId, error: totalsResult.error },
          },
        ],
      };
    }

    // The source is read again here so detail.achieved and the tolerance gate
    // describe the exact final components, not a stale optimizer snapshot.
    const dayTotals = totalsResult.totals;
    if (!allMacrosWithinTolerance(dayTotals, input.targets, input.tolerancePercent)) {
      const finalScore = scoreMacros(dayTotals, input.targets, input.tolerancePercent);
      const worstMacro = finalScore.worstMacro;
      return {
        feasible: false,
        reasons: [
          {
            code: "NO_FEASIBLE_MEALS",
            detail: {
              day: String(dayIndex + 1),
              worstMacro,
              achieved: String(dayTotals[worstMacro]),
              target: String(input.targets[worstMacro]),
            },
          },
        ],
      };
    }

    // 5. Re-verify the final, rounded component list. This is authoritative
    // even if the source changed after the filter/selection optimization.
    const dayCheck = checkMealComposition({
      components: dayComponents,
      allergies: input.constraints.allergies,
      dietaryRestrictions: input.constraints.dietaryRestrictions,
      allergenDeclarations: input.constraints.allergenDeclarations,
      nutritionPermission: input.nutritionPermission,
      policyVersion: input.policyVersion,
      source: input.source,
    });

    if (!dayCheck.feasible) {
      return {
        feasible: false,
        reasons: dayCheck.reasons.map((reason) => ({
          ...reason,
          detail: { ...reason.detail, day: String(dayIndex + 1), phase: "FINAL_REVERIFY" },
        })),
      };
    }

    perDayTotals.push(dayTotals);

    // Build the day's meals
    const meals = candidate.templates.map((template, mealIdx) => {
      const mealIngredients = candidate.ingredientsByMeal[mealIdx].map((ing) => ({
        foodId: ing.foodId,
        catalogVersion: ing.catalogVersion,
        grams: ing.currentGrams,
        state: ing.state,
      }));
      return {
        id: `template-meal-${dayIndex + 1}-${template.id}`,
        name: template.name,
        ingredients: mealIngredients,
        servings: 1,
        preparation: template.preparation,
      };
    });

    finalDays.push({
      day: dayIndex + 1,
      meals,
    });
  }

  return {
    feasible: true,
    days: finalDays,
    perDayTotals,
    warnings: warningSet.size > 0 ? [...warningSet].sort() : undefined,
  };
}
