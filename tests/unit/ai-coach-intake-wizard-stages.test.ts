import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createIntakeSelections, IntakeWizard } from "@/components/ai-coach/intake-wizard";

const noopAct = async (work: () => Promise<unknown>) => {
  await work();
};
const noopCommand = async () => ({});
const noopPost = async () => ({});

const v1ConfirmedIntake = {
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE"],
  allergies: [],
  dietaryRestrictions: [],
  foodBudgetLevel: "LOW",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
};

const fullV2ConfirmedIntake = {
  intakeVersion: 2,
  goal: "BODY_COMPOSITION",
  experienceLevel: "EXPERIENCED",
  trainingDaysPerWeek: 5,
  equipmentAccess: ["FULL_GYM"],
  foodBudgetLevel: "FLEXIBLE",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
  ageStatus: "CONFIRMED",
  ageYears: 31,
  energyMethodPopulationCategoryStatus: "UNKNOWN",
  physicalActivityCategoryStatus: "UNKNOWN",
  bodyMeasurementStatus: "CONFIRMED",
  heightCm: 180,
  weightKg: 82,
  weightMeasuredOn: "2026-09-20",
  goalStatus: "CONFIRMED",
  bodyWeightIntent: "GAIN",
  goalPaceClass: "GRADUAL",
  weightNeutralAccepted: true,
  trainingContextStatus: "CONFIRMED",
  resistanceTrainingContext: "REGULAR",
  sessionLengthBand: "MIN_45_60",
  cookingAccessStatus: "UNKNOWN",
  dislikes: [{ label: "cilantro", canonicalFoodId: null }],
  cuisinePreferences: ["Thai", "Mexican"],
  allergenDeclarations: {
    status: "CONFIRMED",
    noKnownAllergens: false,
    items: [
      {
        category: "TREE_NUT",
        specificity: "cashew",
        kind: "ALLERGY",
        crossContactAvoidanceRequired: "YES",
      },
    ],
  },
  dietaryPattern: {
    pattern: "OTHER",
    otherLabel: "High protein",
    mandatory: false,
    reason: "PREFERENCE",
    status: "CONFIRMED",
  },
};

const STAGE_HEADINGS = [
  "What are we building toward?",
  "Set up your training week",
  "Make nutrition fit your style",
  "Last step: your starting stats",
];

function renderStage(
  confirmedIntake: unknown,
  stage: number,
  draft: unknown = null,
  // S-19: whether an AiSafetyDisclosureEvent row exists. Defaults to the state
  // a client reaches by finishing the wizard (a confirmed intake always has
  // one), so every case below keeps its original meaning; the disagreement
  // between the two is exercised explicitly further down.
  safetyDisclosureCompleted: boolean = confirmedIntake !== null
) {
  return renderToStaticMarkup(
    createElement(IntakeWizard, {
      view: { confirmedIntake, draft, safetyDisclosureCompleted },
      busy: false,
      act: noopAct,
      command: noopCommand,
      post: noopPost,
      initialStage: stage,
    })
  );
}

describe("T-2028 four-step intake wizard rendering", () => {
  for (const [label, confirmedIntake] of [
    ["null (never confirmed)", null],
    ["v1", v1ConfirmedIntake],
    ["v2", fullV2ConfirmedIntake],
  ] as const) {
    for (let stage = 0; stage < 4; stage += 1) {
      it(`renders step ${stage + 1} for confirmedIntake = ${label}`, () => {
        const html = renderStage(confirmedIntake, stage);
        expect(html).toContain(STAGE_HEADINGS[stage]);
        expect(html).toContain(`${stage + 1} / 4`);
      });
    }
  }

  it("shows all requested tap targets and no retired clinical questionnaire labels", () => {
    const allStages = STAGE_HEADINGS.map((_, stage) => renderStage(null, stage)).join("\n");

    for (const label of [
      "Fat Loss / Cut",
      "Build Muscle",
      "Strength",
      "General Fitness",
      "Beginner",
      "Intermediate",
      "Advanced",
      "Bodyweight",
      "Home Dumbbells",
      "Full Gym",
      "30–45m",
      "45–60m",
      "60m+",
      "Balanced",
      "High Protein",
      "Plant-Based",
      "Low Carb",
      "Portions",
      "Exact Macros",
      "Dairy",
      "Tree Nuts",
      "Peanuts",
      "Gluten",
      "Shellfish",
      // S-19 dead end 2: the button confirms the intake; it does not enrol
      // and does not build a plan, so it no longer claims to.
      "Confirm my answers",
    ]) {
      expect(allStages).toContain(label);
    }
    expect(allStages).not.toContain("Population category");
    expect(allStages).not.toContain("Physical activity category");
    expect(allStages).not.toContain("Cross-contact");
    expect(allStages).not.toContain("Cooking and storage");
  });

  it("does not greet an untouched step with validation warnings", () => {
    const html = renderStage(null, 0);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("A couple of choices are still needed");
  });

  it("keeps the required safety gate compact for new intake and does not repeat it during edits", () => {
    expect(renderStage(null, 3)).toContain("None of these apply");
    expect(renderStage(null, 3)).toContain("Something applies or I’m unsure");
    expect(renderStage(fullV2ConfirmedIntake, 3)).not.toContain("Quick safety check");
  });

  it("S-19: asks the safety questions whenever no disclosure row exists, confirmed intake or not", () => {
    // The 422 CONFIRM_INTAKE raises ("Complete the safety questions first.")
    // is keyed on the disclosure row, so the wizard has to be too. A profile
    // with a confirmed intake and no disclosure row used to skip the step and
    // then take that 422 with no way to satisfy it.
    expect(renderStage(fullV2ConfirmedIntake, 3, null, false)).toContain("Quick safety check");
    expect(renderStage(fullV2ConfirmedIntake, 3, null, false)).toContain("None of these apply");
    // And the mirror: no confirmed intake but a disclosure already recorded
    // (e.g. a reviewer resolution) does not ask again.
    expect(renderStage(null, 3, null, true)).not.toContain("Quick safety check");
  });

  it("S-19: warns before a second pass changes allergy answers, and not on a first pass", () => {
    const secondPass = renderStage(fullV2ConfirmedIntake, 2);
    expect(secondPass).toContain("Your intake is already confirmed.");
    expect(secondPass).toContain("nutrition recommendations are paused");
    expect(renderStage(null, 2)).not.toContain("Your intake is already confirmed.");
  });

  it("S-19: the confirm step says what the button does and what is left", () => {
    const confirmStep = renderStage(null, 3);
    expect(confirmStep).not.toContain("Confirm &amp; Build Plan");
    expect(confirmStep).not.toContain("Building your plan");
    expect(confirmStep).toContain("Confirm my answers");
    expect(confirmStep).toContain("review the AI coaching disclosure and give consent");
  });
});

describe("T-2028 hydration preserves prior answers underneath a partial draft", () => {
  it("layers draft changes over the confirmed intake without emptying other steps", () => {
    const selections = createIntakeSelections({
      ...fullV2ConfirmedIntake,
      trainingDaysPerWeek: 2,
    });

    expect(selections).toMatchObject({
      goal: "BUILD_MUSCLE",
      experience: "ADVANCED",
      trainingDaysPerWeek: 2,
      equipment: "FULL_GYM",
      sessionLength: "MIN_45_60",
      dietaryStyle: "HIGH_PROTEIN",
      trackingStyle: "EXACT_MACROS",
      allergens: ["TREE_NUTS"],
      heightCm: 180,
      weightKg: 82,
      ageYears: 31,
    });
  });
});
