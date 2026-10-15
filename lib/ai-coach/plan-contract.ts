import { z } from "zod";
import { getExerciseItem, getFoodItem, type CatalogLookupResult } from "./catalog/loader";

const id = z.string().min(1).max(120);
const amount = z.number().finite().nonnegative().max(10000);
export const sourceRefSchema = z
  .object({
    kind: z.enum(["CHECK_IN", "SESSION"]),
    id,
    revision: z.number().int().nonnegative(),
    digest: z.string().length(64),
  })
  .strict();
export const quantitiesSchema = z
  .object({ energyKcal: amount, proteinG: amount, carbsG: amount, fatG: amount })
  .strict();
export const ingredientSchema = z
  .object({
    foodId: id,
    catalogVersion: id,
    grams: z.number().positive().max(3000),
    state: z.enum(["RAW", "COOKED", "READY_TO_EAT"]),
  })
  .strict();
const mealSchema = z
  .object({
    id,
    name: z.string().min(1).max(120),
    ingredients: z.array(ingredientSchema).min(1).max(20),
    servings: z.number().positive().max(20),
    preparation: z.string().max(500),
  })
  .strict();
/**
 * T-2033 — additive widening (board/tickets/T-2003.md "### Plan payload
 * contract"). Both changes keep every historical row parseable:
 * `readNutritionHistory` (nutrition-safety.ts:244-251) turns any parse
 * failure into `UNVERIFIABLE` -> HOLD forever for that client, so a
 * historical `SYNTHETIC_CATALOG_MATCH` row and an absent
 * `prescriptionOutcome` must keep parsing exactly as before.
 */
export const nutritionMethodSchema = z.enum([
  "SYNTHETIC_CATALOG_MATCH",
  "REVIEWED_PRESCRIPTION_V1",
]);
export const prescriptionOutcomeSchema = z
  .object({
    status: z.enum(["PRESCRIBED", "UNAVAILABLE"]),
    reasonCodes: z.array(z.string().min(1).max(120)).max(20),
    nutritionRequired: z.boolean(),
    parameterSetDigest: z.string().length(64).nullable(),
  })
  .strict();
export type PrescriptionOutcome = z.infer<typeof prescriptionOutcomeSchema>;

