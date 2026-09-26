import { z } from "zod";
import type { PrescriptionInput, PrescriptionReasonCode } from "./types";

/**
 * T-2032 — `buildPrescriptionInput` parses `AiCoachProfile.confirmedIntake`
 * (or an equivalent raw answers object) against the *read* shape of T-2002's
 * frozen intake v2 contract — source: board/tickets/T-2002.md "## Spec" ->
 * "### Contract (frozen)". It cannot import `lib/ai-coach/intake.ts`
 * directly: that file's v2 fields are T-2024's own in-flight change and
 * this ticket's "Out of scope" section forbids editing any file outside
 * `lib/ai-coach/prescription/`, so this is a local mirror of the same
 * frozen field names/enums/status rule, not a second design.
 *
 * **This mirror is temporary (T-2003 Amendment 1 §A1.4).** T-2033 deletes
 * this file's schema and imports the merged v2 schema from
 * `lib/ai-coach/intake.ts` instead, in the same commit adding a test that
 * round-trips a real `CONFIRM_INTAKE` v2 payload through
 * `buildPrescriptionInput`. Until that lands, a T-2024 field shape that
 * diverges from what T-2002 froze would silently pass here unnoticed — see
 * the SPEC_GAP note in board/reviews/T-2032-web-engineer-r1.md.
 *
 * Every v2 field is optional on read (T-2002 decision summary): a status
 * other than `CONFIRMED` — or an absent/malformed value — always maps to
 * `null`, even if a value happens to be present in the raw payload (a
 * status/value disagreement can never produce a number). The engine reads
 * nothing else: no `goal`, no free text, no `dislikes`, no
 * `cuisinePreferences`, no allergen strings, no account `gender`. Unknown
 * keys are always ignored (not an error) — permissive on read, matching why
 * T-2002 keeps `intakeAnswersSchema` permissive: it is embedded in
 * `runSnapshotSchema` and re-parsed for historical rows.
 */

const fieldStatusSchema = z.enum(["CONFIRMED", "DECLINED", "UNKNOWN"]);
type FieldStatus = z.infer<typeof fieldStatusSchema>;

const optionalNumber = z.number().optional().catch(undefined);
const optionalStatus = fieldStatusSchema.optional().catch(undefined);
/** T-2002 froze this as `z.string().date()` — a real Gregorian calendar date,
 * not just a `\d{4}-\d{2}-\d{2}` shape: it rejects "2026-09-31", "2026-02-30"
 * and a datetime string like "2026-09-20T00:00:00Z" (T-2032 review r1 finding
 * B2 — the local mirror had dropped this, so a malformed date silently
 * produced NaN days-since and passed the staleness gate). */
const optionalCalendarDateString = z.string().date().optional().catch(undefined);

const rawAnswersSchema = z
  .object({
    intakeVersion: z.literal(2).optional().catch(undefined),
    ageYears: optionalNumber,
    ageStatus: optionalStatus,
    energyMethodPopulationCategory: z
      .enum(["MALE_ADULT", "FEMALE_ADULT", "PREGNANCY", "LACTATION", "NOT_LISTED"])
      .optional()
      .catch(undefined),
    energyMethodPopulationCategoryStatus: optionalStatus,
    physicalActivityCategory: z
      .enum(["INACTIVE", "LOW_ACTIVE", "ACTIVE", "VERY_ACTIVE"])
      .optional()
      .catch(undefined),
    physicalActivityCategoryStatus: optionalStatus,
    bodyMeasurementStatus: optionalStatus,
    heightCm: optionalNumber,
    weightKg: optionalNumber,
    weightMeasuredOn: optionalCalendarDateString,
    bodyWeightIntent: z
      .enum(["LOSE", "MAINTAIN", "GAIN", "NO_PREFERENCE"])
      .optional()
      .catch(undefined),
    goalPaceClass: z
      .enum(["MAINTAIN", "GRADUAL", "MODERATE", "UNDECIDED"])
      .optional()
      .catch(undefined),
    goalStatus: optionalStatus,
    resistanceTrainingContext: z
      .enum(["NONE", "OCCASIONAL", "REGULAR"])
      .optional()
      .catch(undefined),
    trainingContextStatus: optionalStatus,
    dietaryPattern: z
      .object({
        pattern: z
          .enum(["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN", "OTHER", "NONE_DECLARED"])
          .optional()
          .catch(undefined),
        reason: z
          .enum(["PREFERENCE", "RELIGIOUS_OR_ETHICAL", "MEDICAL_OR_CLINICIAN_DIRECTED", "NOT_STATED"])
          .optional()
          .catch(undefined),
        status: optionalStatus,
      })
      .optional()
      .catch(undefined),
  });

function statusConfirmed(status: FieldStatus | undefined): boolean {
  return status === "CONFIRMED";
}

export type BuildPrescriptionInputResult =
  | { ok: true; input: PrescriptionInput }
  | { ok: false; reasonCodes: PrescriptionReasonCode[] };

export function buildPrescriptionInput(
  rawAnswers: unknown,
  evaluatedOn: string
): BuildPrescriptionInputResult {
  if (typeof rawAnswers !== "object" || rawAnswers === null) {
    return { ok: false, reasonCodes: ["PRESCRIPTION_INTAKE_VERSION_UNSUPPORTED"] };
  }
  const parsed = rawAnswersSchema.safeParse(rawAnswers);
  if (!parsed.success || parsed.data.intakeVersion !== 2) {
    return { ok: false, reasonCodes: ["PRESCRIPTION_INTAKE_VERSION_UNSUPPORTED"] };
  }
  const data = parsed.data;

  const bodyMeasurementConfirmed = statusConfirmed(data.bodyMeasurementStatus);
  const goalConfirmed = statusConfirmed(data.goalStatus);
  const trainingConfirmed = statusConfirmed(data.trainingContextStatus);
  const dietaryConfirmed = statusConfirmed(data.dietaryPattern?.status);

  const input: PrescriptionInput = {
    intakeVersion: 2,
    ageYears:
      statusConfirmed(data.ageStatus) && typeof data.ageYears === "number" ? data.ageYears : null,
    energyMethodPopulationCategory: statusConfirmed(data.energyMethodPopulationCategoryStatus)
      ? (data.energyMethodPopulationCategory ?? null)
      : null,
    physicalActivityCategory: statusConfirmed(data.physicalActivityCategoryStatus)
      ? (data.physicalActivityCategory ?? null)
      : null,
    heightCm: bodyMeasurementConfirmed && typeof data.heightCm === "number" ? data.heightCm : null,
    weightKg: bodyMeasurementConfirmed && typeof data.weightKg === "number" ? data.weightKg : null,
    weightMeasuredOn:
      bodyMeasurementConfirmed && typeof data.weightMeasuredOn === "string"
        ? data.weightMeasuredOn
        : null,
    evaluatedOn,
    bodyWeightIntent: goalConfirmed ? (data.bodyWeightIntent ?? null) : null,
    goalPaceClass: goalConfirmed ? (data.goalPaceClass ?? null) : null,
    resistanceTrainingContext: trainingConfirmed ? (data.resistanceTrainingContext ?? null) : null,
    dietaryPattern: dietaryConfirmed ? (data.dietaryPattern?.pattern ?? null) : null,
    dietaryPatternReason: dietaryConfirmed ? (data.dietaryPattern?.reason ?? null) : null,
  };

  return { ok: true, input };
}
