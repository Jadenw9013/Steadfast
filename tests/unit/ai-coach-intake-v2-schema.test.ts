import { describe, expect, it } from "vitest";
import {
  allergenDeclarationSchema,
  allergenDeclarationsSchema,
  dietaryPatternSchema,
  intakeAnswersSchema,
  intakeV2ConfirmSchema,
} from "@/lib/ai-coach/intake";

const v1Answers = {
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE"],
  dietaryRestrictions: [],
  allergies: [],
  foodBudgetLevel: "LOW",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
};

const v2Answers = {
  ...v1Answers,
  intakeVersion: 2,
  capturedAt: "2026-09-20T00:00:00.000Z",
  heightCm: 178,
  weightKg: 74,
  ageYears: 30,
  ageStatus: "CONFIRMED",
  energyMethodPopulationCategory: "MALE_ADULT",
  energyMethodPopulationCategoryStatus: "CONFIRMED",
  physicalActivityCategory: "ACTIVE",
  physicalActivityCategoryStatus: "CONFIRMED",
  bodyMeasurementStatus: "CONFIRMED",
  weightMeasuredOn: "2026-09-19",
  bodyWeightIntent: "MAINTAIN",
  goalPaceClass: "MAINTAIN",
  weightNeutralAccepted: true,
  goalStatus: "CONFIRMED",
  resistanceTrainingContext: "REGULAR",
  sessionLengthBand: "MIN_45_60",
  trainingContextStatus: "CONFIRMED",
  cookingAccess: {
    equipment: ["FULL_KITCHEN"],
    refrigeration: "FRIDGE_AND_FREEZER",
    mealPrepCapacity: "BATCH",
    typicalPrepMinutesBand: "MIN_15_30",
  },
  cookingAccessStatus: "CONFIRMED",
  dislikes: [{ label: "cilantro", canonicalFoodId: null }],
  cuisinePreferences: ["Thai"],
  allergenDeclarations: {
    status: "CONFIRMED",
    noKnownAllergens: true,
    items: [],
  },
  dietaryPattern: {
    pattern: "OMNIVORE",
    otherLabel: null,
    mandatory: false,
    reason: "PREFERENCE",
    status: "CONFIRMED",
  },
};

/** A complete v2 confirm payload with every status UNKNOWN and every
 * governed value absent — the "confirming with gaps is legal" path. */
const allUnknownConfirm = {
  intakeVersion: 2,
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE"],
  foodBudgetLevel: "LOW",
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
};

describe("T-2024 intakeAnswersSchema (read/compatibility schema)", () => {
  it("still parses a v1 payload with no v2 fields", () => {
    expect(intakeAnswersSchema.safeParse(v1Answers).success).toBe(true);
  });

  it("parses a full v2 payload", () => {
    expect(intakeAnswersSchema.safeParse(v2Answers).success).toBe(true);
  });

  it(".strict() still rejects an unknown key", () => {
    const result = intakeAnswersSchema.safeParse({ ...v1Answers, notARealField: true });
    expect(result.success).toBe(false);
  });
});

describe("T-2024 intakeV2ConfirmSchema status/value pairing", () => {
  function confirmPayload() {
    return JSON.parse(JSON.stringify(v2Answers));
  }

  it("rejects a payload missing allergenDeclarations", () => {
    const payload = confirmPayload();
    delete payload.allergenDeclarations;
    // v1-only keys are not part of the v2 confirm shape.
    delete payload.dietaryRestrictions;
    delete payload.allergies;
    delete payload.capturedAt;
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(false);
  });

  it("a full confirm payload (every status CONFIRMED with its value) parses", () => {
    const payload = confirmPayload();
    delete payload.dietaryRestrictions;
    delete payload.allergies;
    delete payload.capturedAt;
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
  });

  it("CONFIRMED without its value is an error", () => {
    const payload = confirmPayload();
    delete payload.dietaryRestrictions;
    delete payload.allergies;
    delete payload.capturedAt;
    delete payload.ageYears; // ageStatus stays CONFIRMED
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(false);
  });

  it("DECLINED with a value present is an error", () => {
    const payload = confirmPayload();
    delete payload.dietaryRestrictions;
    delete payload.allergies;
    delete payload.capturedAt;
    payload.ageStatus = "DECLINED"; // ageYears still present
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(false);
  });

  it("UNKNOWN without a value succeeds", () => {
    expect(intakeV2ConfirmSchema.safeParse(allUnknownConfirm).success).toBe(true);
  });

  it("confirming with every status UNKNOWN succeeds", () => {
    const result = intakeV2ConfirmSchema.safeParse(allUnknownConfirm);
    expect(result.success).toBe(true);
  });

  it("rejects a client-supplied capturedAt/allergies/dietaryRestrictions (server-derived/set only)", () => {
    const payload = confirmPayload();
    delete payload.dietaryRestrictions;
    delete payload.allergies;
    // capturedAt intentionally left in payload
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(false);

    const withAllergies = { ...payload };
    delete withAllergies.capturedAt;
    withAllergies.allergies = ["milk"];
    expect(intakeV2ConfirmSchema.safeParse(withAllergies).success).toBe(false);
  });
});

describe("T-2024 allergenDeclarationSchema refinements", () => {
  const base = {
    category: "OTHER" as const,
    specificity: "sunflower seed",
    kind: "ALLERGY" as const,
    crossContactAvoidanceRequired: "YES" as const,
  };

  it("OTHER without specificity is an error", () => {
    expect(allergenDeclarationSchema.safeParse({ ...base, specificity: null }).success).toBe(false);
  });

  it("MILK with a specificity is an error", () => {
    expect(
      allergenDeclarationSchema.safeParse({ ...base, category: "MILK", specificity: "2%" }).success
    ).toBe(false);
  });

  it("TREE_NUT with specificity: null is ok (whole category excluded)", () => {
    expect(
      allergenDeclarationSchema.safeParse({ ...base, category: "TREE_NUT", specificity: null }).success
    ).toBe(true);
  });
});

describe("T-2024 allergenDeclarationsSchema status pairing", () => {
  it("CONFIRMED with noKnownAllergens: true AND non-empty items is an error", () => {
    const result = allergenDeclarationsSchema.safeParse({
      status: "CONFIRMED",
      noKnownAllergens: true,
      items: [
        {
          category: "MILK",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("CONFIRMED with noKnownAllergens: false and one item is ok", () => {
    const result = allergenDeclarationsSchema.safeParse({
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        {
          category: "MILK",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("T-2024 dietaryPatternSchema OTHER/otherLabel pairing", () => {
  const base = {
    pattern: "OTHER" as const,
    otherLabel: "carnivore",
    mandatory: false,
    reason: "PREFERENCE" as const,
    status: "CONFIRMED" as const,
  };

  it("OTHER without otherLabel is an error", () => {
    expect(dietaryPatternSchema.safeParse({ ...base, otherLabel: null }).success).toBe(false);
  });

  it("non-OTHER with an otherLabel present is an error", () => {
    expect(
      dietaryPatternSchema.safeParse({ ...base, pattern: "OMNIVORE", otherLabel: "carnivore" }).success
    ).toBe(false);
  });

  it("OTHER with otherLabel present is ok", () => {
    expect(dietaryPatternSchema.safeParse(base).success).toBe(true);
  });
});
