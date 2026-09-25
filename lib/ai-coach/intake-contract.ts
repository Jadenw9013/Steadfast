import { z } from "zod";

/**
 * A03 — staged, confirmed intake: the client-safe contract.
 *
 * *** SYNTHETIC FIXTURE SCHEMA ***
 * The fields below are a reasonable placeholder structure for engineering
 * purposes, not an approved intake instrument. The actual required-input
 * mapping for a personalized numerical prescription is G01's deliverable
 * (docs/ai-coach/13). Height/weight are optional here specifically
 * because a missing calculation input must leave personalized nutrition
 * pending rather than inventing a default (docs/ai-coach/06 §4).
 *
 * *** INTAKE V2 (T-2002/T-2024) ***
 * `intakeAnswersSchema` below is now the *read/compatibility* schema: every
 * v1 field is unchanged and every v2 field is `.optional()`, so a historical
 * v1 row and a stored `AiCoachRun.inputSnapshot` both keep parsing forever —
 * never make a field here required, that silently breaks `weekly-proof.ts`,
 * `managed-executor.ts` and `retry-command.ts` re-parsing old rows. The
 * write-time completeness rule for a v2 confirm lives only in
 * `intakeV2ConfirmSchema`, below. No field in either schema encodes an
 * energy/protein/macro/rate number, and no field is derived from any
 * demographic account attribute — the population-routing category
 * (`energyMethodPopulationCategory`) and the activity classification
 * (`physicalActivityCategory`) are dedicated, faithfully-recorded fields.
 * Client-facing wording for those two questions is gate G01's deliverable;
 * this file only ships the frozen engineering structure and a neutral
 * placeholder label constant (`PENDING_G01_WORDING`) for UI to reuse.
 *
 * *** LEAF MODULE, NO SERVER IMPORTS (T-2024 review round 4) ***
 * This file exists so `components/ai-coach/intake-wizard.tsx` — a
 * `"use client"` component — can import the confirm schema, its enums and
 * `PENDING_G01_WORDING` without ever reaching `lib/db.ts`. Next.js/Turbopack
 * bundles by *module*, not by tree-shaken export: a client component
 * importing even one export from a module that transitively imports
 * `lib/db.ts` (→ `@prisma/adapter-pg` → `pg`, which needs Node core modules
 * `dns`/`fs`/`net`/`tls` the browser doesn't have) breaks the production
 * build. Do not add a `db`/`Prisma`/any-DB-touching import to this file —
 * that is exactly the defect this file was split out to fix. `lib/ai-coach/intake.ts`
 * re-exports everything below for every existing server-side consumer, so
 * no other import site needs to change.
 */

export const PENDING_G01_WORDING = "Wording pending review (G01)";

export const fieldStatusSchema = z.enum(["CONFIRMED", "DECLINED", "UNKNOWN"]);
export type FieldStatus = z.infer<typeof fieldStatusSchema>;

// Nine U.S. major allergen categories (dossier §5) + OTHER. Tree nut, fish
// and Crustacean shellfish keep species/type specificity and are never
// collapsed.
export const allergenCategorySchema = z.enum([
  "MILK",
  "EGG",
  "FISH",
  "CRUSTACEAN_SHELLFISH",
  "TREE_NUT",
  "PEANUT",
  "WHEAT",
  "SOYBEAN",
  "SESAME",
  "OTHER",
]);
export type AllergenCategory = z.infer<typeof allergenCategorySchema>;

const NO_SPECIFICITY_CATEGORIES: AllergenCategory[] = [
  "MILK",
  "EGG",
  "PEANUT",
  "WHEAT",
  "SOYBEAN",
  "SESAME",
];

export const allergenDeclarationSchema = z
  .object({
    category: allergenCategorySchema,
    // For TREE_NUT / FISH / CRUSTACEAN_SHELLFISH: a species/type string, or
    // null meaning "not specified" -> the WHOLE category is excluded (most
    // protective). For OTHER: required, non-empty. For the other six: must
    // be null. No severity field exists anywhere — §5.2 forbids
    // severity-based relaxation, and the way to guarantee that is to never
    // collect it.
    specificity: z.string().trim().min(1).max(80).nullable(),
    kind: z.enum(["ALLERGY", "INTOLERANCE_OR_SENSITIVITY"]),
    crossContactAvoidanceRequired: z.enum(["YES", "NO", "UNSURE"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.category === "OTHER" && value.specificity === null) {
      ctx.addIssue({
        code: "custom",
        path: ["specificity"],
        message: "OTHER requires a specificity.",
      });
    }
    if (NO_SPECIFICITY_CATEGORIES.includes(value.category) && value.specificity !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["specificity"],
        message: "This category cannot carry a specificity.",
      });
    }
  });
