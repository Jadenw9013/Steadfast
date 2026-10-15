import { describe, expect, it } from "vitest";
import {
  buildAllergenDeclarations,
  buildConfirmPayload,
  createIntakeSelections,
  mapSelectionsToAnswers,
  type IntakeSelections,
} from "@/components/ai-coach/intake-wizard";
import { intakeV2ConfirmSchema } from "@/lib/ai-coach/intake-contract";

function completeSelections(patch: Partial<IntakeSelections> = {}): IntakeSelections {
  return {
    goal: "FAT_LOSS",
    experience: "INTERMEDIATE",
    trainingDaysPerWeek: 4,
    equipment: "HOME_DUMBBELLS",
    sessionLength: "MIN_45_60",
    dietaryStyle: "HIGH_PROTEIN",
    trackingStyle: "PORTIONS",
    foodBudgetLevel: "MODERATE",
    allergens: ["NONE"],
    unitSystem: "IMPERIAL",
    heightCm: 175.3,
    weightKg: 78.25,
    ageYears: 34,
    weightMeasuredOn: "2026-09-27",
    ...patch,
  };
}

describe("T-2028 intuitive choices map into the frozen v2 confirm contract", () => {
  it("builds a schema-valid payload without inventing answers for unasked clinical groups", () => {
    const payload = buildConfirmPayload(completeSelections());

    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      intakeVersion: 2,
      goal: "BODY_COMPOSITION",
      experienceLevel: "RETURNING",
      trainingDaysPerWeek: 4,
      equipmentAccess: ["HOME_BASIC"],
      foodBudgetLevel: "MODERATE",
      trackingPreference: "PORTIONS_ONLY",
      unitsPreference: "IMPERIAL",
      ageStatus: "CONFIRMED",
      bodyMeasurementStatus: "CONFIRMED",
      energyMethodPopulationCategoryStatus: "UNKNOWN",
      physicalActivityCategoryStatus: "UNKNOWN",
      goalStatus: "CONFIRMED",
      bodyWeightIntent: "LOSE",
      goalPaceClass: "UNDECIDED",
      weightNeutralAccepted: false,
      cookingAccessStatus: "UNKNOWN",
      trainingContextStatus: "CONFIRMED",
      resistanceTrainingContext: "OCCASIONAL",
      sessionLengthBand: "MIN_45_60",
      dietaryPattern: {
        pattern: "OTHER",
        otherLabel: "High protein",
        mandatory: false,
        reason: "PREFERENCE",
        status: "CONFIRMED",
      },
      allergenDeclarations: {
        status: "CONFIRMED",
        noKnownAllergens: true,
        items: [],
      },
      dislikes: [],
      cuisinePreferences: [],
    });
    expect(payload).not.toHaveProperty("energyMethodPopulationCategory");
    expect(payload).not.toHaveProperty("physicalActivityCategory");
    expect(payload).not.toHaveProperty("cookingAccess");
  });

  it("does not silently default the food budget", () => {
    const selections = completeSelections({ foodBudgetLevel: undefined });
    const payload = mapSelectionsToAnswers(selections);
    expect(payload).not.toHaveProperty("foodBudgetLevel");
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(false);
    expect(() => buildConfirmPayload(selections)).toThrow();
  });

  it.each([
    ["FAT_LOSS", "BODY_COMPOSITION"],
    ["BUILD_MUSCLE", "BODY_COMPOSITION"],
    ["STRENGTH", "STRENGTH"],
    ["GENERAL_FITNESS", "GENERAL_FITNESS"],
  ] as const)("maps goal %s to %s", (goal, expected) => {
    const payload = buildConfirmPayload(completeSelections({ goal }));
    expect(payload.goal).toBe(expected);
    if (goal === "FAT_LOSS") expect(payload.bodyWeightIntent).toBe("LOSE");
    if (goal === "BUILD_MUSCLE") expect(payload.bodyWeightIntent).toBe("GAIN");
    if (goal === "STRENGTH" || goal === "GENERAL_FITNESS") {
      expect(payload.goalStatus).toBe("UNKNOWN");
      expect(payload).not.toHaveProperty("bodyWeightIntent");
    }
  });

  it.each([
    ["BEGINNER", "NEW", "NONE"],
    ["INTERMEDIATE", "RETURNING", "OCCASIONAL"],
    ["ADVANCED", "EXPERIENCED", "REGULAR"],
  ] as const)(
    "maps experience %s without inventing a clinical category",
    (experience, level, context) => {
      const payload = buildConfirmPayload(completeSelections({ experience }));
      expect(payload.experienceLevel).toBe(level);
      expect(payload.resistanceTrainingContext).toBe(context);
    }
  );

  it("maps quick allergen tags conservatively and keeps gluten broader than wheat", () => {
    const declarations = buildAllergenDeclarations(
      completeSelections({ allergens: ["DAIRY", "TREE_NUTS", "PEANUTS", "GLUTEN", "SHELLFISH"] })
    );

    expect(declarations.status).toBe("CONFIRMED");
    expect(declarations.noKnownAllergens).toBe(false);
    expect(declarations.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "MILK", specificity: null }),
        expect.objectContaining({ category: "TREE_NUT", specificity: null }),
        expect.objectContaining({ category: "PEANUT", specificity: null }),
        expect.objectContaining({ category: "OTHER", specificity: "gluten" }),
        expect.objectContaining({ category: "CRUSTACEAN_SHELLFISH", specificity: null }),
      ])
    );
    expect(
      declarations.items.every((item) => item.crossContactAvoidanceRequired === "UNSURE")
    ).toBe(true);
  });

  it("does not silently re-assert hidden legacy allergen detail", () => {
    const selections = createIntakeSelections({
      allergenDeclarations: {
        status: "CONFIRMED",
        noKnownAllergens: false,
        items: [
          {
            category: "FISH",
            specificity: "salmon",
            kind: "ALLERGY",
            crossContactAvoidanceRequired: "YES",
          },
        ],
      },
    });

    expect(selections.allergens).toEqual([]);
    selections.allergens = ["DAIRY"];
    expect(buildAllergenDeclarations(selections).items).toEqual([
      expect.objectContaining({ category: "MILK", specificity: null }),
    ]);
  });

  it("does not silently loosen a mandatory legacy dietary pattern", () => {
    const selections = createIntakeSelections({
      dietaryPattern: {
        pattern: "VEGAN",
        otherLabel: null,
        mandatory: true,
        reason: "RELIGIOUS_OR_ETHICAL",
        status: "CONFIRMED",
      },
    });

    expect(selections.dietaryStyle).toBeUndefined();
  });

  it("never leaks server-owned compatibility keys into CONFIRM_INTAKE", () => {
    const selections = createIntakeSelections({
      goal: "GENERAL_FITNESS",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      foodBudgetLevel: "LOW",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
      allergies: ["peanuts"],
      dietaryRestrictions: ["vegetarian"],
      capturedAt: "2020-01-01T00:00:00.000Z",
    });
    const payload = buildConfirmPayload({
      ...completeSelections(),
      ...selections,
      dietaryStyle: "BALANCED",
      trackingStyle: "EXACT_MACROS",
      allergens: ["NONE"],
      heightCm: 175,
      weightKg: 75,
      ageYears: 30,
    });

    expect(payload).not.toHaveProperty("allergies");
    expect(payload).not.toHaveProperty("dietaryRestrictions");
    expect(payload).not.toHaveProperty("capturedAt");
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
  });
});
