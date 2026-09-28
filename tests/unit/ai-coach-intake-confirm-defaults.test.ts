/**
 * S-16 — the confirm boundary fills the seven bookkeeping statuses a caller
 * left out, restrictively, and touches nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  applyIntakeV2ConfirmDefaults,
  intakeV2ConfirmObjectSchema,
  intakeV2ConfirmSchema,
  INTAKE_V2_STATUS_DEFAULTS,
} from "@/lib/ai-coach/intake-contract";

const STATUS_KEYS = Object.keys(INTAKE_V2_STATUS_DEFAULTS);

/** Everything the frozen contract requires *except* the seven statuses. */
function payloadWithoutStatuses(overrides: Record<string, unknown> = {}) {
  return {
    intakeVersion: 2,
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    foodBudgetLevel: "MODERATE",
    trackingPreference: "PORTIONS_ONLY",
    unitsPreference: "METRIC",
    dislikes: [],
    cuisinePreferences: [],
    allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: true, items: [] },
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

describe("S-16 — bookkeeping status defaults at the confirm boundary", () => {
  it("covers exactly the seven status fields the contract requires", () => {
    expect(STATUS_KEYS.sort()).toEqual(
      [
        "ageStatus",
        "bodyMeasurementStatus",
        "cookingAccessStatus",
        "energyMethodPopulationCategoryStatus",
        "goalStatus",
        "physicalActivityCategoryStatus",
        "trainingContextStatus",
      ].sort()
    );
    for (const key of STATUS_KEYS) expect(intakeV2ConfirmObjectSchema.shape).toHaveProperty(key);
  });

  it("defaults every one of them to the most restrictive value, never the most permissive", () => {
    for (const value of Object.values(INTAKE_V2_STATUS_DEFAULTS)) {
      expect(value).toBe("UNKNOWN");
      // CONFIRMED is the permissive one: it is the only status that lets the
      // value it governs reach the prescription.
      expect(value).not.toBe("CONFIRMED");
    }
  });

  it("turns a payload missing all seven into a clean confirm", () => {
    const raw = payloadWithoutStatuses();
    expect(intakeV2ConfirmSchema.safeParse(raw).success).toBe(false);

    const filled = intakeV2ConfirmSchema.safeParse(applyIntakeV2ConfirmDefaults(raw));
    expect(filled.success).toBe(true);
    expect(filled.success && filled.data.ageStatus).toBe("UNKNOWN");
    expect(filled.success && filled.data.goalStatus).toBe("UNKNOWN");
    expect(filled.success && filled.data.cookingAccessStatus).toBe("UNKNOWN");
  });

  it("never overwrites a status the client actually answered", () => {
    const answered = payloadWithoutStatuses({
      ageStatus: "CONFIRMED",
      ageYears: 34,
      goalStatus: "DECLINED",
    });
    const filled = applyIntakeV2ConfirmDefaults(answered) as Record<string, unknown>;
    expect(filled.ageStatus).toBe("CONFIRMED");
    expect(filled.ageYears).toBe(34);
    expect(filled.goalStatus).toBe("DECLINED");
    // and the rest are filled
    expect(filled.cookingAccessStatus).toBe("UNKNOWN");
    expect(intakeV2ConfirmSchema.safeParse(filled).success).toBe(true);
  });

  it("treats an explicit null as absent (JSON has no undefined) and fills it", () => {
    const filled = applyIntakeV2ConfirmDefaults(
      payloadWithoutStatuses({ ageStatus: null })
    ) as Record<string, unknown>;
    expect(filled.ageStatus).toBe("UNKNOWN");
  });

  it("never infers CONFIRMED from a governed value, and fails closed instead", () => {
    // A caller that sends a measurement but no status does NOT get a
    // manufactured confirmation — it gets UNKNOWN and a clean rejection.
    const raw = payloadWithoutStatuses({
      heightCm: 180,
      weightKg: 80,
      weightMeasuredOn: "2026-09-27",
    });
    const filled = applyIntakeV2ConfirmDefaults(raw) as Record<string, unknown>;
    expect(filled.bodyMeasurementStatus).toBe("UNKNOWN");
    const parsed = intakeV2ConfirmSchema.safeParse(filled);
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(["heightCm", "weightKg", "weightMeasuredOn"])
    );
  });

  it("adds no key beyond the seven, and is a no-op on an already-complete payload", () => {
    const complete = payloadWithoutStatuses(
      Object.fromEntries(STATUS_KEYS.map((key) => [key, "UNKNOWN"]))
    );
    expect(applyIntakeV2ConfirmDefaults(complete)).toEqual(complete);

    const sparse = payloadWithoutStatuses();
    const filled = applyIntakeV2ConfirmDefaults(sparse) as Record<string, unknown>;
    expect(Object.keys(filled).sort()).toEqual([...Object.keys(sparse), ...STATUS_KEYS].sort());
  });

  it("does not default a clinical or safety-relevant field", () => {
    for (const key of ["allergenDeclarations", "dietaryPattern", "dislikes", "cuisinePreferences"]) {
      expect(STATUS_KEYS).not.toContain(key);
    }
    const missingAllergens = { ...payloadWithoutStatuses() } as Record<string, unknown>;
    delete missingAllergens.allergenDeclarations;
    const filled = applyIntakeV2ConfirmDefaults(missingAllergens) as Record<string, unknown>;
    expect(filled).not.toHaveProperty("allergenDeclarations");
    expect(intakeV2ConfirmSchema.safeParse(filled).success).toBe(false);
  });

  it("passes a non-object through untouched", () => {
    expect(applyIntakeV2ConfirmDefaults(null)).toBeNull();
    expect(applyIntakeV2ConfirmDefaults("nope")).toBe("nope");
    expect(applyIntakeV2ConfirmDefaults([1, 2])).toEqual([1, 2]);
  });
});
