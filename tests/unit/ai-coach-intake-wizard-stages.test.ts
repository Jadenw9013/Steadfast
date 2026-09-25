import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntakeWizard } from "@/components/ai-coach/intake-wizard";
import type { AiWorkspace } from "@/lib/queries/ai-coach";

/**
 * T-2024 review round 1, MAJOR 11 — release-safety rule 1 ("nothing
 * user-facing ships without being run"). A five-stage rewrite needs runtime
 * evidence, not just type-check/eslint/unit-shape tests. This is the
 * engineer's rendering-test half of that evidence (ui-qa screenshots the
 * same states separately at 390px in a real browser); it proves every
 * stage renders without throwing for null/v1/v2 `confirmedIntake`, and
 * — the two states that produced BLOCKER 1 — that a draft which only
 * covers one stage never empties a *different* stage's already-confirmed
 * v2 answers ("reload mid-wizard" and "edit one stage of a confirmed v2
 * intake" are the same underlying scenario: a subset draft layered over a
 * full confirmed intake).
 */

const noopAct = async (work: () => Promise<unknown>) => {
  await work();
};
const noopCommand = async () => ({});
const noopPost = async () => ({});

const baseView: AiWorkspace = {
  schemaVersion: 1,
  intakeSchemaVersions: [1, 2],
  experience: { mode: "SYNTHETIC", disclosure: null },
  substitutions: [],
  origin: "AI",
  contextRevision: 1,
  profileRevision: 1,
  observationRevision: 0,
  safetyRevision: 0,
  confirmedIntake: null,
  draft: null,
  reviewTimezone: "America/Los_Angeles",
  permissions: { nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW" },
  safetyDisposition: "CLEAR",
  activePlan: null,
  proposals: [],
  runs: [],
};

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
  goal: "GENERAL_FITNESS",
  experienceLevel: "NEW",
  trainingDaysPerWeek: 5,
  equipmentAccess: ["FULL_GYM"],
  allergies: ["TREE_NUT"],
  dietaryRestrictions: [],
  foodBudgetLevel: "FLEXIBLE",
  trackingPreference: "NUMBERS_VISIBLE",
  unitsPreference: "METRIC",
  capturedAt: "2026-09-20T00:00:00.000Z",
  ageStatus: "CONFIRMED",
  ageYears: 31,
  energyMethodPopulationCategoryStatus: "CONFIRMED",
  energyMethodPopulationCategory: "MALE_ADULT",
  physicalActivityCategoryStatus: "CONFIRMED",
  physicalActivityCategory: "ACTIVE",
  bodyMeasurementStatus: "CONFIRMED",
  heightCm: 180,
  weightKg: 82,
  weightMeasuredOn: "2026-09-20",
  goalStatus: "CONFIRMED",
  bodyWeightIntent: "MAINTAIN",
  goalPaceClass: "MAINTAIN",
  weightNeutralAccepted: true,
  trainingContextStatus: "CONFIRMED",
  resistanceTrainingContext: "REGULAR",
  sessionLengthBand: "MIN_45_60",
  cookingAccessStatus: "CONFIRMED",
  cookingAccess: {
    equipment: ["FULL_KITCHEN"],
    refrigeration: "FRIDGE_AND_FREEZER",
    mealPrepCapacity: "BATCH",
    typicalPrepMinutesBand: "MIN_15_30",
  },
  dislikes: [{ label: "cilantro", canonicalFoodId: null }],
  cuisinePreferences: ["Thai", "Mexican"],
  allergenDeclarations: {
    status: "CONFIRMED",
    noKnownAllergens: false,
    items: [{ category: "TREE_NUT", specificity: "cashew", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
  },
  dietaryPattern: { pattern: "VEGAN", otherLabel: null, mandatory: true, reason: "PREFERENCE", status: "CONFIRMED" },
};

const STAGE_HEADINGS = [
  "1. Eligibility and safety",
  "2. About you",
  "3. Food",
  "4. Training",
  "5. Review",
];

describe("T-2024 intake wizard — every stage renders for null/v1/v2 confirmedIntake", () => {
  for (const [label, confirmedIntake] of [
    ["null (never confirmed)", null],
    ["v1", v1ConfirmedIntake],
    ["v2", fullV2ConfirmedIntake],
  ] as const) {
    for (let stage = 0; stage < 5; stage++) {
      it(`stage ${stage + 1} renders without throwing for confirmedIntake = ${label}`, () => {
        const view: AiWorkspace = { ...baseView, confirmedIntake };
        let html = "";
        expect(() => {
          html = renderToStaticMarkup(
            createElement(IntakeWizard, {
              view,
              busy: false,
              act: noopAct,
              command: noopCommand,
              post: noopPost,
              initialStage: stage,
            })
          );
        }).not.toThrow();
        expect(html).toContain(STAGE_HEADINGS[stage]);
      });
    }
  }
});

describe("T-2024 review round 1 BLOCKER 1 — a one-stage draft over a confirmed v2 intake never empties the other stages", () => {
  // The draft only ever covers the "About you" stage's keys — exactly what
  // a single Continue click on that stage saves. Reloading (or editing just
  // that one stage) must not make the Food/Training stages render empty
  // despite the confirmed row still holding every answer.
  const aboutYouOnlyDraft = {
    intakeVersion: 2,
    ageStatus: "CONFIRMED",
    ageYears: 31,
    energyMethodPopulationCategoryStatus: "CONFIRMED",
    energyMethodPopulationCategory: "MALE_ADULT",
  };
  const view: AiWorkspace = {
    ...baseView,
    confirmedIntake: fullV2ConfirmedIntake,
    draft: aboutYouOnlyDraft,
  };

  it("Food stage (reload-mid-wizard scenario) still shows the confirmed dietary pattern, cuisines and dislikes", () => {
    const html = renderToStaticMarkup(
      createElement(IntakeWizard, {
        view,
        busy: false,
        act: noopAct,
        command: noopCommand,
        post: noopPost,
        initialStage: 2,
      })
    );
    expect(html).toContain('value="VEGAN" selected=""');
    expect(html).toContain('value="Thai, Mexican"');
    expect(html).toContain('value="cilantro"');
    expect(html).toContain('value="FLEXIBLE" selected=""');
  });

  it("Training stage (edit-one-stage-of-a-confirmed-v2-intake scenario) still shows the confirmed days, equipment and cooking access", () => {
    const html = renderToStaticMarkup(
      createElement(IntakeWizard, {
        view,
        busy: false,
        act: noopAct,
        command: noopCommand,
        post: noopPost,
        initialStage: 3,
      })
    );
    expect(html).toContain('value="5"');
    expect(html).toContain('value="REGULAR" selected=""');
    expect(html).toContain('value="MIN_45_60" selected=""');
  });
});
