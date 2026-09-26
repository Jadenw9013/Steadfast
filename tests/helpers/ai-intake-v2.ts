/**
 * T-2033 — a well-formed, read-schema-valid v2 confirmed-intake fixture.
 *
 * Shaped like what `confirmIntake()` actually persists to
 * `AiCoachProfile.confirmedIntake` for a v2 confirm: every `intakeV2ConfirmSchema`
 * (write schema) field, plus the two array fields the server derives and adds
 * before storing (`allergies`, `dietaryRestrictions` — see
 * `lib/ai-coach/intake.ts`'s `confirmIntake`). `intakeAnswersSchema` (the read
 * schema `buildPrescriptionInput` parses against) requires those two v1
 * fields, so a caller building a fixture to feed `buildPrescriptionInput` (or
 * anything else that re-parses a stored intake) directly — without going
 * through `confirmIntake()` itself — needs them present too.
 *
 * Every status defaults to `"UNKNOWN"` (nothing confirmed) so a test overrides
 * only the specific fields/statuses it cares about, mirroring
 * `tests/integration/ai-coach-client-commands.test.ts`'s own `v2Answers()`
 * helper (kept in sync by hand; both build the same shape for different test
 * layers — one calls `confirmIntake`, this one is read-schema-valid directly).
 */
export function buildV2Answers(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intakeVersion: 2,
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    dietaryRestrictions: [],
    allergies: [],
    foodBudgetLevel: "MODERATE",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    ageStatus: "UNKNOWN",
    energyMethodPopulationCategoryStatus: "UNKNOWN",
    physicalActivityCategoryStatus: "UNKNOWN",
    bodyMeasurementStatus: "UNKNOWN",
    goalStatus: "UNKNOWN",
    trainingContextStatus: "UNKNOWN",
    cookingAccessStatus: "UNKNOWN",
    dislikes: [],
    cuisinePreferences: [],
    allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    dietaryPattern: {
      pattern: "NONE_DECLARED",
      otherLabel: null,
      mandatory: false,
      reason: "NOT_STATED",
      status: "UNKNOWN",
    },
    ...overrides,
  };
}
