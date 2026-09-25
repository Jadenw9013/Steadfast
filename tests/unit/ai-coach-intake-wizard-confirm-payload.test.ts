import { describe, expect, it } from "vitest";
import { buildConfirmPayload, defaultAnswers, pruneUnconfirmed } from "@/components/ai-coach/intake-wizard";
import { intakeV2ConfirmSchema } from "@/lib/ai-coach/intake";

/**
 * T-2024 review round 1, BLOCKER 2 — the confirm payload must never carry
 * the three server-owned keys (`allergies`, `dietaryRestrictions`,
 * `capturedAt`), which hydration legitimately picks up from either a v1
 * `confirmedIntake` (both keys are required v1 fields) or a draft the
 * `ALLERGIES` v2 command wrote (`allergies` is the derived projection).
 * `intakeV2ConfirmSchema` is `.strict()` and rejects all three outright, so
 * either path used to be a permanent 422 with no way to recover from the
 * wizard.
 */

const v1ConfirmedIntake = {
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE"],
  allergies: ["peanuts"],
  dietaryRestrictions: ["vegetarian"],
  foodBudgetLevel: "LOW",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
};

function confirmPayloadFrom(confirmedIntake: unknown, draft: unknown = null) {
  const merged = defaultAnswers({
    ...((confirmedIntake as Record<string, unknown>) ?? {}),
    ...((draft as Record<string, unknown>) ?? {}),
  });
  return buildConfirmPayload(pruneUnconfirmed({ ...merged, intakeVersion: 2 }));
}

describe("T-2024 intake wizard confirm payload never leaks server-owned keys", () => {
  it("a v1-shaped confirmedIntake (allergies + dietaryRestrictions required v1 fields) never reaches the confirm payload", () => {
    const payload = confirmPayloadFrom(v1ConfirmedIntake);
    expect(payload).not.toHaveProperty("allergies");
    expect(payload).not.toHaveProperty("dietaryRestrictions");
    expect(payload).not.toHaveProperty("capturedAt");
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
  });

  it("a draft carrying the ALLERGIES v2 command's derived `allergies` array never reaches the confirm payload", () => {
    const draftAfterAllergiesCommand = {
      intakeVersion: 2,
      allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: false, items: [] },
      allergies: ["TREE_NUT"], // deriveLegacyAllergyTokens output, written into the draft
    };
    const payload = confirmPayloadFrom(v1ConfirmedIntake, draftAfterAllergiesCommand);
    expect(payload).not.toHaveProperty("allergies");
    expect(payload).not.toHaveProperty("dietaryRestrictions");
    expect(payload).not.toHaveProperty("capturedAt");
  });

  it("a client-set capturedAt in local state is stripped rather than forwarded", () => {
    const payload = confirmPayloadFrom({ ...v1ConfirmedIntake, capturedAt: "2020-01-01T00:00:00.000Z" });
    expect(payload).not.toHaveProperty("capturedAt");
  });

  it("every required v2 confirm key is still present with gaps left legal (UNKNOWN defaults)", () => {
    const payload = confirmPayloadFrom(null);
    expect(payload).toMatchObject({
      intakeVersion: 2,
      ageStatus: "UNKNOWN",
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
      dietaryPattern: { pattern: "NONE_DECLARED", status: "UNKNOWN" },
      dislikes: [],
      cuisinePreferences: [],
    });
  });
});
