import { z } from "zod";
import { dietaryTagSchema } from "./catalog/schema";
import { planPayloadSchema, type PlanPayload, type ReviewDecision } from "./plan-contract";
import { composeFixtureMeals, composeMealsToPrescription } from "./initial-plan";
import type { IntakeAnswers } from "./intake";
import type { Prescription } from "./prescription";
import { FOOD_CATALOG_VERSION, FOOD_SUBSTITUTIONS } from "./catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "./catalog/exercise-catalog";
import { computeNutrientTotals } from "./nutrition-totals";
import { checkMealComposition } from "./composition-feasibility";
import { contentHash } from "./canonical-json";
import type { MealTemplateSet } from "./catalog/meal-template-schema";
import type { FoodCatalogSource } from "./catalog/food-source";
import { isWithinMacroTolerance } from "./meal-composer";
export const substitutionSchema = z.object({ day: z.number().int().min(1).max(7), mealId: z.string().min(1).max(120), foodId: z.string().min(1).max(120), replacementId: z.string().min(1).max(120) }).strict();
export type Substitution = z.infer<typeof substitutionSchema>;

export function substitutionOptionsFor(
  foodId: string,
  templateSet?: MealTemplateSet
): readonly string[] {
  if (templateSet) {
    for (const group of templateSet.substitutionGroups) {
      if (group.memberFoodIds.includes(foodId)) {
        return group.memberFoodIds.filter((id) => id !== foodId);
      }
    }
  }
  return FOOD_SUBSTITUTIONS[foodId] ?? [];
}

