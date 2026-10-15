import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  confirmAndRedirect,
  createIntakeSelections,
  IntakeWizard,
} from "@/components/ai-coach/intake-wizard";
import { canonicalDeclarations } from "@/lib/ai-coach/intake-allergens";
import { contentHash } from "@/lib/ai-coach/canonical-json";

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

  it("T-2008/S-33: invents no clinical claim — no DRI equation, no protein-ratio number, no named screening instrument", () => {
    const allStages = STAGE_HEADINGS.map((_, stage) => renderStage(null, stage)).join("\n");

    expect(allStages).not.toContain("clinical DRI equations");
    expect(allStages).not.toContain("≥2.0g/kg");
    expect(allStages).not.toContain("PAR-Q");
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

describe("T-2028 r2 review fixes — rendering", () => {
  // Restores the regression deleted in 4135539 ("does not present missing
  // safety answers as No"), rewritten for the four-step flow (finding 4).
  it("does not present missing safety answers as No", () => {
    const html = renderStage(null, 3, null, false);
    const labels = [
      "Chest pain during exercise",
      "Dizziness or fainting",
      "A known heart condition",
      "Pregnant or postpartum",
      "A recent injury or surgery",
      "An age-related eligibility concern",
      "An eating-disorder history or concern",
      "Type 1 diabetes",
    ];
    const oneTap = html.indexOf("None of these apply</span>");
    expect(oneTap).toBeGreaterThan(-1);
    // Every condition is visible text before the one-tap No can be pressed.
    for (const label of labels) {
      const at = html.indexOf(label);
      expect(at, label).toBeGreaterThan(-1);
      expect(at, label).toBeLessThan(oneTap);
    }
    // Nothing is pre-answered: no safety control starts pressed.
    const safetySection = html.slice(html.indexOf("Quick safety check"));
    expect(safetySection).not.toContain('aria-pressed="true"');
    expect(html).toMatch(/aria-describedby="intake-safety-conditions" aria-pressed="false"/);
  });

  it("finding 1: shows stored allergens no chip can express, read-only with an explicit Remove", () => {
    const seed = {
      ...fullV2ConfirmedIntake,
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
          {
            category: "EGG",
            specificity: null,
            kind: "ALLERGY",
            crossContactAvoidanceRequired: "YES",
          },
          {
            category: "TREE_NUT",
            specificity: "cashew",
            kind: "ALLERGY",
            crossContactAvoidanceRequired: "YES",
          },
        ],
      },
    };
    const html = renderStage(seed, 2);
    expect(html).toContain("Also on file");
    expect(html).toContain("Fish (salmon)");
    expect(html).toContain('aria-label="Remove Fish (salmon)"');
    expect(html).toContain('aria-label="Remove Egg"');
    // The mapped chip keeps its stored detail visible.
    expect(html).toContain("(cashew)");
  });

  it("finding 1: shows a stored mandatory dietary pattern as a requirement, not a blank choice", () => {
    const html = renderStage(
      {
        ...fullV2ConfirmedIntake,
        dietaryPattern: {
          pattern: "VEGAN",
          otherLabel: null,
          mandatory: true,
          reason: "RELIGIOUS_OR_ETHICAL",
          status: "CONFIRMED",
        },
      },
      2
    );
    expect(html).toContain("On file as a requirement:");
    expect(html).toContain("<strong>Vegan</strong>");
    expect(html).toContain("Remove requirement");
  });

  it("finding 5: repeats the pause warning on step 4 for a confirmed intake, not on a first pass", () => {
    const resumed = renderStage(fullV2ConfirmedIntake, 3);
    expect(resumed).toContain("Your intake is already confirmed.");
    expect(resumed).toContain("nutrition recommendations are paused");
    expect(renderStage(null, 3)).not.toContain("Your intake is already confirmed.");
  });
});