export type AllergenDeclaration = z.infer<typeof allergenDeclarationSchema>;

export const allergenDeclarationsSchema = z
  .object({
    status: fieldStatusSchema,
    noKnownAllergens: z.boolean(),
    items: z.array(allergenDeclarationSchema).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "CONFIRMED") {
      // noKnownAllergens === true XOR items.length > 0
      if (value.noKnownAllergens === (value.items.length > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: "Declare either no known allergens or at least one item, not both.",
        });
      }
    } else if (value.noKnownAllergens || value.items.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Allergen declarations must be empty unless confirmed.",
      });
    }
  });
export type AllergenDeclarations = z.infer<typeof allergenDeclarationsSchema>;

export const dietaryPatternSchema = z
  .object({
    pattern: z.enum([
      "OMNIVORE",
      "LACTO_OVO_VEGETARIAN",
      "VEGAN",
      "PESCATARIAN",
      "OTHER",
      "NONE_DECLARED",
    ]),
    otherLabel: z.string().trim().min(1).max(80).nullable(), // non-null iff pattern === "OTHER"
    mandatory: z.boolean(), // true => hard exclusion, false => preference
    reason: z.enum([
      "PREFERENCE",
      "RELIGIOUS_OR_ETHICAL",
      "MEDICAL_OR_CLINICIAN_DIRECTED",
      "NOT_STATED",
    ]),
    status: fieldStatusSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.pattern === "OTHER" && value.otherLabel === null) {
      ctx.addIssue({
        code: "custom",
        path: ["otherLabel"],
        message: "OTHER requires otherLabel.",
      });
    }
    if (value.pattern !== "OTHER" && value.otherLabel !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["otherLabel"],
        message: "otherLabel is only valid when pattern is OTHER.",
      });
    }
  });
export type DietaryPattern = z.infer<typeof dietaryPatternSchema>;

export const cookingAccessSchema = z
  .object({
    equipment: z.array(z.enum(["NONE", "MICROWAVE", "STOVETOP", "OVEN", "FULL_KITCHEN"])).min(1).max(5),
    refrigeration: z.enum(["NONE", "FRIDGE", "FRIDGE_AND_FREEZER"]),
    mealPrepCapacity: z.enum(["NONE", "SOME", "BATCH"]),
    typicalPrepMinutesBand: z.enum(["UNDER_15", "MIN_15_30", "MIN_30_60", "OVER_60"]),
  })
  .strict();
export type CookingAccess = z.infer<typeof cookingAccessSchema>;

const dislikeSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    canonicalFoodId: z.string().max(120).nullable(),
  })
  .strict();