export function mealTargetsMatch(
  plan: PlanPayload,
  answers: IntakeAnswers,
  source?: FoodCatalogSource,
  runtimePolicyArtifactKey?: string
): boolean {
  if (!plan.meals) return true;
  if (answers.dietaryRestrictions.some(r => !dietaryTagSchema.safeParse(r.trim().toUpperCase().replace(/[\s-]+/g, "_")).success)) return false;
  if (!plan.nutrition) return false;
  for (const day of plan.meals.days) {
    const components = day.meals.flatMap(m => m.ingredients);
    if (!checkMealComposition({ components, allergies: answers.allergies, dietaryRestrictions: answers.dietaryRestrictions, nutritionPermission: "ALLOW", policyVersion: plan.policyVersion, source, runtimePolicyArtifactKey }).feasible) return false;
    const calculated = computeNutrientTotals(components, source);
    if (!calculated.success) return false;
    for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) {
      const target = plan.nutrition.targets[key];
      if (!isWithinMacroTolerance(calculated.totals[key], target, plan.nutrition.tolerancePercent)) return false;
    }
  }
  return true;
}
export function isTargetPreserving(base: PlanPayload, candidate: PlanPayload, answers: IntakeAnswers): boolean {
  return contentHash(base.nutrition) === contentHash(candidate.nutrition)
    && contentHash(base.strength) === contentHash(candidate.strength)
    && contentHash(base.cardio) === contentHash(candidate.cardio)
    && base.policyVersion === candidate.policyVersion
    && mealTargetsMatch(candidate, answers);
}
export function representFixturePlan(base: PlanPayload, answers: IntakeAnswers, mode: "MACROS" | "MEALS", substitution: Substitution | null = null): { payload: PlanPayload | null; decision: ReviewDecision } {
  let payload = structuredClone(base);
  const noChange = (reason: "NO_FEASIBLE_MEALS" | "UNCHANGED", text: string) => ({ payload: null, decision: { action: "HOLD" as const, reasonCodes: [reason], explanation: text, limitations: ["Synthetic catalog only; nutrient adequacy is not established."], nextAction: "Keep the current plan or update practical preferences.", changeClass: null } });
  if (substitution) {
    if (!payload.meals || !substitutionOptionsFor(substitution.foodId).includes(substitution.replacementId)) return noChange("NO_FEASIBLE_MEALS", "No validated equivalent substitution is available.");
    const meal = payload.meals.days.find(d => d.day === substitution.day)?.meals.find(m => m.id === substitution.mealId);
    const ingredient = meal?.ingredients.find(i => i.foodId === substitution.foodId);
    // T-2040: validate the offer against *this plan's own* food catalog key,
    // not against whatever key this build happens to compile in. A plan bound to
    // another catalog is refused here rather than silently compared to the
    // fixture catalog. Acceptance is not widened: a disagreeing ingredient key is
    // still refused, because `plan.catalogVersions.food` is itself pinned by
    // `planPayloadSchema`'s per-ingredient binding check.
    if (!ingredient || ingredient.catalogVersion !== payload.catalogVersions.food) return noChange("NO_FEASIBLE_MEALS", "This ingredient is unavailable for the selected substitution.");
    ingredient.foodId = substitution.replacementId;
  } else if (mode === "MACROS") {
    payload.meals = null;
  } else if (!payload.meals) {
    if (!payload.nutrition) return noChange("NO_FEASIBLE_MEALS", "There is no nutrition prescription to represent as meals.");
    // T-2040: both composers below stamp FOOD_CATALOG_VERSION into every
    // ingredient (`initial-plan.ts` composeFixtureMeals / composeMealsToPrescription),
    // so composing into a plan bound to another catalog would silently re-label
    // that plan's food catalog. Degrade to NO_FEASIBLE_MEALS instead of
    // disappearing or mislabelling. `noChange` returns, it never throws, so
    // `availableSubstitutions` (and the workspace query behind it) stays safe.
    if (
      payload.catalogVersions.food !== FOOD_CATALOG_VERSION ||
      payload.catalogVersions.exercise !== EXERCISE_CATALOG_VERSION
    )
      return noChange("NO_FEASIBLE_MEALS", "The reviewed catalog for this plan cannot be composed into meals by this build.");
    if (payload.nutrition.method === "REVIEWED_PRESCRIPTION_V1") {
      // T-2033: a prescribed plan's MEALS representation is composed to the
      // prescription, not scaled off a reference recipe. The full engine
      // `Prescription` (with real macro *ranges*) is not persisted on the
      // payload — only its resolved flat targets are — so the composer is
      // called with a point-range reconstruction (min === max === the
      // published target) rather than a copy of `mealTargetsMatch`'s own
      // tolerance arithmetic. A degrade to NO_FEASIBLE_MEALS keeps the
      // targets and drops only the meal list (never disappears).
      const asPrescription: Prescription = {
        method: "REVIEWED_PRESCRIPTION_V1",
        energyMethodStructureId: "",
        parameterSetDigest: payload.prescriptionOutcome?.parameterSetDigest ?? "",
        maintenanceEnergyKcal: payload.nutrition.targets.energyKcal,
        targetEnergyKcal: payload.nutrition.targets.energyKcal,
        proteinG: payload.nutrition.targets.proteinG,
        carbohydrateRangeG: { min: payload.nutrition.targets.carbsG, max: payload.nutrition.targets.carbsG },
        fatRangeG: { min: payload.nutrition.targets.fatG, max: payload.nutrition.targets.fatG },
        projectedWeeklyWeightChangeKg: 0,
        appliedBoundIds: [],
        tolerancePercent: payload.nutrition.tolerancePercent,
        assumptions: payload.nutrition.assumptions,
      };
      // T-2040/S-36a: the gate four lines above guarantees
      // `payload.catalogVersions.food === FOOD_CATALOG_VERSION` on every
      // reachable input, so this is the plan's own bound key, not a second,
      // potentially-disagreeing writer of the same value.
      payload.meals = composeMealsToPrescription(answers, asPrescription, payload.catalogVersions.food);
      if (!payload.meals) return noChange("NO_FEASIBLE_MEALS", "The fixture catalog cannot compose meals within tolerance of the reviewed prescription.");
    } else {
      const reference = composeFixtureMeals(answers, 1);
      if (!reference) return noChange("NO_FEASIBLE_MEALS", "The fixture catalog cannot meet the stated food constraints.");
      const totals = computeNutrientTotals(reference.days[0].meals.flatMap(m => m.ingredients));
      if (!totals.success) return noChange("NO_FEASIBLE_MEALS", "Catalog totals are unavailable.");
      payload.meals = composeFixtureMeals(answers, payload.nutrition.targets.energyKcal / totals.totals.energyKcal);
      if (!payload.meals) return noChange("NO_FEASIBLE_MEALS", "No practical meal composition fits.");
    }
  }
  payload = planPayloadSchema.parse(payload);
  if (!isTargetPreserving(base, payload, answers)) return noChange("NO_FEASIBLE_MEALS", "The proposed portions cannot preserve the current prescription within its validated ranges.");
  if (contentHash(base) === contentHash(payload)) return noChange("UNCHANGED", "Your current plan already uses this representation.");
  return { payload, decision: { action: "HOLD", reasonCodes: ["REPRESENTATION_ONLY"], explanation: "The presentation changes while the nutrition prescription and training stay the same.", limitations: ["Synthetic portions only; real ingredient verification is still required."], nextAction: "Review and accept the new presentation if it fits your preferences.", changeClass: "TARGET_PRESERVING" } };
}

/** Catalog-backed proposals only; each offer is revalidated again by the run
 * command and acceptance path. No client-side nutrient policy is duplicated.
 *
 * T-2040: every offer is validated against **the plan's own** food catalog key
 * (`plan.catalogVersions.food`), never against this build's compile-time
 * `FOOD_CATALOG_VERSION`. A plan bound to a catalog this build does not carry
 * therefore yields `[]` — no offers — rather than cross-catalog offers or a
 * throw. `lib/queries/ai-coach.ts` calls this on the workspace read path, so a
 * throw here would 500 the whole screen. */
export function availableSubstitutions(plan: PlanPayload, answers: IntakeAnswers): Substitution[] {
  const offers: Substitution[] = [];
  for (const day of plan.meals?.days ?? []) for (const meal of day.meals) for (const food of meal.ingredients) {
    for (const replacementId of substitutionOptionsFor(food.foodId)) {
      const offer = { day: day.day, mealId: meal.id, foodId: food.foodId, replacementId };
      if (representFixturePlan(plan, answers, "MEALS", offer).payload) offers.push(offer);
    }
  }
  return offers;
}
