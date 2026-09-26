import { intakeAnswersSchema, type FieldStatus } from "../intake-contract";
import type { PrescriptionInput, PrescriptionReasonCode } from "./types";

/**
 * T-2033 (T-2003 Amendment 1 §A1.4) — `buildPrescriptionInput` now parses
 * against the real, merged intake v2 *read* schema, `intakeAnswersSchema`
 * from `../intake-contract`, replacing T-2032's temporary local mirror of
 * the same frozen field names/enums/status rule. That mirror was legal only
 * until T-2024 merged (see the mirror's own header comment, since removed,
 * and board/reviews/T-2032-web-engineer-r1.md) — importing the real schema
 * here is exactly what closes the divergence risk the mirror could not
 * catch on its own; see `ai-coach-composer.test.ts`'s
 * "T-2024 divergence regression" test, which builds a `CONFIRM_INTAKE` v2
 * payload from `intakeV2ConfirmObjectSchema` (the real *write* schema) and
 * asserts every one of the nine engine inputs below round-trips through
 * this function.
 *
 * Deliberately `../intake-contract`, not `../intake`: `../intake.ts` is the
 * DB-touching half (`saveIntakeDraft`/`confirmIntake` import `@/lib/db`) and
 * re-exports `intake-contract.ts` verbatim only so existing server callers
 * keep working — importing it here would drag `@/lib/db` into this
 * module's transitive import graph and fail the "imports nothing from
 * @/lib/db" purity test that is walked from `lib/ai-coach/prescription/index.ts`
 * (`ai-coach-prescription.test.ts` "hard constraints"). `intake-contract.ts`
 * is the exact client-safe leaf module `lib/ai-coach/intake.ts`'s own header
 * comment describes as built for precisely this situation: a consumer that
 * needs the frozen v2 schema/enums without the DB import. The schema value
 * is identical either way (`intake.ts` does `export * from "./intake-contract"`),
 * so this is a purity-preserving import path, not a second definition.
 *
 * Every v2 field is optional on read (T-2002 decision summary): a status
 * other than `CONFIRMED` — or an absent/malformed value — always maps to
 * `null`, even if a value happens to be present in the raw payload (a
 * status/value disagreement can never produce a number). The engine reads
 * nothing else: no `goal`, no free text, no `dislikes`, no
 * `cuisinePreferences`, no allergen strings, no account `gender`.
 *
 * Per the frozen contract (board/tickets/T-2003.md "### Shared service"),
 * `buildPrescriptionInput` returns `ok:false` only for a non-v2 intake or
 * unparseable answers (`PRESCRIPTION_INTAKE_VERSION_UNSUPPORTED`) — the real
 * schema's own strictness (e.g. `weightMeasuredOn` rejects a calendar-invalid
 * or non-date string, `dietaryPattern` requires its full reviewed object
 * shape) is exactly the validation this function is specified to defer to,
 * rather than re-implementing a second, looser copy of it.
 */

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
  const parsed = intakeAnswersSchema.safeParse(rawAnswers);
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