export const intakeAnswersSchema = z
  .object({
    // --- v1 (unchanged) ---
    goal: z.enum(["GENERAL_FITNESS", "STRENGTH", "ENDURANCE", "BODY_COMPOSITION"]),
    experienceLevel: z.enum(["NEW", "RETURNING", "EXPERIENCED"]),
    trainingDaysPerWeek: z.number().int().min(1).max(7),
    equipmentAccess: z.array(z.enum(["NONE", "HOME_BASIC", "FULL_GYM"])).min(1),
    dietaryRestrictions: z.array(z.string().max(100)).max(20),
    allergies: z.array(z.string().max(100)).max(20),
    foodBudgetLevel: z.enum(["LOW", "MODERATE", "FLEXIBLE"]),
    trackingPreference: z.enum(["NUMBERS_VISIBLE", "PORTIONS_ONLY"]),
    unitsPreference: z.enum(["METRIC", "IMPERIAL"]),
    // Calculation inputs — optional. Absent means personalized nutrition
    // stays pending; it is never inferred from name, appearance or any
    // other demographic account attribute.
    heightCm: z.number().positive().max(300).optional(),
    weightKg: z.number().positive().max(400).optional(),

    // --- v2 — ALL optional on read; order and names are frozen ---
    intakeVersion: z.literal(2).optional(),
    capturedAt: z.string().datetime().optional(),
    ageYears: z.number().int().positive().max(120).optional(),
    ageStatus: fieldStatusSchema.optional(),
    energyMethodPopulationCategory: z
      .enum(["MALE_ADULT", "FEMALE_ADULT", "PREGNANCY", "LACTATION", "NOT_LISTED"])
      .optional(),
    energyMethodPopulationCategoryStatus: fieldStatusSchema.optional(),
    physicalActivityCategory: z.enum(["INACTIVE", "LOW_ACTIVE", "ACTIVE", "VERY_ACTIVE"]).optional(),
    physicalActivityCategoryStatus: fieldStatusSchema.optional(),
    bodyMeasurementStatus: fieldStatusSchema.optional(),
    weightMeasuredOn: z.string().date().optional(),
    bodyWeightIntent: z.enum(["LOSE", "MAINTAIN", "GAIN", "NO_PREFERENCE"]).optional(),
    goalPaceClass: z.enum(["MAINTAIN", "GRADUAL", "MODERATE", "UNDECIDED"]).optional(),
    weightNeutralAccepted: z.boolean().optional(),
    goalStatus: fieldStatusSchema.optional(),
    resistanceTrainingContext: z.enum(["NONE", "OCCASIONAL", "REGULAR"]).optional(),
    sessionLengthBand: z
      .enum(["UNDER_30", "MIN_30_45", "MIN_45_60", "MIN_60_90", "OVER_90"])
      .optional(),
    trainingContextStatus: fieldStatusSchema.optional(),
    cookingAccess: cookingAccessSchema.optional(),
    cookingAccessStatus: fieldStatusSchema.optional(),
    dislikes: z.array(dislikeSchema).max(30).optional(),
    cuisinePreferences: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
    allergenDeclarations: allergenDeclarationsSchema.optional(),
    dietaryPattern: dietaryPatternSchema.optional(),
  })
  .strict();
export type IntakeAnswers = z.infer<typeof intakeAnswersSchema>;

export const intakeDraftSchema = intakeAnswersSchema.partial();
export type IntakeDraftAnswers = z.infer<typeof intakeDraftSchema>;

/** `intakeVersion: 2` is the only version discriminator. Never inferred from
 * field presence. */
export function isV2Intake(answers: unknown): boolean {
  return (
    typeof answers === "object" &&
    answers !== null &&
    (answers as Record<string, unknown>).intakeVersion === 2
  );
}

/**
 * The *write* schema for a v2 `CONFIRM_INTAKE`. Requires every v1 field plus
 * every v2 status field, `allergenDeclarations`, `dietaryPattern`,
 * `dislikes` and `cuisinePreferences`. Value fields governed by a status
 * stay optional in the type and are made conditionally required by
 * `superRefine` against their status: `CONFIRMED` requires the value(s),
 * `DECLINED`/`UNKNOWN` requires them absent. No v2 confirm is ever rejected
 * merely because a status is `DECLINED`/`UNKNOWN` — confirming with gaps is
 * legal and is exactly the "nutrition stays pending" path. `capturedAt`,
 * `allergies` and `dietaryRestrictions` are deliberately NOT accepted keys
 * here (the server sets/derives them) — `.strict()` turns a client sending
 * any of them into a validation error.
 *
 * `intakeV2ConfirmObjectSchema` is the refinement-free base — exists so
 * callers (the web wizard's allow-list, a future JSON-Schema translation)
 * can read `.shape` for the exact frozen key set without duplicating it by
 * hand and risking drift from the schema that actually validates.
 * `intakeV2ConfirmSchema` below stays the authority for validation.
 */
