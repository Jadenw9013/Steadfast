import type { PlanPayload } from "./plan-contract";
import type { FoodCatalogSource, ResolvedFoodItem } from "./catalog/food-source";
import type { MealTemplate, MealTemplateSet, TemplateIngredient } from "./catalog/meal-template-schema";
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
  const slots: ("BREAKFAST" | "LUNCH" | "DINNER" | "SNACK")[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];
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

  // 3. Select (stable sort & round-robin assignment)
  const sortedBySlot = new Map<string, MealTemplate[]>();
  const warnings: string[] = [];
  const maxRepeats = input.maxRepeatsPerWeek ?? 3;
  const minNeeded = Math.ceil(7 / maxRepeats);

  const dislikedSet = new Set(input.constraints.dislikedFoodIds);

  for (const slot of requiredSlots) {
    const list = [...(survivorsBySlot.get(slot) ?? [])];
    if (list.length < minNeeded) {
      warnings.push("LOW_TEMPLATE_VARIETY");
    }

    list.sort((a, b) => {
      // 1. Count disliked foods ASC
      const aFlat = flattenTemplateIngredients(a, templatesById);
      const bFlat = flattenTemplateIngredients(b, templatesById);
      const aDisliked = aFlat.filter((ing) => dislikedSet.has(ing.foodId)).length;
      const bDisliked = bFlat.filter((ing) => dislikedSet.has(ing.foodId)).length;
      if (aDisliked !== bDisliked) return aDisliked - bDisliked;

      // 2. Pattern tag match DESC
      const aMatch = a.patternTags.some((tag) => input.constraints.patternTags.includes(tag)) ? 1 : 0;
      const bMatch = b.patternTags.some((tag) => input.constraints.patternTags.includes(tag)) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;

      // 3. ID ASC
      return a.id.localeCompare(b.id);
    });

    sortedBySlot.set(slot, list);
  }

  const selectedByDay: MealTemplate[][] = Array.from({ length: 7 }, () => []);

  for (const slot of requiredSlots) {
    const list = sortedBySlot.get(slot)!;
    for (let day = 0; day < 7; day++) {
      const template = list[day % list.length];
      selectedByDay[day].push(template);
    }
  }

  // 4. Scale per day
  type DayIngredientState = {
    foodId: string;
    catalogVersion: string;
    state: "RAW" | "COOKED" | "READY_TO_EAT";
    scaling: "SCALES" | "FIXED";
    minGrams: number;
    nominalGrams: number;
    maxGrams: number;
    currentGrams: number;
    item: ResolvedFoodItem;
  };

  const finalDays: NonNullable<PlanPayload["meals"]>["days"] = [];
  const perDayTotals: NutrientTotals[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const dayTemplates = selectedByDay[dayIndex];
    const dayIngredientsByMeal: DayIngredientState[][] = [];

    for (const template of dayTemplates) {
      const mealIngs: DayIngredientState[] = [];
      const flat = flattenTemplateIngredients(template, templatesById);
      for (const f of flat) {
        const lookup = input.source.get(f.foodId, f.catalogVersion);
        if (!lookup.success) {
          return {
            feasible: false,
            reasons: [{ code: "CATALOG_REFERENCE_INVALID", detail: { foodId: f.foodId, error: lookup.error } }],
          };
        }
        mealIngs.push({
          foodId: f.foodId,
          catalogVersion: f.catalogVersion,
          state: f.state,
          scaling: f.scaling,
          minGrams: f.minGrams,
          nominalGrams: f.nominalGrams,
          maxGrams: f.maxGrams,
          currentGrams: f.nominalGrams,
          item: lookup.item,
        });
      }
      dayIngredientsByMeal.push(mealIngs);
    }

    const allDayIngredients = dayIngredientsByMeal.flat();
    const scalable = allDayIngredients.filter((i) => i.scaling === "SCALES");

    // Solver loop (up to 8 iterations)
    for (let iter = 0; iter < 8; iter++) {
      // Step a: Energy scaling
      let fixedEnergy = 0;
      for (const i of allDayIngredients) {
        if (i.scaling === "FIXED") {
          fixedEnergy += (i.currentGrams / i.item.servingGrams) * i.item.energyKcalPerServing;
        }
      }

      const neededEnergy = Math.max(0, input.targets.energyKcal - fixedEnergy);
      let nominalScalableEnergy = 0;
      for (const i of scalable) {
        nominalScalableEnergy += (i.nominalGrams / i.item.servingGrams) * i.item.energyKcalPerServing;
      }

      if (nominalScalableEnergy > 0) {
        const s = neededEnergy / nominalScalableEnergy;
        for (const i of scalable) {
          i.currentGrams = Math.min(i.maxGrams, Math.max(i.minGrams, i.nominalGrams * s));
        }
      }

      // Step b: Bounded coordinate pass for protein
      let currentProtein = 0;
      for (const i of allDayIngredients) {
        currentProtein += (i.currentGrams / i.item.servingGrams) * i.item.proteinGPerServing;
      }

      let proteinGap = input.targets.proteinG - currentProtein;
      // Sort scalable by protein-per-kcal descending
      scalable.sort((a, b) => {
        const aRatio =
          a.item.energyKcalPerServing > 0 ? a.item.proteinGPerServing / a.item.energyKcalPerServing : 0;
        const bRatio =
          b.item.energyKcalPerServing > 0 ? b.item.proteinGPerServing / b.item.energyKcalPerServing : 0;
        return bRatio - aRatio;
      });

      if (proteinGap > 0) {
        for (const i of scalable) {
          const proteinPerGram = i.item.proteinGPerServing / i.item.servingGrams;
          if (proteinPerGram <= 0) continue;
          const availableGrams = i.maxGrams - i.currentGrams;
          if (availableGrams <= 0) continue;
          const gramsNeeded = proteinGap / proteinPerGram;
          const increase = Math.min(availableGrams, gramsNeeded);
          i.currentGrams += increase;
          proteinGap -= increase * proteinPerGram;
          if (proteinGap <= 0.1) break;
        }
      } else if (proteinGap < 0) {
        let absGap = -proteinGap;
        // Reduce from the bottom (lowest protein/kcal or highest)
        for (let idx = scalable.length - 1; idx >= 0; idx--) {
          const i = scalable[idx];
          const proteinPerGram = i.item.proteinGPerServing / i.item.servingGrams;
          if (proteinPerGram <= 0) continue;
          const reducibleGrams = i.currentGrams - i.minGrams;
          if (reducibleGrams <= 0) continue;
          const gramsToReduce = absGap / proteinPerGram;
          const decrease = Math.min(reducibleGrams, gramsToReduce);
          i.currentGrams -= decrease;
          absGap -= decrease * proteinPerGram;
          if (absGap <= 0.1) break;
        }
      }
    }

    // Step c: Round every gram to the nearest 5, clamped to [minGrams, maxGrams]
    for (const i of allDayIngredients) {
      if (i.scaling === "SCALES") {
        const rounded = Math.round(i.currentGrams / 5) * 5;
        // Clamp to min/max
        i.currentGrams = Math.min(i.maxGrams, Math.max(i.minGrams, rounded));
      } else {
        i.currentGrams = i.nominalGrams;
      }
    }

    // Compute day totals
    const dayComponents: RecipeComponent[] = allDayIngredients.map((i) => ({
      foodId: i.foodId,
      catalogVersion: i.catalogVersion,
      grams: i.currentGrams,
    }));

    const totalsResult = computeNutrientTotals(dayComponents, input.source);
    if (!totalsResult.success) {
      return {
        feasible: false,
        reasons: [{ code: "CATALOG_REFERENCE_INVALID", detail: { foodId: totalsResult.foodId, error: totalsResult.error } }],
      };
    }

    // Check all four macros against tolerancePercent using mealTargetsMatch logic
    const dayTotals = totalsResult.totals;
    const macroKeys = ["energyKcal", "proteinG", "carbsG", "fatG"] as const;
    let worstMacro = "";
    let worstDeviationRatio = -1;
    let worstAchieved = 0;
    let worstTarget = 0;

    for (const key of macroKeys) {
      const target = input.targets[key];
      const achieved = dayTotals[key];
      const allowed = Math.max(0.1, (target * input.tolerancePercent) / 100);
      const diff = Math.abs(achieved - target);
      const ratio = diff / allowed;
      if (diff > allowed && ratio > worstDeviationRatio) {
        worstDeviationRatio = ratio;
        worstMacro = key;
        worstAchieved = achieved;
        worstTarget = target;
      }
    }

    if (worstMacro !== "") {
      return {
        feasible: false,
        reasons: [
          {
            code: "NO_FEASIBLE_MEALS",
            detail: {
              day: String(dayIndex + 1),
              worstMacro,
              achieved: String(worstAchieved),
              target: String(worstTarget),
            },
          },
        ],
      };
    }

    // 5. Re-verify the day
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
      return { feasible: false, reasons: dayCheck.reasons };
    }

    perDayTotals.push(dayTotals);

    // Build the day's meals
    const meals = dayTemplates.map((template, mealIdx) => {
      const mealIngredients = dayIngredientsByMeal[mealIdx].map((ing) => ({
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
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
