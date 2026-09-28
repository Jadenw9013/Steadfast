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

function renderStage(confirmedIntake: unknown, stage: number, draft: unknown = null) {
  return renderToStaticMarkup(
    createElement(IntakeWizard, {
      view: { confirmedIntake, draft },
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
      "Confirm &amp; Build Plan",
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