export const intakeV2ConfirmObjectSchema = z
  .object({
    intakeVersion: z.literal(2),
    goal: z.enum(["GENERAL_FITNESS", "STRENGTH", "ENDURANCE", "BODY_COMPOSITION"]),
    experienceLevel: z.enum(["NEW", "RETURNING", "EXPERIENCED"]),
    trainingDaysPerWeek: z.number().int().min(1).max(7),
    equipmentAccess: z.array(z.enum(["NONE", "HOME_BASIC", "FULL_GYM"])).min(1),
    foodBudgetLevel: z.enum(["LOW", "MODERATE", "FLEXIBLE"]),
    trackingPreference: z.enum(["NUMBERS_VISIBLE", "PORTIONS_ONLY"]),
    unitsPreference: z.enum(["METRIC", "IMPERIAL"]),
    heightCm: z.number().positive().max(300).optional(),
    weightKg: z.number().positive().max(400).optional(),

    ageYears: z.number().int().positive().max(120).optional(),
    ageStatus: fieldStatusSchema,
    energyMethodPopulationCategory: z
      .enum(["MALE_ADULT", "FEMALE_ADULT", "PREGNANCY", "LACTATION", "NOT_LISTED"])
      .optional(),
    energyMethodPopulationCategoryStatus: fieldStatusSchema,
    physicalActivityCategory: z.enum(["INACTIVE", "LOW_ACTIVE", "ACTIVE", "VERY_ACTIVE"]).optional(),
    physicalActivityCategoryStatus: fieldStatusSchema,
    bodyMeasurementStatus: fieldStatusSchema,
    weightMeasuredOn: z.string().date().optional(),
    bodyWeightIntent: z.enum(["LOSE", "MAINTAIN", "GAIN", "NO_PREFERENCE"]).optional(),
    goalPaceClass: z.enum(["MAINTAIN", "GRADUAL", "MODERATE", "UNDECIDED"]).optional(),
    weightNeutralAccepted: z.boolean().optional(),
    goalStatus: fieldStatusSchema,
    resistanceTrainingContext: z.enum(["NONE", "OCCASIONAL", "REGULAR"]).optional(),
    sessionLengthBand: z
      .enum(["UNDER_30", "MIN_30_45", "MIN_45_60", "MIN_60_90", "OVER_90"])
      .optional(),
    trainingContextStatus: fieldStatusSchema,
    cookingAccess: cookingAccessSchema.optional(),
    cookingAccessStatus: fieldStatusSchema,
    dislikes: z.array(dislikeSchema).max(30),
    cuisinePreferences: z.array(z.string().trim().min(1).max(60)).max(10),
    allergenDeclarations: allergenDeclarationsSchema,
    dietaryPattern: dietaryPatternSchema,
  })
  .strict();

export const intakeV2ConfirmSchema = intakeV2ConfirmObjectSchema.superRefine((value, ctx) => {
  const jointly = (status: FieldStatus, fields: { key: string; present: boolean }[]) => {
    if (status === "CONFIRMED") {
      for (const field of fields) {
        if (!field.present)
          ctx.addIssue({
            code: "custom",
            path: [field.key],
            message: "Required when its status is CONFIRMED.",
          });
      }
    } else {
      for (const field of fields) {
        if (field.present)
          ctx.addIssue({
            code: "custom",
            path: [field.key],
            message: "Must be absent unless its status is CONFIRMED.",
          });
      }
    }
  };

  jointly(value.ageStatus, [{ key: "ageYears", present: value.ageYears !== undefined }]);
  jointly(value.energyMethodPopulationCategoryStatus, [
    {
      key: "energyMethodPopulationCategory",
      present: value.energyMethodPopulationCategory !== undefined,
    },
  ]);
  jointly(value.physicalActivityCategoryStatus, [
    { key: "physicalActivityCategory", present: value.physicalActivityCategory !== undefined },
  ]);
  jointly(value.bodyMeasurementStatus, [
    { key: "heightCm", present: value.heightCm !== undefined },
    { key: "weightKg", present: value.weightKg !== undefined },
    { key: "weightMeasuredOn", present: value.weightMeasuredOn !== undefined },
  ]);
  jointly(value.goalStatus, [
    { key: "bodyWeightIntent", present: value.bodyWeightIntent !== undefined },
    { key: "goalPaceClass", present: value.goalPaceClass !== undefined },
    { key: "weightNeutralAccepted", present: value.weightNeutralAccepted !== undefined },
  ]);
  jointly(value.trainingContextStatus, [
    {
      key: "resistanceTrainingContext",
      present: value.resistanceTrainingContext !== undefined,
    },
    { key: "sessionLengthBand", present: value.sessionLengthBand !== undefined },
  ]);
  jointly(value.cookingAccessStatus, [
    { key: "cookingAccess", present: value.cookingAccess !== undefined },
  ]);
});
export type IntakeV2ConfirmAnswers = z.infer<typeof intakeV2ConfirmSchema>;
