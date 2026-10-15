import { describe, expect, it } from "vitest";
import {
  buildAllergenDeclarations,
  buildConfirmPayload as buildConfirmPayloadUnpinned,
  createIntakeSelections,
  describeAllergenItem,
  intakeStepIssues,
  mandatoryPatternForLegacyRestriction,
  mapSelectionsToAnswers,
  type IntakeSelections,
} from "@/components/ai-coach/intake-wizard";
import { intakeDraftSchema, intakeV2ConfirmSchema } from "@/lib/ai-coach/intake-contract";
import {
  canonicalDeclarations,
  deriveLegacyAllergyTokens,
  deriveLegacyDietaryRestrictions,
} from "@/lib/ai-coach/intake-allergens";
import { contentHash } from "@/lib/ai-coach/canonical-json";

/**
 * T-2055: population and activity are never asked (G01 wording pending), so
 * every confirm payload built in this file is pinned to both statuses UNKNOWN
 * with neither value present.
 */
function buildConfirmPayload(selections: IntakeSelections) {
  const payload = buildConfirmPayloadUnpinned(selections);
  expect(payload.energyMethodPopulationCategoryStatus).toBe("UNKNOWN");
  expect(payload.physicalActivityCategoryStatus).toBe("UNKNOWN");
  expect(payload).not.toHaveProperty("energyMethodPopulationCategory");
  expect(payload).not.toHaveProperty("physicalActivityCategory");
  return payload;
}