describe("T-2028 r2 finding 1/5 — an untouched re-confirm re-sends what is stored", () => {
  it("sends ALLERGIES and CONFIRM_INTAKE with declarations hash-equal to the confirmed ones", async () => {
    const stored = {
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
          category: "MILK",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
        {
          category: "FISH",
          specificity: "salmon",
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "NO",
        },
      ],
    };
    const dietaryPattern = {
      pattern: "LACTO_OVO_VEGETARIAN",
      otherLabel: null,
      mandatory: true,
      reason: "MEDICAL_OR_CLINICIAN_DIRECTED",
      status: "CONFIRMED",
    };
    const selections = createIntakeSelections({
      ...fullV2ConfirmedIntake,
      allergenDeclarations: stored,
      dietaryPattern,
    });
    const command = vi.fn(async (input: Record<string, unknown>) => {
      void input;
      return {};
    });

    await confirmAndRedirect({
      selections,
      safetyAnswers: {},
      needsSafetyDisclosure: false,
      command,
      redirect: vi.fn(),
    });

    const [allergies, confirm] = command.mock.calls.map(([input]) => input);
    // The server's `newConcern` is exactly this comparison (client-commands.ts).
    expect(contentHash(canonicalDeclarations(allergies.allergenDeclarations))).toBe(
      contentHash(canonicalDeclarations(stored))
    );
    const answers = confirm.answers as Record<string, unknown>;
    expect(contentHash(canonicalDeclarations(answers.allergenDeclarations))).toBe(
      contentHash(canonicalDeclarations(stored))
    );
    expect(answers.dietaryPattern).toEqual(dietaryPattern);
    expect(answers.dislikes).toEqual(fullV2ConfirmedIntake.dislikes);
    expect(answers.cuisinePreferences).toEqual(fullV2ConfirmedIntake.cuisinePreferences);
    expect(answers).toMatchObject({
      trainingContextStatus: "CONFIRMED",
      resistanceTrainingContext: "REGULAR",
      sessionLengthBand: "MIN_45_60",
    });
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

describe("T-2008/S-33 the wizard resumes at the first incomplete stage by default", () => {
  function renderDefault(
    confirmedIntake: unknown,
    draft: unknown = null,
    safetyDisclosureCompleted = confirmedIntake !== null
  ) {
    return renderToStaticMarkup(
      createElement(IntakeWizard, {
        view: { confirmedIntake, draft, safetyDisclosureCompleted },
        busy: false,
        act: noopAct,
        command: noopCommand,
        post: noopPost,
        // No `initialStage` — this is the default a real mount uses.
      })
    );
  }

  it("starts a brand-new client at stage 1, not mid-wizard", () => {
    const html = renderDefault(null);
    expect(html).toContain(STAGE_HEADINGS[0]);
    expect(html).toContain("1 / 4");
  });

  it("resumes a v1 intake missing the session-length answer at stage 2", () => {
    // v1ConfirmedIntake has no sessionLengthBand, so stage 1 (index) is the
    // first with an outstanding issue even though stage 0 is fully answered.
    const html = renderDefault(v1ConfirmedIntake);
    expect(html).toContain(STAGE_HEADINGS[1]);
    expect(html).toContain("2 / 4");
  });

  it("resumes a fully-answered confirmed intake at the final stage, not stage 1", () => {
    const html = renderDefault(fullV2ConfirmedIntake);
    expect(html).toContain(STAGE_HEADINGS[3]);
    expect(html).toContain("4 / 4");
  });
});

describe("T-2028 r3 — rendering", () => {
  it("lead decision A: step 2 asks current strength training with exactly the contract options, none pre-selected", () => {
    const html = renderStage(null, 1);
    expect(html).toContain("Current strength training");
    const section = html.slice(
      html.indexOf("Current strength training"),
      html.indexOf("Typical session length")
    );
    for (const label of ["None", "Occasional", "Regular"]) expect(section).toContain(label);
    expect(section.match(/aria-pressed=/g)).toHaveLength(3);
    expect(section).not.toContain('aria-pressed="true"');
    // A stored CONFIRMED answer shows as selected.
    const resumed = renderStage(fullV2ConfirmedIntake, 1);
    const resumedSection = resumed.slice(
      resumed.indexOf("Current strength training"),
      resumed.indexOf("Typical session length")
    );
    expect(resumedSection.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("lead decision B: a v1 seed shows its allergy tokens under Also on file and its restrictions to keep or remove", () => {
    const seed = {
      ...v1ConfirmedIntake,
      allergies: ["kiwi", "Gluten"],
      dietaryRestrictions: ["vegan", "halal"],
    };
    const html = renderStage(seed, 2);
    expect(html).toContain("Also on file");
    expect(html).toContain('aria-label="Remove kiwi"');
    expect(html).toContain("Dietary restrictions from your earlier answers");
    expect(html).toContain("Keep as a requirement: Vegan");
    expect(html).toContain('aria-label="Remove vegan"');
    expect(html).toContain('aria-label="Remove halal"');
    expect(html).toContain("cannot be kept as written");
    // A confirmed v1 client is told that even an unchanged answer is recorded as new.
    expect(html).toContain("saved in an earlier format");
    expect(html).toContain("even if nothing changed");
  });

  it("lead decision B: a v1 token the contract cannot hold verbatim is shown with its own Remove", () => {
    const html = renderStage({ ...v1ConfirmedIntake, allergies: [" padded "] }, 2);
    expect(html).toContain("Earlier entries that cannot be saved as written");
    expect(html).toContain('aria-label="Remove earlier entry padded"');

    // T-2055 item 2: a v1 token over the contract's 80 characters is shown in
    // full, never truncated, and the copy no longer points at chips that
    // cannot hold it.
    const long = "x".repeat(90);
    const longHtml = renderStage({ ...v1ConfirmedIntake, allergies: [long] }, 2);
    expect(longHtml).toContain(`<span class="break-all">${long}</span>`);
    expect(longHtml).toContain(
      "These earlier allergy entries cannot be carried into the new format exactly as written, and no option on this step matches them. We will not shorten or change them for you. If one still applies, contact support before you remove it."
    );
    expect(longHtml).not.toContain("choose the matching");
    expect(longHtml).not.toContain("option above");
  });

  it("lead decision C: step 4 says every confirm cancels a plan being prepared, and no longer that unchanged answers avoid it", () => {
    const html = renderStage(fullV2ConfirmedIntake, 3);
    expect(html).toContain("Confirming again cancels any plan being");
    expect(html).toContain("even if nothing changed");
    expect(html).toContain("If you changed your allergy answers");
    expect(html).not.toContain("do not trigger this");
    expect(renderStage(v1ConfirmedIntake, 3)).toContain("saved in an earlier format");
  });

  it("r2 NIT 6: shows a stored preference the chips cannot express as on file, with a way to change it", () => {
    const html = renderStage(
      {
        ...fullV2ConfirmedIntake,
        dietaryPattern: {
          pattern: "PESCATARIAN",
          otherLabel: null,
          mandatory: false,
          reason: "PREFERENCE",
          status: "CONFIRMED",
        },
      },
      2
    );
    expect(html).toContain("On file as a preference: <strong>Pescatarian</strong>");
    expect(html).toContain("Choose a different style");
    expect(html).not.toContain("Remove requirement");
  });
});

describe("T-2055 — rendering", () => {
  const POPULATION_ACTIVITY_WORDING = ["PENDING_G01", "Physiological", "Activity level", "Low active"];

  it("item 1: step 1 offers Preferred pace for Fat Loss without Maintain, and not for Strength", () => {
    const fatLoss = renderStage(
      {
        ...fullV2ConfirmedIntake,
        bodyWeightIntent: "LOSE",
        goalPaceClass: "MODERATE",
      },
      0
    );
    for (const text of ["Preferred pace", "Gradual", "Moderate", "Undecided"])
      expect(fatLoss).toContain(text);
    expect(fatLoss).not.toContain("Maintain");

    const strength = renderStage(
      {
        ...fullV2ConfirmedIntake,
        goal: "STRENGTH",
        goalStatus: "UNKNOWN",
        bodyWeightIntent: undefined,
        goalPaceClass: undefined,
        weightNeutralAccepted: undefined,
      },
      0
    );
    expect(strength).not.toContain("Preferred pace");

    for (const html of [fatLoss, strength])
      for (const text of POPULATION_ACTIVITY_WORDING) expect(html).not.toContain(text);
  });

  it("item 4: step 2 shows an Under 30m pill only for a stored UNDER_30 band", () => {
    expect(renderStage({ ...fullV2ConfirmedIntake, sessionLengthBand: "UNDER_30" }, 1)).toContain(
      "Under 30m"
    );
    expect(renderStage({ ...fullV2ConfirmedIntake, sessionLengthBand: "MIN_45_60" }, 1)).not.toContain(
      "Under 30m"
    );
  });
});
