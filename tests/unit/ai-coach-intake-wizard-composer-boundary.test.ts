import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildConfirmPayload,
  createIntakeSelections,
  type IntakeSelections,
} from "@/components/ai-coach/intake-wizard";
import {
  applyIntakeV2ConfirmDefaults,
  intakeAnswersSchema,
  intakeV2ConfirmSchema,
  type IntakeAnswers,
} from "@/lib/ai-coach/intake-contract";
import {
  deriveLegacyAllergyTokens,
  deriveLegacyDietaryRestrictions,
} from "@/lib/ai-coach/intake-allergens";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import type {
  EscalationTemplatesContent,
  PolicyBundleContent,
} from "@/lib/ai-coach/artifacts/schema";
import {
  enableDraftExerciseCatalog,
  disableDraftExerciseCatalog,
} from "@/lib/ai-coach/catalog/draft-exercise-catalog";
import { trainingCatalogSourceFromDraftFile } from "@/lib/ai-coach/training/catalog-source";
import { composeTraining } from "@/lib/ai-coach/training/index";
import { resolveTrainingParameters } from "@/lib/ai-coach/training/parameters";
import type {
  ResolvedTrainingParameters,
  TrainingCatalogSource,
} from "@/lib/ai-coach/training/types";
import {
  buildSyntheticExplanationTexts,
  buildSyntheticPrescriptionBundle,
  buildSyntheticSafetyFloors,
} from "../helpers/ai-prescription-bundle";
import { resolvePrescriptionParameters } from "@/lib/ai-coach/prescription/parameters";
import { computePrescription } from "@/lib/ai-coach/prescription/index";
import { buildPrescriptionInput } from "@/lib/ai-coach/prescription/inputs";

/**
 * T-2055 item 3 (T-2028 r3 MINOR 2) — what the wizard confirms is what the
 * training composer and prescription engine read. `storedFromConfirm` mirrors
 * `confirmIntake` in `lib/ai-coach/intake.ts` (defaults, schema parse, derived
 * legacy projections, `capturedAt`) without the database.
 */

