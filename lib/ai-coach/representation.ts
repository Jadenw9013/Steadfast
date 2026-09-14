import { z } from "zod";
import { dietaryTagSchema } from "./catalog/schema";
import { planPayloadSchema, type PlanPayload, type ReviewDecision } from "./plan-contract";
import { composeFixtureMeals } from "./initial-plan";
import type { IntakeAnswers } from "./intake";
import { FOOD_CATALOG_VERSION, FOOD_SUBSTITUTIONS } from "./catalog/food-catalog";
import { computeNutrientTotals } from "./nutrition-totals";
import { checkMealComposition } from "./composition-feasibility";
import { contentHash } from "./canonical-json";
export const substitutionSchema = z.object({ day: z.number().int().min(1).max(7), mealId: z.string().min(1).max(120), foodId: z.string().min(1).max(120), replacementId: z.string().min(1).max(120) }).strict();
export type Substitution = z.infer<typeof substitutionSchema>;

export function mealTargetsMatch(plan: PlanPayload, answers: IntakeAnswers): boolean {
  if (!plan.meals) return true;
  if (answers.dietaryRestrictions.some(r => !dietaryTagSchema.safeParse(r.trim().toUpperCase().replace(/[\s-]+/g, "_")).success)) return false;
  if (!plan.nutrition) return false;
  for (const day of plan.meals.days) {
    const components = day.meals.flatMap(m => m.ingredients);
    if (!checkMealComposition({ components, allergies: answers.allergies, dietaryRestrictions: answers.dietaryRestrictions, nutritionPermission: "ALLOW", policyVersion: plan.policyVersion }).feasible) return false;
    const calculated = computeNutrientTotals(components);
    if (!calculated.success) return false;
    for (const key of ["energyKcal", "proteinG", "carbsG", "fatG"] as const) {
      const target = plan.nutrition.targets[key];
      if (Math.abs(calculated.totals[key] - target) > Math.max(0.1, target * plan.nutrition.tolerancePercent / 100)) return false;
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
    if (!payload.meals || !FOOD_SUBSTITUTIONS[substitution.foodId]?.includes(substitution.replacementId)) return noChange("NO_FEASIBLE_MEALS", "No validated equivalent substitution is available.");
    const meal = payload.meals.days.find(d => d.day === substitution.day)?.meals.find(m => m.id === substitution.mealId);
    const ingredient = meal?.ingredients.find(i => i.foodId === substitution.foodId);
    if (!ingredient || ingredient.catalogVersion !== FOOD_CATALOG_VERSION) return noChange("NO_FEASIBLE_MEALS", "This ingredient is unavailable for the selected substitution.");
    ingredient.foodId = substitution.replacementId;
  } else if (mode === "MACROS") {
    payload.meals = null;
  } else if (!payload.meals) {
    if (!payload.nutrition) return noChange("NO_FEASIBLE_MEALS", "There is no nutrition prescription to represent as meals.");
    const reference = composeFixtureMeals(answers, 1);
    if (!reference) return noChange("NO_FEASIBLE_MEALS", "The fixture catalog cannot meet the stated food constraints.");
    const totals = computeNutrientTotals(reference.days[0].meals.flatMap(m => m.ingredients));
    if (!totals.success) return noChange("NO_FEASIBLE_MEALS", "Catalog totals are unavailable.");
    payload.meals = composeFixtureMeals(answers, payload.nutrition.targets.energyKcal / totals.totals.energyKcal);
    if (!payload.meals) return noChange("NO_FEASIBLE_MEALS", "No practical meal composition fits.");
    payload.catalogVersions.food = FOOD_CATALOG_VERSION;
  }
  payload = planPayloadSchema.parse(payload);
  if (!isTargetPreserving(base, payload, answers)) return noChange("NO_FEASIBLE_MEALS", "The proposed portions cannot preserve the current prescription within its validated ranges.");
  if (contentHash(base) === contentHash(payload)) return noChange("UNCHANGED", "Your current plan already uses this representation.");
  return { payload, decision: { action: "HOLD", reasonCodes: ["REPRESENTATION_ONLY"], explanation: "The presentation changes while the nutrition prescription and training stay the same.", limitations: ["Synthetic portions only; real ingredient verification is still required."], nextAction: "Review and accept the new presentation if it fits your preferences.", changeClass: "TARGET_PRESERVING" } };
}