export const strengthSessionSchema = z
  .object({
    sessionId: id,
    templateId: id,
    day: z.number().int().min(1).max(7),
    exercises: z
      .array(
        z
          .object({
            exerciseId: id,
            catalogVersion: id,
            sets: z.number().int().min(1).max(10),
            reps: z.number().int().min(1).max(50),
            restSeconds: z.number().int().min(0).max(600),
            effort: z.string().min(1).max(200),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();

export const cardioSessionSchema = z
  .object({
    sessionId: id,
    exerciseId: id,
    catalogVersion: id,
    day: z.number().int().min(1).max(7),
    durationMinutes: z.number().positive().max(180),
    intensity: z.string().min(1).max(200),
  })
  .strict();

export const planPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    // T-2040 — additive widening. `REVIEWED_LIVE_V1` is only *writable* after
    // T-2041; every stored row today is `SYNTHETIC_FIXTURE` and keeps parsing
    // identically. iOS decodes `contentKind` as a plain `String`
    // (`Models/AICoach.swift:65`), so the shipped build is unaffected.
    contentKind: z.enum(["SYNTHETIC_FIXTURE", "REVIEWED_LIVE_V1"]),
    nutrition: z
      .object({
        prescriptionId: id,
        method: nutritionMethodSchema,
        targets: quantitiesSchema,
        tolerancePercent: z.number().min(0).max(20),
        assumptions: z.array(z.string().max(300)).max(10),
      })
      .strict()
      .nullable(),
    meals: z
      .object({
        days: z
          .array(
            z
              .object({
                day: z.number().int().min(1).max(7),
                meals: z.array(mealSchema).min(1).max(6),
              })
              .strict()
          )
          .length(7),
      })
      .strict()
      .nullable(),
    strength: z.array(strengthSessionSchema).max(7),
    cardio: z.array(cardioSessionSchema).max(7),
    policyVersion: id,
    catalogVersions: z.object({ food: id, exercise: id }).strict(),
    // Absent means "legacy candidate" — the gate reads that as
    // {status:"PRESCRIBED", nutritionRequired:false} so no existing row
    // changes meaning (T-2003 Amendment: "one reader, one meaning").
    prescriptionOutcome: prescriptionOutcomeSchema.optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    if (plan.meals && !plan.nutrition) invalid("Meals require a nutrition prescription.");
    if (plan.meals && new Set(plan.meals.days.map((d) => d.day)).size !== 7)
      invalid("Meal days must be unique.");
    const sessions = [...plan.strength, ...plan.cardio];
    if (new Set(sessions.map((s) => s.sessionId)).size !== sessions.length)
      invalid("Session IDs must be unique.");
    // T-2040 — catalog references resolve by key. The in-code catalogs are the
    // fixture keys this build happens to carry, not the authority on which keys
    // exist: a plan bound to a *reviewed* catalog is validated by the
    // artifact-backed `catalogItemsValid` in `autonomy/gate.ts` instead, which
    // additionally carries the two modality assertions below. So a lookup that
    // reports `CATALOG_VERSION_NOT_SERVED` means "this build cannot resolve that
    // catalog", not "this payload is invalid", and must not mark the payload
    // invalid — otherwise every read path behind this schema (workspace, session
    // logging, nutrition history) renders blank for a live-bound plan rather than
    // degrading. `UNKNOWN_ID` and `CATALOG_VERSION_MISMATCH` are unchanged: a
    // reference this build *can* check and finds wrong is still invalid.
    const referenceIsInvalid = <T extends { modality: string }>(
      lookup: CatalogLookupResult<T>,
      requiredModality: "STRENGTH" | "CARDIO"
    ) =>
      lookup.success
        ? lookup.item.modality !== requiredModality
        : lookup.error !== "CATALOG_VERSION_NOT_SERVED";
    for (const session of plan.strength)
      for (const exercise of session.exercises) {
        if (
          exercise.catalogVersion !== plan.catalogVersions.exercise ||
          referenceIsInvalid(
            getExerciseItem(exercise.exerciseId, exercise.catalogVersion),
            "STRENGTH"
          )
        )
          invalid("Unknown or incompatible strength exercise.");
      }
    for (const session of plan.cardio) {
      if (
        session.catalogVersion !== plan.catalogVersions.exercise ||
        referenceIsInvalid(getExerciseItem(session.exerciseId, session.catalogVersion), "CARDIO")
      )
        invalid("Unknown or incompatible cardio exercise.");
    }
    for (const day of plan.meals?.days ?? [])
      for (const meal of day.meals)
        for (const ingredient of meal.ingredients) {
          const lookup = getFoodItem(ingredient.foodId, ingredient.catalogVersion);
          if (
            ingredient.catalogVersion !== plan.catalogVersions.food ||
            (!lookup.success && lookup.error !== "CATALOG_VERSION_NOT_SERVED")
          )
            invalid("Unknown or incompatible food.");
        }
  });
export type PlanPayload = z.infer<typeof planPayloadSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export const decisionSchema = z
  .object({
    action: z.enum(["HOLD", "SIMPLIFY", "ADJUST", "CLARIFY", "PAUSE_REFER"]),
    reasonCodes: z
      .array(
        z.enum([
          "INITIAL_FIXTURE",
          "MISSING_INPUT",
          "INSUFFICIENT_EVIDENCE",
          "RECOVERY_CONCERN",
          "SCHEDULE_BARRIER",
          "SUPPORTED_FIXTURE_CHANGE",
          "CUMULATIVE_LIMIT",
          "CONSECUTIVE_DEFICIT_BLOCKED",
          "SAFETY_CONCERN",
          "REPRESENTATION_ONLY",
          "NO_FEASIBLE_MEALS",
          "UNCHANGED",
          "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE",
          "WEEKLY_PARAMETER_MISSING",
          "NUTRITION_FLOOR_BLOCKED",
          // T-2040 — appended last. Additive: every existing reason code still
          // parses, and nothing writes this one until the live composer exists.
          "LIVE_COMPOSITION_UNAVAILABLE",
        ])
      )
      .min(1)
      .max(10),
    explanation: z.string().min(1).max(1000),
    limitations: z.array(z.string().max(300)).max(10),
    nextAction: z.string().min(1).max(300),
    changeClass: z.enum(["INITIAL", "ROUTINE", "TARGET_PRESERVING", "PROTECTIVE"]).nullable(),
  })
  .strict();
export type ReviewDecision = z.infer<typeof decisionSchema>;
