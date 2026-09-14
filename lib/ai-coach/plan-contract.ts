import { z } from "zod";
import { getExerciseItem, getFoodItem } from "./catalog/loader";

const id = z.string().min(1).max(120);
const amount = z.number().finite().nonnegative().max(10000);
export const sourceRefSchema = z.object({ kind: z.enum(["CHECK_IN", "SESSION"]), id, revision: z.number().int().nonnegative(), digest: z.string().length(64) }).strict();
export const quantitiesSchema = z.object({ energyKcal: amount, proteinG: amount, carbsG: amount, fatG: amount }).strict();
export const ingredientSchema = z.object({ foodId: id, catalogVersion: id, grams: z.number().positive().max(3000), state: z.enum(["RAW", "COOKED", "READY_TO_EAT"]) }).strict();
const mealSchema = z.object({ id, name: z.string().min(1).max(120), ingredients: z.array(ingredientSchema).min(1).max(20), servings: z.number().positive().max(20), preparation: z.string().max(500) }).strict();
export const planPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  contentKind: z.literal("SYNTHETIC_FIXTURE"),
  nutrition: z.object({
    prescriptionId: id, method: z.literal("SYNTHETIC_CATALOG_MATCH"),
    targets: quantitiesSchema, tolerancePercent: z.number().min(0).max(20),
    assumptions: z.array(z.string().max(300)).max(10),
  }).strict().nullable(),
  meals: z.object({ days: z.array(z.object({ day: z.number().int().min(1).max(7), meals: z.array(mealSchema).min(1).max(6) }).strict()).length(7) }).strict().nullable(),
  strength: z.array(z.object({
    sessionId: id, templateId: id, day: z.number().int().min(1).max(7),
    exercises: z.array(z.object({ exerciseId: id, catalogVersion: id, sets: z.number().int().min(1).max(10), reps: z.number().int().min(1).max(50), restSeconds: z.number().int().min(0).max(600), effort: z.string().min(1).max(200) }).strict()).min(1).max(12),
  }).strict()).max(7),
  cardio: z.array(z.object({ sessionId: id, exerciseId: id, catalogVersion: id, day: z.number().int().min(1).max(7), durationMinutes: z.number().positive().max(180), intensity: z.string().min(1).max(200) }).strict()).max(7),
  policyVersion: id,
  catalogVersions: z.object({ food: id, exercise: id }).strict(),
}).strict().superRefine((plan, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (plan.meals && !plan.nutrition) invalid("Meals require a nutrition prescription.");
  if (plan.meals && new Set(plan.meals.days.map(d => d.day)).size !== 7) invalid("Meal days must be unique.");
  const sessions = [...plan.strength, ...plan.cardio];
  if (new Set(sessions.map(s => s.sessionId)).size !== sessions.length) invalid("Session IDs must be unique.");
  for (const session of plan.strength) for (const exercise of session.exercises) {
    const lookup = getExerciseItem(exercise.exerciseId, exercise.catalogVersion);
    if (!lookup.success || lookup.item.modality !== "STRENGTH" || exercise.catalogVersion !== plan.catalogVersions.exercise) invalid("Unknown or incompatible strength exercise.");
  }
  for (const session of plan.cardio) {
    const lookup = getExerciseItem(session.exerciseId, session.catalogVersion);
    if (!lookup.success || lookup.item.modality !== "CARDIO" || session.catalogVersion !== plan.catalogVersions.exercise) invalid("Unknown or incompatible cardio exercise.");
  }
  for (const day of plan.meals?.days ?? []) for (const meal of day.meals) for (const ingredient of meal.ingredients) {
    if (!getFoodItem(ingredient.foodId, ingredient.catalogVersion).success || ingredient.catalogVersion !== plan.catalogVersions.food) invalid("Unknown or incompatible food.");
  }
});
export type PlanPayload = z.infer<typeof planPayloadSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export const decisionSchema = z.object({
  action: z.enum(["HOLD", "SIMPLIFY", "ADJUST", "CLARIFY", "PAUSE_REFER"]),
  reasonCodes: z.array(z.enum(["INITIAL_FIXTURE", "MISSING_INPUT", "INSUFFICIENT_EVIDENCE", "RECOVERY_CONCERN", "SCHEDULE_BARRIER", "SUPPORTED_FIXTURE_CHANGE", "CUMULATIVE_LIMIT", "SAFETY_CONCERN", "REPRESENTATION_ONLY", "NO_FEASIBLE_MEALS", "UNCHANGED"])).min(1).max(10),
  explanation: z.string().min(1).max(1000),
  limitations: z.array(z.string().max(300)).max(10),
  nextAction: z.string().min(1).max(300),
  changeClass: z.enum(["INITIAL", "ROUTINE", "TARGET_PRESERVING", "PROTECTIVE"]).nullable(),
}).strict();
export type ReviewDecision = z.infer<typeof decisionSchema>;