function completeSelections(patch: Partial<IntakeSelections> = {}): IntakeSelections {
  return {
    goal: "FAT_LOSS",
    goalPace: "GRADUAL",
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

function storedFromConfirm(selections: IntakeSelections): IntakeAnswers {
  const payload = buildConfirmPayload(selections);
  const parsed = intakeV2ConfirmSchema.parse(applyIntakeV2ConfirmDefaults(payload));
  return intakeAnswersSchema.parse({
    ...parsed,
    capturedAt: "2026-09-27T12:00:00.000Z",
    allergies: deriveLegacyAllergyTokens(parsed.allergenDeclarations),
    dietaryRestrictions: deriveLegacyDietaryRestrictions(parsed.dietaryPattern),
  });
}

describe("T-2055 item 3 — wizard confirm payload at the training composer boundary", () => {
  let catalog: TrainingCatalogSource;
  let params: ResolvedTrainingParameters;
  let effortText: { strength: string; cardio: string };

  beforeAll(() => {
    enableDraftExerciseCatalog();
    catalog = trainingCatalogSourceFromDraftFile();
    const set = buildSyntheticArtifactSet();
    const escalation = set.escalationTemplates.content as EscalationTemplatesContent;
    if (!("templates" in escalation)) throw new Error("fixture shape changed");
    const resolved = resolveTrainingParameters(
      set.policyBundle.content as PolicyBundleContent,
      escalation.templates.map((t) => ({ id: t.id, text: t.nextStepText }))
    );
    if (!resolved.ok) throw new Error("Synthetic parameter resolution failed");
    params = resolved.parameters;
    effortText = resolved.effortText;
  });

  afterAll(() => {
    disableDraftExerciseCatalog();
  });

  // Exact field mapping of `lib/ai-coach/initial-plan.ts` composeTraining call.
  function compose(answers: IntakeAnswers) {
    return composeTraining(params, catalog, effortText, {
      intakeVersion: 2,
      trainingDaysPerWeek: answers.trainingDaysPerWeek,
      equipmentAccess: answers.equipmentAccess,
      experienceLevel: answers.experienceLevel,
      sessionLengthBand: answers.sessionLengthBand ?? null,
      trainingContextStatus: answers.trainingContextStatus ?? null,
      energyReducedRelativeToMaintenance: null,
      activeContraindicationRuleIds: [],
    });
  }

  it("answered current training composes a plan", () => {
    const result = compose(storedFromConfirm(completeSelections({ currentTraining: "REGULAR" })));
    expect(result.status).toBe("COMPOSED");
    if (result.status !== "COMPOSED") return;
    expect(result.strength.length).toBeGreaterThan(0);
  });

  it("unanswered current training is TRAINING_INPUT_MISSING", () => {
    const result = compose(storedFromConfirm(completeSelections({ currentTraining: undefined })));
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status !== "UNAVAILABLE") return;
    expect(result.reasonCodes).toEqual(["TRAINING_INPUT_MISSING"]);
    expect(result.missingInputs).toContain("trainingContextStatus");
  });

  it("an OVER_90 seed composes with the band preserved", () => {
    const seeded = createIntakeSelections({
      trainingContextStatus: "CONFIRMED",
      resistanceTrainingContext: "REGULAR",
      sessionLengthBand: "OVER_90",
    });
    const answers = storedFromConfirm(
      completeSelections({
        currentTraining: seeded.currentTraining,
        sessionLength: seeded.sessionLength,
        storedSessionLengthBand: seeded.storedSessionLengthBand,
      })
    );
    expect(answers.sessionLengthBand).toBe("OVER_90");
    expect(compose(answers).status).toBe("COMPOSED");
  });
});

describe("T-2055 item 1 — wizard pace at the prescription boundary", () => {
  function prescribe(answers: unknown, evaluatedOn: string) {
    const resolved = resolvePrescriptionParameters(
      buildSyntheticPrescriptionBundle(),
      buildSyntheticExplanationTexts(),
      buildSyntheticSafetyFloors()
    );
    if (!resolved.ok) throw new Error("Synthetic prescription parameters failed to resolve");
    const built = buildPrescriptionInput(answers, evaluatedOn);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("buildPrescriptionInput failed");
    return { input: built.input, result: computePrescription(resolved.parameters, built.input) };
  }

  it("wizard-only answers carry the chosen pace but stay PRESCRIPTION_INPUT_MISSING (G01 pending)", () => {
    const selections = completeSelections({ goalPace: "GRADUAL", currentTraining: "REGULAR" });
    const { input, result } = prescribe(storedFromConfirm(selections), selections.weightMeasuredOn);
    expect(input.goalPaceClass).toBe("GRADUAL");
    expect(input.energyMethodPopulationCategory).toBeNull();
    expect(input.physicalActivityCategory).toBeNull();
    expect(result.reasonCodes).toContain("PRESCRIPTION_INPUT_MISSING");
  });

  // SYNTHETIC: population and activity are injected after the wizard purely to
  // reach the pace step of the engine. The wizard never asks or writes them.
  function withSyntheticPopulationAndActivity(answers: IntakeAnswers) {
    return {
      ...answers,
      energyMethodPopulationCategoryStatus: "CONFIRMED",
      energyMethodPopulationCategory: "MALE_ADULT",
      physicalActivityCategoryStatus: "CONFIRMED",
      physicalActivityCategory: "LOW_ACTIVE",
    };
  }

  it("SYNTHETIC: pace UNDECIDED reaches PRESCRIPTION_GOAL_PACE_UNDECIDED", () => {
    const selections = completeSelections({ goalPace: "UNDECIDED", currentTraining: "REGULAR" });
    const { result } = prescribe(
      withSyntheticPopulationAndActivity(storedFromConfirm(selections)),
      selections.weightMeasuredOn
    );
    expect(result.reasonCodes).toEqual(["PRESCRIPTION_GOAL_PACE_UNDECIDED"]);
  });

  it("SYNTHETIC: pace GRADUAL clears both the undecided and missing-input reasons", () => {
    const selections = completeSelections({ goalPace: "GRADUAL", currentTraining: "REGULAR" });
    const { result } = prescribe(
      withSyntheticPopulationAndActivity(storedFromConfirm(selections)),
      selections.weightMeasuredOn
    );
    expect(result.reasonCodes).not.toContain("PRESCRIPTION_GOAL_PACE_UNDECIDED");
    expect(result.reasonCodes).not.toContain("PRESCRIPTION_INPUT_MISSING");
  });
});
