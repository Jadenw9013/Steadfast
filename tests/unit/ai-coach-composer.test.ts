import { describe, expect, it } from "vitest";
import {
  buildInitialFixturePlan,
  composeInitialPlan,
  composeLegacySyntheticPlan,
  composeMealsToPrescription,
  composeUnavailablePrescriptionPlan,
} from "@/lib/ai-coach/initial-plan";
import {
  availableSubstitutions,
  isTargetPreserving,
  mealTargetsMatch,
  representFixturePlan,
} from "@/lib/ai-coach/representation";
import { planPayloadSchema, type PlanPayload } from "@/lib/ai-coach/plan-contract";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { computeNutrientTotals } from "@/lib/ai-coach/nutrition-totals";
import { buildWeeklyFixtureReview } from "@/lib/ai-coach/weekly-controller";
import { runSnapshotSchema, type RunSnapshot } from "@/lib/ai-coach/run-command";
import {
  evaluateAutonomyGate,
  type AutonomyGateFacts,
  type ServerAutonomyGateInput,
} from "@/lib/ai-coach/autonomy/gate";
import { FOOD_CATALOG_VERSION } from "@/lib/ai-coach/catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "@/lib/ai-coach/catalog/exercise-catalog";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import {
  resolvePrescriptionParameters,
  computePrescription,
  type Prescription,
  type PrescriptionResult,
} from "@/lib/ai-coach/prescription";
import { buildPrescriptionInput } from "@/lib/ai-coach/prescription/inputs";
import { intakeAnswersSchema, intakeV2ConfirmObjectSchema } from "@/lib/ai-coach/intake-contract";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import { policyBundleContentSchema } from "@/lib/ai-coach/artifacts/schema";
import { resolveWeeklyParameters } from "@/lib/ai-coach/weekly-parameters";
import {
  buildSyntheticExplanationTexts,
  buildSyntheticPrescriptionBundle,
  buildSyntheticSafetyFloors,
} from "../helpers/ai-prescription-bundle";
import { buildV2Answers } from "../helpers/ai-intake-v2";
import {
  loadDraftUnsignedMealTemplates,
  loadDraftUnsignedFoodCatalog,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import { sourcedFoodCatalogSource } from "@/lib/ai-coach/catalog/food-source";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BINDING = {
  policyVersion: ACTIVE_POLICY_VERSION,
  foodCatalogVersion: FOOD_CATALOG_VERSION,
  exerciseCatalogVersion: EXERCISE_CATALOG_VERSION,
};

const bundle = buildSyntheticPrescriptionBundle();
const floors = buildSyntheticSafetyFloors();
const explanationTexts = buildSyntheticExplanationTexts();
function resolvedParameters() {
  const resolved = resolvePrescriptionParameters(bundle, explanationTexts, floors);
  if (!resolved.ok)
    throw new Error(`fixture bundle failed to resolve: ${resolved.reasonCodes.join(",")}`);
  return resolved.parameters;
}
const PARAMETERS = resolvedParameters();

/** MALE_ADULT/ACTIVE/30y/180cm/80kg/MAINTAIN — same nominal person as
 * ai-coach-prescription.test.ts's baseInput(), confirmed via a real v2
 * CONFIRM_INTAKE-shaped object (not `PrescriptionInput` directly). */
function v2Answers(overrides: Record<string, unknown> = {}) {
  return buildV2Answers({
    ageYears: 30,
    ageStatus: "CONFIRMED",
    energyMethodPopulationCategory: "MALE_ADULT",
    energyMethodPopulationCategoryStatus: "CONFIRMED",
    physicalActivityCategory: "ACTIVE",
    physicalActivityCategoryStatus: "CONFIRMED",
    bodyMeasurementStatus: "CONFIRMED",
    heightCm: 180,
    weightKg: 80,
    weightMeasuredOn: "2026-09-20",
    bodyWeightIntent: "MAINTAIN",
    goalPaceClass: "MAINTAIN",
    goalStatus: "CONFIRMED",
    resistanceTrainingContext: "NONE",
    trainingContextStatus: "CONFIRMED",
    dietaryPattern: {
      pattern: "OMNIVORE",
      reason: "PREFERENCE",
      status: "CONFIRMED",
      otherLabel: null,
      mandatory: false,
    },
    ...overrides,
  });
}

const EVALUATED_ON = "2026-09-24";

function prescribedPrescription(): Prescription {
  const built = buildPrescriptionInput(v2Answers(), EVALUATED_ON);
  if (!built.ok) throw new Error("fixture intake failed to build a prescription input");
  const result = computePrescription(PARAMETERS, built.input);
  if (result.status !== "PRESCRIBED")
    throw new Error(`fixture did not prescribe: ${result.reasonCodes.join(",")}`);
  return result.prescription;
}

/**
 * A `Prescription` this exact 3-item fixture catalog CAN compose, built from
 * the catalog's own real nutrient values (never a hand-typed literal) for a
 * fixed, round gram vector (900/1200/600 g — all multiples of 5, so
 * `composeMealsToPrescription`'s rounding step is a no-op and the solve
 * reproduces this vector near-exactly). This is deliberately NOT what the
 * real synthetic bundle's AMDR fat range would ever prescribe for a real
 * person: this fixture catalog's fat-per-energy ceiling (chicken alone,
 * the highest-fat item, is ~2.2% of its own energy) sits well below any
 * reviewed AMDR fat floor (12% in the synthetic bundle), so a *real*
 * bundle-produced prescription is, by design, "usually infeasible" for
 * MEALS with today's catalog (T-2003 Decision summary point 4) — that
 * degrade path has its own test below. This helper exists only to exercise
 * `composeMealsToPrescription`'s solve/round/verify mechanics in isolation
 * against a target the catalog can actually reach.
 */
function feasiblePrescriptionFixture(overrides: Partial<Prescription> = {}): Prescription {
  const grams = { chicken: 900, rice: 1200, broccoli: 600 };
  const components = [
    { foodId: "chicken-breast-raw", catalogVersion: FOOD_CATALOG_VERSION, grams: grams.chicken },
    { foodId: "brown-rice-cooked", catalogVersion: FOOD_CATALOG_VERSION, grams: grams.rice },
    { foodId: "broccoli-steamed", catalogVersion: FOOD_CATALOG_VERSION, grams: grams.broccoli },
  ];
  const totals = computeNutrientTotals(components);
  if (!totals.success) throw new Error("fixture catalog lookup failed");
  return {
    method: "REVIEWED_PRESCRIPTION_V1",
    energyMethodStructureId: "NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1",
    parameterSetDigest: "0".repeat(64),
    maintenanceEnergyKcal: totals.totals.energyKcal,
    targetEnergyKcal: totals.totals.energyKcal,
    proteinG: totals.totals.proteinG,
    carbohydrateRangeG: { min: totals.totals.carbsG, max: totals.totals.carbsG },
    fatRangeG: { min: totals.totals.fatG, max: totals.totals.fatG },
    projectedWeeklyWeightChangeKg: 0,
    appliedBoundIds: [],
    tolerancePercent: 5,
    assumptions: [
      "SYNTHETIC FIXTURE: engineered-feasible test vector, not a reviewed prescription.",
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// composeMealsToPrescription
// ---------------------------------------------------------------------------

describe("composeMealsToPrescription", () => {
  it("composes grams that satisfy mealTargetsMatch for all four macros at the bundle tolerance", () => {
    const prescription = feasiblePrescriptionFixture();
    const meals = composeMealsToPrescription(
      v2AnswersParsedForMeals(),
      prescription,
      BINDING.foodCatalogVersion
    );
    expect(meals).not.toBeNull();
    if (!meals) return;
    const candidate: PlanPayload = {
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: "rx-test",
        method: "REVIEWED_PRESCRIPTION_V1",
        targets: {
          energyKcal: prescription.targetEnergyKcal,
          proteinG: prescription.proteinG,
          carbsG: (prescription.carbohydrateRangeG.min + prescription.carbohydrateRangeG.max) / 2,
          fatG: (prescription.fatRangeG.min + prescription.fatRangeG.max) / 2,
        },
        tolerancePercent: prescription.tolerancePercent,
        assumptions: prescription.assumptions,
      },
      meals,
      strength: [],
      cardio: [],
      policyVersion: BINDING.policyVersion,
      catalogVersions: {
        food: BINDING.foodCatalogVersion,
        exercise: BINDING.exerciseCatalogVersion,
      },
    };
    expect(mealTargetsMatch(candidate, v2AnswersParsedForMeals())).toBe(true);
  });

  it("is deterministic: the same prescription composes to a byte-identical meals object twice", () => {
    const prescription = feasiblePrescriptionFixture();
    const answers = v2AnswersParsedForMeals();
    const first = composeMealsToPrescription(answers, prescription, BINDING.foodCatalogVersion);
    const second = composeMealsToPrescription(answers, prescription, BINDING.foodCatalogVersion);
    expect(first).not.toBeNull();
    expect(contentHash(first)).toBe(contentHash(second));
    expect(first).toEqual(second);
  });

  it("rejects a solution with a non-positive or >3000g component (never returns portions that miss the prescription)", () => {
    const prescription = prescribedPrescription();
    const answers = v2AnswersParsedForMeals();
    // The real bundle-produced prescription (protein 80g / carb mid 269g /
    // fat mid 54.5g) is itself already unreachable by this catalog (its
    // fat-per-energy ceiling is far below any AMDR fat floor — see
    // `feasiblePrescriptionFixture`'s doc comment), so the solved system
    // already yields a wildly negative/out-of-range gram amount here.
    expect(
      composeMealsToPrescription(answers, prescription, BINDING.foodCatalogVersion)
    ).toBeNull();
    // A second, independent way to force the same rejection from a
    // catalog-reachable baseline: push protein far beyond anything the
    // catalog's protein-per-gram ratios can deliver without a component
    // exceeding 3000 g or going negative.
    const feasible = feasiblePrescriptionFixture();
    const proteinOutOfRange: Prescription = { ...feasible, proteinG: 100000 };
    expect(
      composeMealsToPrescription(answers, proteinOutOfRange, BINDING.foodCatalogVersion)
    ).toBeNull();
  });

  it("returns null (never silently-off meals) when the composed grams cannot reach the target energy within tolerance", () => {
    const answers = v2AnswersParsedForMeals();
    // Keep the (catalog-reachable) protein/carb/fat targets identical to the
    // feasible fixture — the solve still reproduces the same grams — but
    // assert an energy the *resulting* grams cannot come within 10% of.
    // This exercises "energy is verified, not solved" specifically, as
    // distinct from the solve-infeasibility case above.
    const feasible = feasiblePrescriptionFixture();
    const energyMismatch: Prescription = {
      ...feasible,
      targetEnergyKcal: feasible.targetEnergyKcal * 3,
    };
    expect(
      composeMealsToPrescription(answers, energyMismatch, BINDING.foodCatalogVersion)
    ).toBeNull();
  });
});

function v2AnswersParsedForMeals() {
  // `composeMealsToPrescription` takes `IntakeAnswers` (the full parsed
  // shape used for the dietary-restriction/allergy guard), not the v2
  // `CONFIRM_INTAKE` object itself.
  return intakeAnswersSchema.parse(v2Answers());
}

// ---------------------------------------------------------------------------
// composeInitialPlan — prescription-first
// ---------------------------------------------------------------------------

describe("composeInitialPlan — v2 prescription-first", () => {
  it("MACROS mode: PRESCRIBED, meals null, targets equal the engine's prescription", () => {
    const result = composeInitialPlan({
      rawAnswers: v2Answers(),
      prescriptionId: "rx-1",
      mode: "MACROS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
    });
    expect(result.prescription.status).toBe("PRESCRIBED");
    expect(result.payload.nutrition?.method).toBe("REVIEWED_PRESCRIPTION_V1");
    expect(result.payload.meals).toBeNull();
    expect(result.payload.prescriptionOutcome).toMatchObject({
      status: "PRESCRIBED",
      reasonCodes: [],
    });
    if (result.prescription.status === "PRESCRIBED") {
      expect(result.payload.nutrition?.targets.energyKcal).toBe(
        result.prescription.prescription.targetEnergyKcal
      );
      expect(result.payload.prescriptionOutcome?.parameterSetDigest).toBe(
        result.prescription.prescription.parameterSetDigest
      );
    }
  });

  it("MEALS mode degrades to macro-only NO_FEASIBLE_MEALS, never disappearing nutrition, when the real bundle's prescription is infeasible for this catalog (T-2003 Decision summary point 4: the expected v1 outcome)", () => {
    const result = composeInitialPlan({
      rawAnswers: v2Answers(),
      prescriptionId: "rx-3",
      mode: "MEALS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
    });
    if (result.prescription.status !== "PRESCRIBED") {
      // The parameter combination itself is infeasible for this bundle
      // (PRESCRIPTION_MACRO_RANGES_INFEASIBLE) rather than merely
      // meal-infeasible; either way nutrition must not silently disappear.
      expect(result.payload.nutrition).toBeNull();
      return;
    }
    expect(result.payload.meals).toBeNull();
    expect(result.payload.nutrition).not.toBeNull();
    expect(result.decision.reasonCodes).toEqual(["NO_FEASIBLE_MEALS"]);
  });

  it("nutrition required but unavailable: LOSE + DECLINED population category -> UNAVAILABLE with nutritionRequired true", () => {
    const result = composeInitialPlan({
      rawAnswers: v2Answers({
        bodyWeightIntent: "LOSE",
        goalPaceClass: "GRADUAL",
        energyMethodPopulationCategoryStatus: "DECLINED",
      }),
      prescriptionId: "rx-4",
      mode: "MACROS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
    });
    expect(result.payload.nutrition).toBeNull();
    expect(result.payload.prescriptionOutcome).toMatchObject({
      status: "UNAVAILABLE",
      nutritionRequired: true,
    });
    expect(result.payload.prescriptionOutcome?.reasonCodes).toContain("PRESCRIPTION_INPUT_MISSING");
  });

  it.each(["MAINTAIN", "NO_PREFERENCE"] as const)(
    "%s cannot bypass an out-of-scope clinical diet screening",
    (bodyWeightIntent) => {
      const result = composeInitialPlan({
        rawAnswers: v2Answers({
          bodyWeightIntent,
          goalPaceClass: bodyWeightIntent === "MAINTAIN" ? "MAINTAIN" : "GRADUAL",
          dietaryPattern: {
            pattern: "OMNIVORE",
            reason: "MEDICAL_OR_CLINICIAN_DIRECTED",
            status: "CONFIRMED",
            otherLabel: null,
            mandatory: true,
          },
        }),
        prescriptionId: `rx-${bodyWeightIntent}`,
        mode: "MACROS",
        evaluatedOn: EVALUATED_ON,
        parameters: PARAMETERS,
        binding: BINDING,
      });
      expect(result.payload.prescriptionOutcome).toMatchObject({
        status: "UNAVAILABLE",
        nutritionRequired: true,
        reasonCodes: ["PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE"],
      });
      expect(result.decision.action).toBe("PAUSE_REFER");
    }
  );

  it("v1 intake always routes to the legacy composer, unaffected by `parameters`", () => {
    const v1 = {
      goal: "GENERAL_FITNESS",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      dietaryRestrictions: [],
      allergies: [],
      foodBudgetLevel: "LOW",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
      heightCm: 170,
      weightKg: 70,
    };
    const withParameters = composeInitialPlan({
      rawAnswers: v1,
      prescriptionId: "rx",
      mode: "MACROS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
    });
    const withoutParameters = composeInitialPlan({
      rawAnswers: v1,
      prescriptionId: "rx",
      mode: "MACROS",
      evaluatedOn: EVALUATED_ON,
      parameters: null,
      binding: BINDING,
    });
    expect(withParameters.payload.nutrition?.method).toBe("SYNTHETIC_CATALOG_MATCH");
    expect(contentHash(withParameters.payload)).toBe(contentHash(withoutParameters.payload));
  });

  it("judgment call regression: a v2 intake with unresolved parameters (parameters: null) never falls back to the legacy fixture-scaled composer", () => {
    const legacyEquivalent = composeLegacySyntheticPlan(v2Answers(), "rx", "MACROS");
    const result = composeInitialPlan({
      rawAnswers: v2Answers(),
      prescriptionId: "rx",
      mode: "MACROS",
      evaluatedOn: EVALUATED_ON,
      parameters: null,
      binding: BINDING,
    });
    // The legacy composer, given the exact same body weight/height, WOULD
    // produce real fixture nutrition targets (SYNTHETIC_CATALOG_MATCH) —
    // proving this isn't a case where the legacy path happens to also fail.
    expect(legacyEquivalent.payload.nutrition).not.toBeNull();
    // composeInitialPlan must not reach that path for a v2 intake.
    expect(result.payload.nutrition).toBeNull();
    expect(result.payload.prescriptionOutcome?.status).toBe("UNAVAILABLE");
  });

  it("composeUnavailablePrescriptionPlan reports the caller's real reason codes and still completes strength/cardio", () => {
    const result = composeUnavailablePrescriptionPlan(v2Answers(), "MACROS", BINDING, [
      "PRESCRIPTION_METHOD_UNSUPPORTED",
    ]);
    expect(result.payload.nutrition).toBeNull();
    expect(result.payload.prescriptionOutcome?.reasonCodes).toEqual([
      "PRESCRIPTION_METHOD_UNSUPPORTED",
    ]);
    expect(result.payload.strength.length).toBeGreaterThan(0);
  });

  // Review r1 MINOR 5: before this, every UNAVAILABLE reason produced
  // `CLARIFY` / `MISSING_INPUT` / "Review and confirm the requested intake
  // fields" — including the cases where the RD has not signed the content and
  // the client can do nothing. The decision now routes off the same three
  // reason classes the gate uses (`prescription/reason-classes.ts`).
  it.each([
    ["CLIENT_FIXABLE", ["PRESCRIPTION_INPUT_MISSING"] as const, "CLARIFY", "MISSING_INPUT"],
    [
      "OUT_OF_SCOPE",
      ["PRESCRIPTION_POPULATION_UNSUPPORTED"] as const,
      "PAUSE_REFER",
      "SAFETY_CONCERN",
    ],
    [
      "POLICY_NOT_READY",
      ["PRESCRIPTION_PARAMETER_MISSING"] as const,
      "HOLD",
      "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE",
    ],
    [
      "POLICY_NOT_READY (method unsupported)",
      ["PRESCRIPTION_METHOD_UNSUPPORTED"] as const,
      "HOLD",
      "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE",
    ],
    [
      "POLICY_NOT_READY (unknown/forward-compatible code)",
      ["PRESCRIPTION_SOME_FUTURE_CODE"] as const,
      "HOLD",
      "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE",
    ],
  ])(
    "the UNAVAILABLE decision follows the %s reason class, not a hardcoded 'go fix your intake'",
    (_label, reasonCodes, action, decisionReasonCode) => {
      const result = composeUnavailablePrescriptionPlan(
        v2Answers(),
        "MACROS",
        BINDING,
        reasonCodes as unknown as PrescriptionResult["reasonCodes"]
      );
      expect(result.decision.action).toBe(action);
      expect(result.decision.reasonCodes).toEqual([decisionReasonCode]);
      // Only the client-fixable class may ask the client to change anything.
      expect(result.decision.nextAction.includes("Review and confirm")).toBe(action === "CLARIFY");
      // The payload still carries the engine's real codes either way.
      expect(result.payload.prescriptionOutcome?.reasonCodes).toEqual([...reasonCodes]);
    }
  );

  it("prescriptionOutcome is present on every payload the composer returns, including the legacy path", () => {
    const legacyWithTargets = composeLegacySyntheticPlan(
      {
        goal: "GENERAL_FITNESS",
        experienceLevel: "NEW",
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        dietaryRestrictions: [],
        allergies: [],
        foodBudgetLevel: "LOW",
        trackingPreference: "NUMBERS_VISIBLE",
        unitsPreference: "METRIC",
        heightCm: 170,
        weightKg: 70,
      },
      "rx",
      "MACROS"
    );
    expect(legacyWithTargets.payload.prescriptionOutcome).toEqual({
      status: "PRESCRIBED",
      reasonCodes: [],
      nutritionRequired: false,
      parameterSetDigest: null,
    });
    const legacyMissing = composeLegacySyntheticPlan(
      {
        goal: "GENERAL_FITNESS",
        experienceLevel: "NEW",
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        dietaryRestrictions: [],
        allergies: [],
        foodBudgetLevel: "LOW",
        trackingPreference: "NUMBERS_VISIBLE",
        unitsPreference: "METRIC",
      },
      "rx",
      "MACROS"
    );
    expect(legacyMissing.payload.prescriptionOutcome).toEqual({
      status: "UNAVAILABLE",
      reasonCodes: [],
      nutritionRequired: false,
      parameterSetDigest: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Representation round trip (MACROS -> MEALS -> MACROS) for a prescribed plan
// ---------------------------------------------------------------------------

/** A prescribed, MACROS-mode payload the fixture catalog CAN represent as
 * MEALS (see `feasiblePrescriptionFixture`'s doc comment) — used to exercise
 * the round trip and substitution behavior of `representFixturePlan` itself,
 * independent of whether the real bundle's prescription happens to be
 * MEALS-feasible for this catalog (it usually is not — that is a different,
 * already-covered case). */
function feasibleMacroPlan(): PlanPayload {
  const prescription = feasiblePrescriptionFixture();
  return planPayloadSchema.parse({
    schemaVersion: 1,
    contentKind: "SYNTHETIC_FIXTURE",
    nutrition: {
      prescriptionId: "rx-rt",
      method: "REVIEWED_PRESCRIPTION_V1",
      targets: {
        energyKcal: prescription.targetEnergyKcal,
        proteinG: prescription.proteinG,
        carbsG: (prescription.carbohydrateRangeG.min + prescription.carbohydrateRangeG.max) / 2,
        fatG: (prescription.fatRangeG.min + prescription.fatRangeG.max) / 2,
      },
      tolerancePercent: prescription.tolerancePercent,
      assumptions: prescription.assumptions,
    },
    meals: null,
    strength: [],
    cardio: [],
    policyVersion: BINDING.policyVersion,
    catalogVersions: { food: BINDING.foodCatalogVersion, exercise: BINDING.exerciseCatalogVersion },
    prescriptionOutcome: {
      status: "PRESCRIBED",
      reasonCodes: [],
      nutritionRequired: true,
      parameterSetDigest: prescription.parameterSetDigest,
    },
  });
}

describe("composeInitialPlan — S-36a mealComposer (reviewed template set + catalog)", () => {
  const draftTemplates = loadDraftUnsignedMealTemplates().content;
  const draftCatalog = loadDraftUnsignedFoodCatalog();
  const draftSource = sourcedFoodCatalogSource(draftCatalog.content);
  const REVIEWED_BINDING = {
    policyVersion: ACTIVE_POLICY_VERSION,
    foodCatalogVersion: "food-catalog",
    exerciseCatalogVersion: EXERCISE_CATALOG_VERSION,
  };

  /** A concrete (population, activity, intent, pace, weight) combination
   *  whose real-engine-computed prescription (from the synthetic bundle's
   *  own 10% composition tolerance) is reachable by the real draft template
   *  set against the real signed-v1 catalog, with a FULL_KITCHEN / FLEXIBLE
   *  / OVER_60 client. Found by direct search (board/evidence/S-36a.md
   *  records the search), not hand-picked — the draft corpus's honest
   *  coverage is narrow (S-36 decision summary point 4), so an arbitrary v2
   *  intake does not generally compose. */
  function composableV2Answers(overrides: Record<string, unknown> = {}) {
    return buildV2Answers({
      ageYears: 30,
      ageStatus: "CONFIRMED",
      energyMethodPopulationCategory: "MALE_ADULT",
      energyMethodPopulationCategoryStatus: "CONFIRMED",
      physicalActivityCategory: "INACTIVE",
      physicalActivityCategoryStatus: "CONFIRMED",
      bodyMeasurementStatus: "CONFIRMED",
      heightCm: 175,
      weightKg: 125,
      weightMeasuredOn: "2026-09-20",
      bodyWeightIntent: "LOSE",
      goalPaceClass: "MODERATE",
      goalStatus: "CONFIRMED",
      resistanceTrainingContext: "NONE",
      trainingContextStatus: "CONFIRMED",
      dietaryPattern: {
        pattern: "OMNIVORE",
        reason: "PREFERENCE",
        status: "CONFIRMED",
        otherLabel: null,
        mandatory: false,
      },
      cookingAccessStatus: "CONFIRMED",
      cookingAccess: {
        equipment: ["FULL_KITCHEN"],
        refrigeration: "FRIDGE_AND_FREEZER",
        mealPrepCapacity: "SOME",
        typicalPrepMinutesBand: "OVER_60",
      },
      dislikes: [],
      cuisinePreferences: [],
      allergenDeclarations: { status: "CONFIRMED", noKnownAllergens: true, items: [] },
      foodBudgetLevel: "FLEXIBLE",
      ...overrides,
    });
  }

  function allTemplateSetFoodIds(): Set<string> {
    const ids = new Set<string>();
    for (const t of draftTemplates.templates) {
      for (const ing of t.ingredients) {
        if (ing.kind === "FOOD") ids.add(ing.foodId);
      }
    }
    for (const group of draftTemplates.substitutionGroups) {
      for (const id of group.memberFoodIds) ids.add(id);
    }
    return ids;
  }

  it("(7) composes real meals from the reviewed template set + catalog and parses, with every ingredient id drawn from the 29 template ids -- the defect-3 regression (throws on faed556)", () => {
    const result = composeInitialPlan({
      rawAnswers: composableV2Answers(),
      prescriptionId: "rx-reviewed",
      mode: "MEALS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: REVIEWED_BINDING,
      mealComposer: { templateSet: draftTemplates, source: draftSource },
    });

    // planPayloadSchema.parse already ran inside assembleV2Plan; reaching
    // this line at all (without throwing) is half the regression proof.
    expect(() => planPayloadSchema.parse(result.payload)).not.toThrow();
    expect(result.payload.meals).not.toBeNull();
    expect(result.payload.catalogVersions.food).toBe("food-catalog");

    const validIds = allTemplateSetFoodIds();
    expect(validIds.size).toBe(29);
    for (const day of result.payload.meals!.days) {
      for (const meal of day.meals) {
        for (const ingredient of meal.ingredients) {
          expect(validIds.has(ingredient.foodId), `unexpected id ${ingredient.foodId}`).toBe(true);
          expect(ingredient.catalogVersion).toBe("food-catalog");
        }
      }
    }
  });

  it("(8) cookingAccessStatus: UNKNOWN degrades to PRESCRIBED/meals:null/NO_FEASIBLE_MEALS with the cooking-access explanation -- degrade, never disappear", () => {
    const result = composeInitialPlan({
      rawAnswers: composableV2Answers({ cookingAccessStatus: "UNKNOWN", cookingAccess: undefined }),
      prescriptionId: "rx-no-cooking-access",
      mode: "MEALS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: REVIEWED_BINDING,
      mealComposer: { templateSet: draftTemplates, source: draftSource },
    });

    expect(result.prescription.status).toBe("PRESCRIBED");
    expect(result.payload.prescriptionOutcome?.status).toBe("PRESCRIBED");
    expect(result.payload.nutrition).not.toBeNull();
    expect(result.payload.meals).toBeNull();
    expect(result.decision.reasonCodes).toContain("NO_FEASIBLE_MEALS");
    expect(result.decision.explanation).toMatch(/cooking equipment and storage/);
    expect(result.decision.nextAction).toMatch(/Confirm your cooking equipment/);
  });

  it("(9) with mealComposer absent (or explicitly null), composeInitialPlan's existing output is byte-identical -- the four golden composeFixtureMeals hashes are asserted separately in ai-coach-representation.test.ts", () => {
    // Regression guard: composeInitialPlan's existing behaviour (asserted
    // throughout this file) must not move when `mealComposer` is omitted --
    // every production call site (managed-executor.ts) omits it today.
    const withoutComposer = composeInitialPlan({
      rawAnswers: v2Answers(),
      prescriptionId: "rx-no-composer",
      mode: "MEALS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
    });
    const explicitlyNull = composeInitialPlan({
      rawAnswers: v2Answers(),
      prescriptionId: "rx-no-composer",
      mode: "MEALS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
      mealComposer: null,
    });
    expect(contentHash(withoutComposer.payload)).toBe(contentHash(explicitlyNull.payload));
  });

  it("(10) a v2 intake with binding.foodCatalogVersion = 'food-catalog' and no mealComposer returns meals: null via the foodCatalogIsServedInCode guard, never the three fixture ids", () => {
    const result = composeInitialPlan({
      rawAnswers: composableV2Answers(),
      prescriptionId: "rx-unbound-catalog",
      mode: "MEALS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: REVIEWED_BINDING,
      // No mealComposer: this build does not carry "food-catalog" in its
      // in-code catalog registry, so the legacy fixture path must refuse to
      // compose rather than silently stamp the three hard-wired ids under a
      // catalog key it does not serve.
    });
    expect(result.payload.nutrition).not.toBeNull();
    expect(result.payload.meals).toBeNull();
    for (const foodId of ["chicken-breast-raw", "brown-rice-cooked", "broccoli-steamed"]) {
      expect(JSON.stringify(result.payload)).not.toContain(foodId);
    }
  });
});

describe("representFixturePlan — prescribed plan round trip", () => {
  it("MACROS -> MEALS -> MACROS preserves nutrition exactly (isTargetPreserving)", () => {
    const macroPlan = feasibleMacroPlan();
    const answers = v2AnswersParsedForMeals();
    const toMeals = representFixturePlan(macroPlan, answers, "MEALS");
    expect(toMeals.payload).not.toBeNull();
    if (!toMeals.payload) return;
    expect(toMeals.payload.meals?.days).toHaveLength(7);
    expect(isTargetPreserving(macroPlan, toMeals.payload, answers)).toBe(true);
    const backToMacros = representFixturePlan(toMeals.payload, answers, "MACROS");
    expect(backToMacros.payload).not.toBeNull();
    if (!backToMacros.payload) return;
    expect(backToMacros.payload.nutrition).toEqual(macroPlan.nutrition);
    expect(isTargetPreserving(macroPlan, backToMacros.payload, answers)).toBe(true);
  });

  it("availableSubstitutions on a macro-only prescribed plan is [] (degrade, never disappear)", () => {
    const macroPlan = composeInitialPlan({
      rawAnswers: v2Answers(),
      prescriptionId: "rx-subs",
      mode: "MACROS",
      evaluatedOn: EVALUATED_ON,
      parameters: PARAMETERS,
      binding: BINDING,
    }).payload;
    const answers = v2AnswersParsedForMeals();
    // MACROS mode never populates `meals`, regardless of whether the
    // underlying prescription would even be MEALS-feasible for this
    // catalog — `availableSubstitutions` iterates `plan.meals?.days ?? []`.
    expect(macroPlan.meals).toBeNull();
    expect(availableSubstitutions(macroPlan, answers)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T-2003 Amendment 1 §A1.4 — the divergence regression the mirror's removal
// exists to catch
// ---------------------------------------------------------------------------

describe("T-2003 Amendment 1 §A1.4 — buildPrescriptionInput against the real, merged v2 schema", () => {
  it("a CONFIRM_INTAKE v2 payload built from intakeV2ConfirmObjectSchema populates all nine engine inputs", () => {
    const confirmShaped = intakeV2ConfirmObjectSchema.parse({
      intakeVersion: 2,
      goal: "BODY_COMPOSITION",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      foodBudgetLevel: "MODERATE",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
      ageYears: 30,
      ageStatus: "CONFIRMED",
      energyMethodPopulationCategory: "MALE_ADULT",
      energyMethodPopulationCategoryStatus: "CONFIRMED",
      physicalActivityCategory: "ACTIVE",
      physicalActivityCategoryStatus: "CONFIRMED",
      bodyMeasurementStatus: "CONFIRMED",
      heightCm: 180,
      weightKg: 80,
      weightMeasuredOn: "2026-09-20",
      bodyWeightIntent: "LOSE",
      goalPaceClass: "GRADUAL",
      weightNeutralAccepted: false,
      goalStatus: "CONFIRMED",
      resistanceTrainingContext: "OCCASIONAL",
      sessionLengthBand: "MIN_30_45",
      trainingContextStatus: "CONFIRMED",
      cookingAccessStatus: "UNKNOWN",
      dislikes: [],
      cuisinePreferences: [],
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
      dietaryPattern: {
        pattern: "VEGAN",
        otherLabel: null,
        mandatory: false,
        reason: "PREFERENCE",
        status: "CONFIRMED",
      },
    });
    // The server-derived fields confirmIntake() adds before storing.
    const storedShape = {
      ...confirmShaped,
      capturedAt: "2026-09-24T00:00:00.000Z",
      allergies: [],
      dietaryRestrictions: ["VEGAN"],
    };
    const built = buildPrescriptionInput(storedShape, EVALUATED_ON);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toEqual({
      intakeVersion: 2,
      ageYears: 30,
      energyMethodPopulationCategory: "MALE_ADULT",
      physicalActivityCategory: "ACTIVE",
      heightCm: 180,
      weightKg: 80,
      weightMeasuredOn: "2026-09-20",
      evaluatedOn: EVALUATED_ON,
      bodyWeightIntent: "LOSE",
      goalPaceClass: "GRADUAL",
      resistanceTrainingContext: "OCCASIONAL",
      dietaryPattern: "VEGAN",
      dietaryPatternReason: "PREFERENCE",
    });
    // All nine of the engine's REQUIRED_INPUT_FIELDS (prescription/index.ts)
    // are populated (non-null) — the exact regression a T-2024 field-shape
    // divergence would produce is one of these silently reading back null.
    const REQUIRED_INPUT_FIELDS = [
      "ageYears",
      "energyMethodPopulationCategory",
      "physicalActivityCategory",
      "heightCm",
      "weightKg",
      "weightMeasuredOn",
      "bodyWeightIntent",
      "goalPaceClass",
      "resistanceTrainingContext",
    ] as const;
    expect(REQUIRED_INPUT_FIELDS).toHaveLength(9);
    for (const field of REQUIRED_INPUT_FIELDS) {
      expect(built.input[field]).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Weekly guard (T-2033 file item 7)
// ---------------------------------------------------------------------------

function weeklyFixture(): RunSnapshot {
  const intake = {
    goal: "BODY_COMPOSITION",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 2,
    equipmentAccess: ["NONE"],
    allergies: [],
    dietaryRestrictions: [],
    foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    heightCm: 170,
    weightKg: 70,
  };
  const { payload } = buildInitialFixturePlan(intake, "initial-rx", "MEALS");
  const set = buildSyntheticArtifactSet("t2007-composer-weekly");
  const resolved = resolveWeeklyParameters(policyBundleContentSchema.parse(set.policyBundle.content), {
    synthetic: true,
  });
  if (!resolved.ok) throw new Error(`weekly fixture did not resolve: ${resolved.reasonCodes.join(",")}`);
  return runSnapshotSchema.parse({
    schemaVersion: 1,
    synthetic: true,
    intake,
    policyVersion: payload.policyVersion,
    catalogVersions: payload.catalogVersions,
    modelConfiguration: "synthetic-template-v1",
    weeklyPolicy: {
      status: "RESOLVED",
      sourceArtifact: {
        id: set.policyBundle.id,
        kind: "POLICY_BUNDLE",
        artifactKey: set.policyBundle.artifactKey,
        version: set.policyBundle.version,
        digest: artifactContentDigest(set.policyBundle),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      },
      parameters: resolved.parameters,
      parameterSetDigest: resolved.parameterSetDigest,
      energyReestimate: null,
      simplifiedTraining: null,
    },
    baseVersionId: "base",
    basePayload: payload,
    representation: "MEALS",
    reviewWindowKey: "2026-09-14",
    reviewTimezone: "America/Los_Angeles",
    sourceRefs: [],
    evidence: {
      sessions: [],
      observations: ["2026-08-26", "2026-09-02", "2026-09-09"].map((date, i) => ({
        id: `check-${i}`,
        revision: 1,
        occurredAt: `${date}T12:00:00.000Z`,
        payload: {
          schemaVersion: 1,
          completeness: "REPORTED_COMPLETE",
          followingDays: 6,
          weight: { value: 70, unit: "KG", comparableConditions: true },
          energy: "OK",
          recovery: "GOOD",
          hunger: "MANAGEABLE",
          barrier: "NONE",
          safetyChanged: "NO",
        },
      })),
    },
    history: [
      {
        id: "base",
        acceptedAt: "2026-08-01T12:00:00.000Z",
        changeClass: "INITIAL",
        reviewWindowKey: "2026-07-27",
        payload,
      },
    ],
  });
}

describe("weekly-controller — T-2033 REVIEWED_PRESCRIPTION_V1 guard", () => {
  it("a REVIEWED_PRESCRIPTION_V1 base returns HOLD WEEKLY_POLICY_PARAMETERS_UNAVAILABLE and leaves targets untouched", () => {
    const snapshot = weeklyFixture();
    snapshot.basePayload!.nutrition!.method = "REVIEWED_PRESCRIPTION_V1";
    const before = structuredClone(snapshot.basePayload!.nutrition);
    const result = buildWeeklyFixtureReview(snapshot);
    expect(result).toMatchObject({
      payload: null,
      decision: { action: "HOLD", reasonCodes: ["WEEKLY_POLICY_PARAMETERS_UNAVAILABLE"] },
    });
    expect(snapshot.basePayload!.nutrition).toEqual(before);
  });

  it("a SYNTHETIC_CATALOG_MATCH base behaves exactly as today (ADJUST, energy decreases)", () => {
    const snapshot = weeklyFixture();
    const result = buildWeeklyFixtureReview(snapshot);
    expect(result.decision).toMatchObject({ action: "ADJUST", changeClass: "ROUTINE" });
    expect(result.payload!.nutrition!.targets.energyKcal).toBeLessThan(
      snapshot.basePayload!.nutrition!.targets.energyKcal
    );
  });
});

// ---------------------------------------------------------------------------
// Gate unit cases, one per reason class (T-2033 file item 6)
// ---------------------------------------------------------------------------

function gateFixture(prescription: AutonomyGateFacts["prescription"]): {
  input: ServerAutonomyGateInput;
  facts: AutonomyGateFacts;
} {
  const input: ServerAutonomyGateInput = {
    requestedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
    requestedDomains: ["NUTRITION"],
    requiredInputs: [{ id: "INPUT", status: "CONFIRMED" }],
    evidence: [{ ruleId: "EVIDENCE_RULE", status: "SUFFICIENT", sourceRefs: [] }],
    candidatePlanVersionId: "candidate",
  };
  const facts: AutonomyGateFacts = {
    authorityEligible: true,
    allowedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
    explicitExclusions: [],
    requiredInputIds: ["INPUT"],
    evidenceRuleIds: ["EVIDENCE_RULE"],
    permissions: { NUTRITION: "ALLOW", STRENGTH: "ALLOW", CARDIO: "ALLOW" },
    safetyDisposition: "CLEAR",
    prescription,
    nutritionSafety: {
      id: "safety-decision",
      outcome: "PASS",
      reasonCodes: [],
      ruleIds: [],
      escalationTemplateIds: [],
      input: {
        screening: {
          instrumentId: "SYNTHETIC_SCREEN",
          result: "CLEAR",
          provenance: "SYNTHETIC_SERVER_FIXTURE",
        },
        contraindications: {
          AGE_ELIGIBILITY: "CLEAR",
          PREGNANCY_POSTPARTUM: "CLEAR",
          EATING_DISORDER_HISTORY_OR_CONCERN: "CLEAR",
          TYPE_1_DIABETES: "CLEAR",
          CARDIAC_CONDITION: "CLEAR",
        },
        proposal: null,
      },
    },
    evidenceCurrent: true,
    candidateValid: true,
  };
  return { input, facts };
}

describe("evaluateAutonomyGate — prescription fact, one case per reason class (T-2003 Contract)", () => {
  it("required:true, available:false, INPUT_MISSING -> FOCUSED_CLARIFICATION", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["PRESCRIPTION_INPUT_MISSING"],
    });
    const result = evaluateAutonomyGate(input, facts);
    expect(result.outcome).toBe("FOCUSED_CLARIFICATION");
    expect(result.orderedReasonCodes).toEqual(
      expect.arrayContaining([
        "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
        "PRESCRIPTION_INPUT_MISSING",
      ])
    );
  });

  it("POPULATION_UNSUPPORTED -> PAUSE_REFER", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["PRESCRIPTION_POPULATION_UNSUPPORTED"],
    });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("PAUSE_REFER");
  });

  it("an out-of-range form value is retryable clarification, not a clinical referral", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE"],
    });
    const result = evaluateAutonomyGate(input, facts);
    expect(result.outcome).toBe("FOCUSED_CLARIFICATION");
    expect(result.orderedReasonCodes).toEqual([
      "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
      "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE",
    ]);
  });

  it("PARAMETER_MISSING -> HOLD", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["PRESCRIPTION_PARAMETER_MISSING"],
    });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("HOLD");
  });

  it("an unknown code -> HOLD", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["SOMETHING_NEW_A_FUTURE_TICKET_ADDS"],
    });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("HOLD");
  });

  it("a mixed set resolves to the most protective outcome (PAUSE_REFER wins over FOCUSED_CLARIFICATION)", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["PRESCRIPTION_INPUT_MISSING", "PRESCRIPTION_POPULATION_UNSUPPORTED"],
    });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("PAUSE_REFER");
  });

  it("a mixed set resolves to HOLD over FOCUSED_CLARIFICATION when no out-of-scope code is present", () => {
    const { input, facts } = gateFixture({
      required: true,
      available: false,
      reasonCodes: ["PRESCRIPTION_INPUT_MISSING", "PRESCRIPTION_PARAMETER_MISSING"],
    });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("HOLD");
  });

  it("fails closed on an explicit unavailable prescription even when required is false", () => {
    const { input, facts } = gateFixture({
      required: false,
      available: false,
      reasonCodes: ["PRESCRIPTION_INPUT_MISSING"],
    });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("FOCUSED_CLARIFICATION");
  });

  it("never discards an out-of-scope clinical result for a non-required goal", () => {
    const { input, facts } = gateFixture({
      required: false,
      available: false,
      reasonCodes: ["PRESCRIPTION_POPULATION_UNSUPPORTED"],
    });
    const result = evaluateAutonomyGate(input, facts);
    expect(result.outcome).toBe("PAUSE_REFER");
    expect(result.orderedReasonCodes).toContain("PRESCRIPTION_POPULATION_UNSUPPORTED");
  });

  it("prescription: null (legacy) -> unchanged behavior, APPROVE_AUTOMATICALLY still reachable", () => {
    const { input, facts } = gateFixture(null);
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("APPROVE_AUTOMATICALLY");
  });

  it("required:true, available:true -> the existing nutrition-safety checks run as before (APPROVE_AUTOMATICALLY)", () => {
    const { input, facts } = gateFixture({ required: true, available: true, reasonCodes: [] });
    expect(evaluateAutonomyGate(input, facts).outcome).toBe("APPROVE_AUTOMATICALLY");
  });
});

// ---------------------------------------------------------------------------
// Synthetic v1 corpus unchanged (T-2003 file item 2 acceptance: "the whole
// existing corpus ... keeps passing without edits to its expectations").
//
// `prescriptionOutcome` is a genuinely new, always-present field (T-2003
// Contract), so a v1 payload's *full* `contentHash` necessarily differs from
// what the pre-T-2033 code produced — that is by design, not a regression.
// What must be byte-identical is everything else. Proven two ways:
//   1. `git diff 6c4487b -- lib/ai-coach/initial-plan.ts` (6c4487b is this
//      branch's merge-base) shows the pre-T-2033 `buildInitialFixturePlan`
//      body moved verbatim into `composeLegacySyntheticPlan`: every field
//      computation (scale/meals/totals/targets/strength/cardio/policyVersion/
//      catalogVersions/decision) is byte-for-byte unchanged; the only new
//      key added to the object passed to `planPayloadSchema.parse` is
//      `prescriptionOutcome`.
//   2. Below: the hash of the payload *excluding* `prescriptionOutcome` is
//      pinned as a golden constant for the exact answer fixtures used by
//      ai-coach-plan-contract.test.ts / ai-coach-representation.test.ts
//      ("A"), ai-coach-weekly-controller.test.ts ("B") and
//      ai-coach-experience.test.ts ("C", which composes with prescriptionId
//      "rx" in MEALS mode). The full (new) hash is also pinned, going
//      forward, as a regression guard against a future accidental change to
//      this now-frozen legacy path.
//
// Review r1 MINOR 8: every `withoutOutcomeHash` literal below is *measured*,
// not argued. It was produced by checking out the pre-T-2033
// `buildInitialFixturePlan` (`git show 6c4487b:lib/ai-coach/initial-plan.ts`)
// into a temporary module and hashing its payload for each row. Output
// (legacyFull == the literal pinned here as withoutOutcomeHash):
//   A MACROS  1c7f680eb3ac7306652fd393256510f8e12682b975f7fd6b0d33e4f96ba2cc4f
//   A MEALS   a455c924bcf0c65506f22f3dd06dcec21db904a9ccb2553ff998940ce7b06235
//   B MACROS  f41c1211d9a980c9cbb89d8e942b723f751e0d54121740ded681b6963d72cecf
//   B MEALS   87d989170162f65b7513d8e507cb7449d49e0d7ea4e0c738a3b30106f7cc6ab5
//   C MEALS   888c050d55ce74a8bebb63d84f905a996842897231d94928ba43d63326b57301
// So this test now fails if the legacy path moves by so much as a byte,
// independently of argument (1).
// ---------------------------------------------------------------------------

describe("T-2033 regression: synthetic v1 corpus is unchanged except the additive prescriptionOutcome field", () => {
  const ANSWERS_A = {
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    dietaryRestrictions: [],
    allergies: [],
    foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    heightCm: 170,
    weightKg: 70,
  };
  const ANSWERS_B = {
    goal: "BODY_COMPOSITION",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 2,
    equipmentAccess: ["NONE"],
    allergies: [],
    dietaryRestrictions: [],
    foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    heightCm: 170,
    weightKg: 70,
  };
  // Verbatim from ai-coach-experience.test.ts:56-72 / :184-200, including its
  // "rx" prescriptionId and MEALS mode — the fourth corpus file the spec named.
  const ANSWERS_C = {
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    allergies: [],
    dietaryRestrictions: [],
    foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    heightCm: 170,
    weightKg: 70,
  };

  it.each([
    [
      "A (plan-contract/representation corpus)",
      ANSWERS_A,
      "golden-rx",
      "MACROS" as const,
      "3d27280a1e0ca039b8754580915bf849b969936a21891fd12e2e4c410f06178e",
      "1c7f680eb3ac7306652fd393256510f8e12682b975f7fd6b0d33e4f96ba2cc4f",
    ],
    [
      "A (plan-contract/representation corpus)",
      ANSWERS_A,
      "golden-rx",
      "MEALS" as const,
      "2c0695febd5d845f4002a279c88750f64804ae7ed35d02c64f3bb2acd32d6704",
      "a455c924bcf0c65506f22f3dd06dcec21db904a9ccb2553ff998940ce7b06235",
    ],
    [
      "B (weekly-controller corpus)",
      ANSWERS_B,
      "golden-rx",
      "MACROS" as const,
      "7c931fa2079ec01f794721bff9ce85c89121805b9970658874a6ee5794e4f147",
      "f41c1211d9a980c9cbb89d8e942b723f751e0d54121740ded681b6963d72cecf",
    ],
    [
      "B (weekly-controller corpus)",
      ANSWERS_B,
      "golden-rx",
      "MEALS" as const,
      "7a92fba8f16ae6dfe57f428d442cf758ca751a95c45f8f8e4b5878171779795f",
      "87d989170162f65b7513d8e507cb7449d49e0d7ea4e0c738a3b30106f7cc6ab5",
    ],
    [
      "C (experience corpus)",
      ANSWERS_C,
      "rx",
      "MEALS" as const,
      "12e47e7b70b30e618e27739ec4aeda5080348bd14bc3dfaa095a059fa66ab359",
      "888c050d55ce74a8bebb63d84f905a996842897231d94928ba43d63326b57301",
    ],
  ] as const)(
    "%s / %s: pinned golden hash, and the hash excluding prescriptionOutcome is the pre-T-2033 hash",
    (_label, answers, prescriptionId, mode, fullHash, withoutOutcomeHash) => {
      const { payload } = buildInitialFixturePlan(answers, prescriptionId, mode);
      expect(contentHash(payload)).toBe(fullHash);
      const rest: Record<string, unknown> = { ...payload };
      delete rest.prescriptionOutcome;
      expect(contentHash(rest)).toBe(withoutOutcomeHash);
    }
  );
});