function completeSelections(patch: Partial<IntakeSelections> = {}): IntakeSelections {
  return {
    goal: "FAT_LOSS",
    // T-2055: an explicit "Undecided" answer, so UNDECIDED below still means
    // the client chose it rather than a default.
    goalPace: "UNDECIDED",
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

/** Stored-state fields from `createIntakeSelections`, minus the unanswered (undefined) ones. */
function stored(selections: IntakeSelections): Partial<IntakeSelections> {
  return Object.fromEntries(
    Object.entries(selections).filter(([, value]) => value !== undefined)
  ) as Partial<IntakeSelections>;
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
      // T-2028 r2 finding 2: no current-training answer was given, so the
      // jointly governed pair stays UNKNOWN and both values stay absent.
      trainingContextStatus: "UNKNOWN",
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
    expect(payload).not.toHaveProperty("resistanceTrainingContext");
    expect(payload).not.toHaveProperty("sessionLengthBand");
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
    ["BEGINNER", "NEW"],
    ["INTERMEDIATE", "RETURNING"],
    ["ADVANCED", "EXPERIENCED"],
  ] as const)(
    "maps experience %s without inventing a current-training context (r2 finding 2)",
    (experience, level) => {
      const payload = buildConfirmPayload(completeSelections({ experience }));
      expect(payload.experienceLevel).toBe(level);
      expect(payload.trainingContextStatus).toBe("UNKNOWN");
      expect(payload).not.toHaveProperty("resistanceTrainingContext");
      expect(payload).not.toHaveProperty("sessionLengthBand");
    }
  );

  it("keeps a previously confirmed current-training answer and pairs it with the chosen session length", () => {
    const selections = createIntakeSelections({
      trainingContextStatus: "CONFIRMED",
      resistanceTrainingContext: "REGULAR",
      sessionLengthBand: "MIN_30_45",
    });
    const payload = buildConfirmPayload(
      completeSelections({
        currentTraining: selections.currentTraining,
        sessionLength: "MIN_60_PLUS",
      })
    );
    expect(payload).toMatchObject({
      trainingContextStatus: "CONFIRMED",
      resistanceTrainingContext: "REGULAR",
      sessionLengthBand: "MIN_60_90",
    });
  });

  it("saves the chosen session length to the draft so step 2 resumes, without claiming a context", () => {
    const answers = mapSelectionsToAnswers(completeSelections());
    expect(answers.sessionLengthBand).toBe("MIN_45_60");
    expect(answers.trainingContextStatus).toBe("UNKNOWN");
    expect(answers).not.toHaveProperty("resistanceTrainingContext");
    expect(intakeDraftSchema.safeParse(answers).success).toBe(true);
  });

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

  it("r2 finding 1: keeps a stored allergen no chip can show when the client adds a chip", () => {
    const fish = {
      category: "FISH",
      specificity: "salmon",
      kind: "ALLERGY",
      crossContactAvoidanceRequired: "YES",
    } as const;
    const selections = createIntakeSelections({
      allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: false, items: [fish] },
    });

    // Nothing is pre-selected, but the item is retained for read-only display.
    expect(selections.allergens).toEqual([]);
    expect(selections.retainedAllergenItems).toEqual([fish]);
    expect(describeAllergenItem(selections.retainedAllergenItems![0])).toBe("Fish (salmon)");

    selections.allergens = ["DAIRY"];
    const declarations = buildAllergenDeclarations(selections);
    expect(declarations.items).toEqual([
      fish,
      expect.objectContaining({ category: "MILK", specificity: null }),
    ]);
    // ...and it reaches CONFIRM_INTAKE unchanged.
    expect(
      buildConfirmPayload(completeSelections(stored(selections))).allergenDeclarations
    ).toEqual(declarations);
  });

  it("r2 finding 1: an untouched pass re-sends exactly the stored declarations (server hash equal, so no pause)", () => {
    const onFile = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        {
          category: "EGG",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
        {
          category: "FISH",
          specificity: "salmon",
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
        {
          category: "SOYBEAN",
          specificity: null,
          kind: "INTOLERANCE_OR_SENSITIVITY",
          crossContactAvoidanceRequired: "NO",
        },
        {
          category: "WHEAT",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "UNSURE",
        },
        {
          category: "SESAME",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
        {
          category: "OTHER",
          specificity: "kiwi",
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "NO",
        },
        {
          category: "TREE_NUT",
          specificity: "cashew",
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
        {
          category: "MILK",
          specificity: null,
          kind: "INTOLERANCE_OR_SENSITIVITY",
          crossContactAvoidanceRequired: "NO",
        },
        {
          category: "OTHER",
          specificity: "gluten",
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
      ],
    } as const;
    const selections = createIntakeSelections({ allergenDeclarations: onFile });
    expect(selections.allergens.sort()).toEqual(["DAIRY", "GLUTEN", "TREE_NUTS"]);

    const rebuilt = buildAllergenDeclarations(selections);
    expect(contentHash(canonicalDeclarations(rebuilt))).toBe(
      contentHash(canonicalDeclarations(onFile))
    );
  });

  it("r2 finding 1: dropping a stored item takes an explicit Remove, and None cannot erase it", () => {
    const egg = {
      category: "EGG",
      specificity: null,
      kind: "ALLERGY",
      crossContactAvoidanceRequired: "YES",
    } as const;
    const selections = createIntakeSelections({
      allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: false, items: [egg] },
    });

    // An empty chip row is not "no allergens" while an item is on file.
    expect(
      intakeStepIssues(2, completeSelections({ ...stored(selections), allergens: [] }), {}, false)
    ).toEqual([]);
    expect(buildAllergenDeclarations({ ...selections, allergens: [] }).items).toEqual([egg]);

    // None alongside an item on file is refused, and the builder fails closed.
    const withNone = completeSelections({ ...stored(selections), allergens: ["NONE"] });
    expect(intakeStepIssues(2, withNone, {}, false)).toContain(
      "Remove the other allergens on file before choosing None."
    );
    expect(buildAllergenDeclarations(withNone)).toEqual({
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [egg],
    });

    // Explicit removal, then None, is a real declaration of no allergens.
    const removed = completeSelections({
      ...stored(selections),
      retainedAllergenItems: [],
      allergens: ["NONE"],
    });
    expect(intakeStepIssues(2, removed, {}, false)).toEqual([]);
    expect(buildAllergenDeclarations(removed)).toEqual({
      status: "CONFIRMED",
      noKnownAllergens: true,
      items: [],
    });
  });

  it("r2 finding 1: keeps a stored mandatory dietary pattern verbatim instead of a chip preference", () => {
    const vegan = {
      pattern: "VEGAN",
      otherLabel: null,
      mandatory: true,
      reason: "RELIGIOUS_OR_ETHICAL",
      status: "CONFIRMED",
    } as const;
    const selections = createIntakeSelections({ dietaryPattern: vegan });

    expect(selections.dietaryStyle).toBeUndefined();
    expect(selections.retainedDietaryPattern).toEqual(vegan);
    const merged = completeSelections({
      ...stored(selections),
      dietaryStyle: undefined,
      allergens: ["NONE"],
    });
    expect(intakeStepIssues(2, merged, {}, false)).toEqual([]);
    expect(buildConfirmPayload(merged).dietaryPattern).toEqual(vegan);

    // A mandatory pattern this flow's own labels could describe is still not downgraded.
    const plantBased = {
      ...vegan,
      pattern: "OTHER",
      otherLabel: "Plant-based",
      reason: "MEDICAL_OR_CLINICIAN_DIRECTED",
    } as const;
    const fromOther = createIntakeSelections({ dietaryPattern: plantBased });
    expect(fromOther.dietaryStyle).toBeUndefined();
    expect(
      buildConfirmPayload(
        completeSelections({ ...stored(fromOther), dietaryStyle: undefined, allergens: ["NONE"] })
      ).dietaryPattern
    ).toEqual(plantBased);
  });

  it("r2 MINOR 8b: carries stored dislikes and cuisine preferences instead of wiping them", () => {
    const selections = createIntakeSelections({
      dislikes: [{ label: "cilantro", canonicalFoodId: null }],
      cuisinePreferences: ["Thai"],
    });
    const answers = mapSelectionsToAnswers(
      completeSelections({ ...stored(selections), allergens: ["NONE"] })
    );
    expect(answers.dislikes).toEqual([{ label: "cilantro", canonicalFoodId: null }]);
    expect(answers.cuisinePreferences).toEqual(["Thai"]);
    expect(
      buildConfirmPayload(completeSelections({ ...stored(selections), allergens: ["NONE"] }))
        .dislikes
    ).toEqual([{ label: "cilantro", canonicalFoodId: null }]);
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

describe("T-2028 r3 lead decision A — current-training question on step 2", () => {
  it.each(["NONE", "OCCASIONAL", "REGULAR"] as const)(
    "an answered %s makes the jointly governed pair CONFIRMED with the chosen session length",
    (currentTraining) => {
      const payload = buildConfirmPayload(completeSelections({ currentTraining }));
      expect(payload).toMatchObject({
        trainingContextStatus: "CONFIRMED",
        resistanceTrainingContext: currentTraining,
        sessionLengthBand: "MIN_45_60",
      });
      expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
    }
  );

  it("is required on step 2 and never inferred from the experience pill", () => {
    expect(intakeStepIssues(1, completeSelections(), {}, false)).toEqual([
      "Choose your current strength training.",
    ]);
    expect(intakeStepIssues(1, completeSelections({ currentTraining: "NONE" }), {}, false)).toEqual(
      []
    );
    for (const experience of ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const)
      expect(buildConfirmPayload(completeSelections({ experience })).trainingContextStatus).toBe(
        "UNKNOWN"
      );
  });

  it("seeds only a stored CONFIRMED answer", () => {
    expect(
      createIntakeSelections({ trainingContextStatus: "CONFIRMED", resistanceTrainingContext: "NONE" })
        .currentTraining
    ).toBe("NONE");
    expect(
      createIntakeSelections({ trainingContextStatus: "UNKNOWN", resistanceTrainingContext: "NONE" })
        .currentTraining
    ).toBeUndefined();
  });
});

describe("T-2028 r3 lead decision B — v1-shaped intakes keep what the wizard cannot ask", () => {
  const v1Seed = {
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    allergies: ["kiwi", "peanut", "Gluten", "kiwi"],
    dietaryRestrictions: ["vegan", "halal"],
  };

  it("carries every v1 allergy token as OTHER whose specificity is the identical token", () => {
    const selections = createIntakeSelections(v1Seed);
    // "Gluten" is the Gluten chip's own OTHER item, so it shows as that chip.
    expect(selections.allergens).toEqual(["GLUTEN"]);
    expect(selections.retainedAllergenItems).toEqual([
      { category: "OTHER", specificity: "kiwi", kind: "ALLERGY", crossContactAvoidanceRequired: "UNSURE" },
      { category: "OTHER", specificity: "peanut", kind: "ALLERGY", crossContactAvoidanceRequired: "UNSURE" },
    ]);
    expect(selections.unsavableLegacyAllergies).toEqual([]);

    const declarations = buildAllergenDeclarations(selections);
    // The legacy exclusion list the server derives is the identical v1 token set.
    expect(deriveLegacyAllergyTokens(declarations)).toEqual(
      [...new Set(v1Seed.allergies)].sort()
    );
  });

  it("does not let None or an untouched pass drop a v1 allergy", () => {
    const selections = createIntakeSelections(v1Seed);
    const withNone = completeSelections({
      ...stored(selections),
      legacyDietaryRestrictions: [],
      allergens: ["NONE"],
    });
    expect(intakeStepIssues(2, withNone, {}, false)).toContain(
      "Remove the other allergens on file before choosing None."
    );
    expect(deriveLegacyAllergyTokens(buildAllergenDeclarations(withNone))).toEqual([
      "kiwi",
      "peanut",
    ]);
  });

  it("holds a v1 token the contract cannot store verbatim apart, and blocks step 3 until it is removed", () => {
    const tooLong = "x".repeat(81);
    const selections = createIntakeSelections({
      ...v1Seed,
      allergies: ["kiwi", " padded ", tooLong, ""],
      dietaryRestrictions: [],
    });
    expect(selections.unsavableLegacyAllergies).toEqual([" padded ", tooLong, ""]);
    expect(deriveLegacyAllergyTokens(buildAllergenDeclarations(selections))).toEqual(["kiwi"]);
    const merged = completeSelections({ ...stored(selections), allergens: [] });
    expect(intakeStepIssues(2, merged, {}, false)).toEqual([
      "Remove each earlier allergy entry that cannot be saved as written.",
    ]);
    expect(
      intakeStepIssues(2, { ...merged, unsavableLegacyAllergies: [] }, {}, false)
    ).toEqual([]);
  });

  it("never re-reads the derived allergies projection on a v2 row", () => {
    const selections = createIntakeSelections({
      allergies: ["UNVERIFIABLE_ALLERGEN_STATUS_NOT_CONFIRMED"],
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
      dietaryRestrictions: ["VEGAN"],
      dietaryPattern: {
        pattern: "NONE_DECLARED",
        otherLabel: null,
        mandatory: false,
        reason: "NOT_STATED",
        status: "UNKNOWN",
      },
    });
    expect(selections.retainedAllergenItems).toEqual([]);
    expect(selections.unsavableLegacyAllergies).toEqual([]);
    expect(selections.legacyDietaryRestrictions).toEqual([]);
  });

  it("shows v1 dietary restrictions until each is kept or removed, never defaulting one away", () => {
    const selections = createIntakeSelections(v1Seed);
    expect(selections.legacyDietaryRestrictions).toEqual(["vegan", "halal"]);
    expect(selections.retainedDietaryPattern).toBeUndefined();

    const untouched = completeSelections({ ...stored(selections), allergens: ["GLUTEN"] });
    expect(intakeStepIssues(2, untouched, {}, false)).toEqual([
      "Keep or remove each dietary restriction from your earlier answers.",
    ]);

    // Keep "vegan" as a requirement, remove "halal": both explicit.
    const kept = mandatoryPatternForLegacyRestriction("vegan");
    const resolved = completeSelections({
      ...stored(selections),
      allergens: ["GLUTEN"],
      dietaryStyle: undefined,
      retainedDietaryPattern: kept,
      legacyDietaryRestrictions: [],
    });
    expect(intakeStepIssues(2, resolved, {}, false)).toEqual([]);
    const payload = buildConfirmPayload(resolved);
    expect(payload.dietaryPattern).toEqual({
      pattern: "VEGAN",
      otherLabel: null,
      mandatory: true,
      reason: "NOT_STATED",
      status: "CONFIRMED",
    });
    expect(deriveLegacyAllergyTokens(payload.allergenDeclarations)).toEqual([
      "Gluten",
      "kiwi",
      "peanut",
    ]);
  });

  it.each([
    ["vegan", "VEGAN"],
    ["Vegan", "VEGAN"],
    ["vegetarian", "VEGETARIAN"],
    [" Vegetarian ", "VEGETARIAN"],
  ])(
    "keeping v1 restriction %j re-derives the same enforced legacy tag %s",
    (token, tag) => {
      const pattern = mandatoryPatternForLegacyRestriction(token);
      expect(pattern?.mandatory).toBe(true);
      // Same normalization the composer applies to the v1 token (composition-feasibility.ts).
      expect(token.trim().toUpperCase().replace(/[\s-]+/g, "_")).toBe(tag);
      expect(deriveLegacyDietaryRestrictions(pattern!)).toEqual([tag]);
    }
  );

  it.each(["halal", "gluten-free", "dairy free", "pescatarian"])(
    "offers no keep for v1 restriction %j, which has no v2 mandatory form",
    (token) => {
      expect(mandatoryPatternForLegacyRestriction(token)).toBeUndefined();
    }
  );
});

describe("T-2028 r3 r2 NIT 6 — a stored preference the chips cannot show is carried", () => {
  it("keeps a non-mandatory PESCATARIAN pattern verbatim instead of forcing a re-pick", () => {
    const pescatarian = {
      pattern: "PESCATARIAN",
      otherLabel: null,
      mandatory: false,
      reason: "PREFERENCE",
      status: "CONFIRMED",
    } as const;
    const selections = createIntakeSelections({ dietaryPattern: pescatarian });
    expect(selections.dietaryStyle).toBeUndefined();
    expect(selections.retainedDietaryPattern).toEqual(pescatarian);
    const merged = completeSelections({
      ...stored(selections),
      dietaryStyle: undefined,
      allergens: ["NONE"],
    });
    expect(intakeStepIssues(2, merged, {}, false)).toEqual([]);
    expect(buildConfirmPayload(merged).dietaryPattern).toEqual(pescatarian);
  });

  it("still maps a chip-shaped preference to its chip, and carries no unanswered pattern", () => {
    expect(
      createIntakeSelections({
        dietaryPattern: {
          pattern: "OTHER",
          otherLabel: "Low carb",
          mandatory: false,
          reason: "PREFERENCE",
          status: "CONFIRMED",
        },
      })
    ).toMatchObject({ dietaryStyle: "LOW_CARB", retainedDietaryPattern: undefined });
    expect(
      createIntakeSelections({
        dietaryPattern: {
          pattern: "NONE_DECLARED",
          otherLabel: null,
          mandatory: false,
          reason: "NOT_STATED",
          status: "UNKNOWN",
        },
      }).retainedDietaryPattern
    ).toBeUndefined();
  });
});

describe("T-2055 item 1 — preferred pace for Fat Loss / Build Muscle", () => {
  it.each([
    ["FAT_LOSS", "GRADUAL", "LOSE"],
    ["BUILD_MUSCLE", "MODERATE", "GAIN"],
  ] as const)("%s + %s confirms the goal with the chosen pace", (goal, goalPace, intent) => {
    const payload = buildConfirmPayload(completeSelections({ goal, goalPace }));
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      goal: "BODY_COMPOSITION",
      goalStatus: "CONFIRMED",
      bodyWeightIntent: intent,
      goalPaceClass: goalPace,
      weightNeutralAccepted: false,
    });
  });

  it("fails closed to UNKNOWN when Fat Loss has no pace answer (never defaults UNDECIDED)", () => {
    const payload = buildConfirmPayload(completeSelections({ goal: "FAT_LOSS", goalPace: undefined }));
    expect(payload.goalStatus).toBe("UNKNOWN");
    expect(payload).not.toHaveProperty("bodyWeightIntent");
    expect(payload).not.toHaveProperty("goalPaceClass");
    expect(payload).not.toHaveProperty("weightNeutralAccepted");
  });

  it("writes no pace for Strength even when a stale pace is held", () => {
    const payload = buildConfirmPayload(completeSelections({ goal: "STRENGTH", goalPace: "GRADUAL" }));
    expect(payload.goalStatus).toBe("UNKNOWN");
    expect(payload).not.toHaveProperty("goalPaceClass");
    expect(payload).not.toHaveProperty("bodyWeightIntent");
  });

  it("seeds pace only from a stored CONFIRMED Fat Loss / Build Muscle goal", () => {
    expect(
      createIntakeSelections({
        goal: "BODY_COMPOSITION",
        goalStatus: "CONFIRMED",
        bodyWeightIntent: "LOSE",
        goalPaceClass: "MODERATE",
      }).goalPace
    ).toBe("MODERATE");
    expect(
      createIntakeSelections({
        goal: "BODY_COMPOSITION",
        goalStatus: "UNKNOWN",
        bodyWeightIntent: "LOSE",
        goalPaceClass: "MODERATE",
      }).goalPace
    ).toBeUndefined();
    expect(
      createIntakeSelections({
        goal: "BODY_COMPOSITION",
        goalStatus: "CONFIRMED",
        bodyWeightIntent: "LOSE",
        goalPaceClass: "MAINTAIN",
      }).goalPace
    ).toBeUndefined();
  });
});

describe("T-2055 item 4 — stored session bands round-trip (regression: fails on dba13a6)", () => {
  const trainingSeed = (sessionLengthBand: string) => ({
    trainingContextStatus: "CONFIRMED",
    resistanceTrainingContext: "REGULAR",
    sessionLengthBand,
    trainingDaysPerWeek: 4,
    equipmentAccess: ["HOME_BASIC"],
  });

  it.each(["OVER_90", "UNDER_30"] as const)("an untouched %s seed re-saves the same band", (band) => {
    const selections = createIntakeSelections(trainingSeed(band));
    const payload = buildConfirmPayload(completeSelections(stored(selections)));
    expect(payload).toMatchObject({
      trainingContextStatus: "CONFIRMED",
      resistanceTrainingContext: "REGULAR",
      sessionLengthBand: band,
    });
  });

  it("an UNDER_30 seed leaves no step-2 issue", () => {
    const selections = createIntakeSelections(trainingSeed("UNDER_30"));
    expect(intakeStepIssues(1, selections, {}, false)).toEqual([]);
  });

  it("an OVER_90 seed where the client picks 45-60 saves MIN_45_60", () => {
    const selections = createIntakeSelections(trainingSeed("OVER_90"));
    const payload = buildConfirmPayload(
      completeSelections({ ...stored(selections), sessionLength: "MIN_45_60" })
    );
    expect(payload.sessionLengthBand).toBe("MIN_45_60");
  });
});
