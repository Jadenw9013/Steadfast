import { intakeAnswersSchema, type IntakeAnswers } from "./intake";
import { planPayloadSchema, type PlanPayload, type ReviewDecision } from "./plan-contract";
import { FOOD_CATALOG_VERSION } from "./catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "./catalog/exercise-catalog";
import { ACTIVE_POLICY_VERSION } from "./policy/policy-version";
import { computeNutrientTotals } from "./nutrition-totals";
import { checkMealComposition } from "./composition-feasibility";

/** All doses, targets and templates below are SYNTHETIC TEST FIXTURES (G01/G02).
 * The runtime must additionally require a synthetic subject and nonproduction
 * fixture mode. No combination of public flags authorizes real use of this code.
 */
export function composeFixtureMeals(answers: IntakeAnswers, scale = 1): NonNullable<PlanPayload["meals"]> | null {
  const grams = (value: number) => Math.round(value * scale / 5) * 5;
  const ingredients = [
    { foodId: "chicken-breast-raw", catalogVersion: FOOD_CATALOG_VERSION, grams: grams(150), state: "RAW" as const },
    { foodId: "brown-rice-cooked", catalogVersion: FOOD_CATALOG_VERSION, grams: grams(200), state: "COOKED" as const },
    { foodId: "broccoli-steamed", catalogVersion: FOOD_CATALOG_VERSION, grams: grams(100), state: "COOKED" as const },
  ];
  // This tiny fixture catalog cannot satisfy every preference. Never silently
  // drop an unknown restriction or claim a diet is feasible when it is not.
  if (answers.dietaryRestrictions.some(r => !["GLUTEN_FREE", "DAIRY_FREE"].includes(r.trim().toUpperCase().replace(/[\s-]+/g, "_")))) return null;
  if (!checkMealComposition({ components: ingredients, allergies: answers.allergies, dietaryRestrictions: answers.dietaryRestrictions, nutritionPermission: "ALLOW", policyVersion: ACTIVE_POLICY_VERSION }).feasible) return null;
  return { days: Array.from({ length: 7 }, (_, day) => ({ day: day + 1, meals: Array.from({ length: 3 }, (_, meal) => ({ id: `fixture-meal-${day + 1}-${meal + 1}`, name: "Fixture chicken, rice and broccoli", ingredients, servings: 1, preparation: "Synthetic portion example; reviewed preparation and food-safety instructions are not available." })) })) };
}

export function buildInitialFixturePlan(rawAnswers: unknown, prescriptionId: string, mode: "MACROS" | "MEALS"): { payload: PlanPayload; decision: ReviewDecision } {
  const answers = intakeAnswersSchema.parse(rawAnswers);
  const scale = answers.weightKg && answers.heightCm ? Math.max(0.5, Math.min(2, answers.weightKg / 70)) : null;
  const meals = scale === null ? null : composeFixtureMeals(answers, scale);
  const totals = meals ? computeNutrientTotals(meals.days[0].meals.flatMap(m => m.ingredients)) : null;
  const targets = totals?.success ? {
    energyKcal: Math.round(totals.totals.energyKcal), proteinG: Math.round(totals.totals.proteinG * 10) / 10,
    carbsG: Math.round(totals.totals.carbsG * 10) / 10, fatG: Math.round(totals.totals.fatG * 10) / 10,
  } : null;
  const days = Array.from({ length: answers.trainingDaysPerWeek }, (_, i) => Math.floor(i * 7 / answers.trainingDaysPerWeek) + 1);
  const payload = planPayloadSchema.parse({
    schemaVersion: 1, contentKind: "SYNTHETIC_FIXTURE",
    nutrition: targets ? { prescriptionId, method: "SYNTHETIC_CATALOG_MATCH", targets, tolerancePercent: 5, assumptions: ["Synthetic values for software testing, not a dietary recommendation.", "Micronutrient adequacy is unknown; real policy and catalog review are required."] } : null,
    meals: mode === "MEALS" ? meals : null,
    strength: days.map(day => ({ sessionId: `strength-${day}`, templateId: "fixture-beginner-v1", day, exercises: [{ exerciseId: answers.equipmentAccess.some(e => e !== "NONE") ? "goblet-squat" : "bodyweight-squat", catalogVersion: EXERCISE_CATALOG_VERSION, sets: 2, reps: 8, restSeconds: 90, effort: "Synthetic starting-dose fixture; no live exercise guidance." }] })),
    cardio: [{ sessionId: "cardio-1", exerciseId: "brisk-walk", catalogVersion: EXERCISE_CATALOG_VERSION, day: days[0], durationMinutes: 15, intensity: "Synthetic intensity fixture; qualified review required." }],
    policyVersion: ACTIVE_POLICY_VERSION, catalogVersions: { food: FOOD_CATALOG_VERSION, exercise: EXERCISE_CATALOG_VERSION },
  });
  return { payload, decision: {
    action: targets ? "HOLD" : "CLARIFY", reasonCodes: [targets ? "INITIAL_FIXTURE" : scale === null ? "MISSING_INPUT" : "NO_FEASIBLE_MEALS"],
    explanation: targets ? "Your synthetic proposal is ready for review. It is not active until review and acceptance are complete." : "Nutrition remains unavailable because required measurements or a compatible meal template are missing.",
    limitations: ["Synthetic software demonstration only; not for real-world use."], nextAction: "Review the proposal when it has been approved.", changeClass: "INITIAL",
  } };
}
