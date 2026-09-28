import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanDisplay } from "@/components/ai-coach/plan-display";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { describe, expect, it } from "vitest";
import { AiCoachExperience } from "@/components/ai-coach/experience";
import type { AiWorkspace } from "@/lib/queries/ai-coach";
import { formatNumericDisplayValue } from "@/lib/ai-coach/numeric-display";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
const initial: AiWorkspace = {
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
  consentedAt: null,
  permissions: { nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW" },
  safetyDisposition: "CLEAR",
  activePlan: null,
  proposals: [],
  runs: [],
};
describe("T-2030 review r1 MINOR 5 — plan-display uses the same number formatter as the bounded-prose validator", () => {
  it("renders a non-1dp target through formatNumericDisplayValue, not the raw value", () => {
    const plan = planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: "synthetic-rx-formatter-test",
        method: "SYNTHETIC_CATALOG_MATCH",
        targets: { energyKcal: 1314, proteinG: 123.45, carbsG: 100, fatG: 50 },
        tolerancePercent: 5,
        assumptions: ["Synthetic fixture only."],
      },
      meals: null,
      strength: [],
      cardio: [],
      policyVersion: "policy-fixture-v1",
      catalogVersions: { food: "food-fixture-v2", exercise: "exercise-fixture-v1" },
    });
    const html = renderToStaticMarkup(createElement(PlanDisplay, { plan }));
    expect(formatNumericDisplayValue(123.45)).toBe("123.5");
    expect(html).toContain(">123.5 <span");
    expect(html).not.toContain("123.45");
  });
});

describe("AI client screen states", () => {
  it("offers swaps only in actionable meal views and includes prepared grocery quantities", () => {
    const plan = buildInitialFixturePlan(
      {
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
      },
      "rx",
      "MEALS"
    ).payload;
    const current = renderToStaticMarkup(
      createElement(PlanDisplay, {
        plan,
        substitutions: [
          {
            day: 1,
            mealId: plan.meals!.days[0].meals[0].id,
            foodId: "brown-rice-cooked",
            replacementId: "fixture-grain-alternative",
          },
        ],
        onSubstitute: () => undefined,
      })
    );
    expect(current).toContain("Propose an equivalent swap");
    expect(current).toContain("Weekly ingredient quantities");
    expect(renderToStaticMarkup(createElement(PlanDisplay, { plan }))).not.toContain(
      "Propose an equivalent swap"
    );
  });
  it("shows a clear synthetic provider label and intake next step", () => {
    const html = renderToStaticMarkup(createElement(AiCoachExperience, { initial }));
    expect(html).toContain("Steadfast AI Coach");
    expect(html).toContain("Synthetic preview");
    expect(html).toContain("Complete your intake");
  });
  it("T-2028: the intake wizard renders step 1 with interactive cards and never throws, whether confirmedIntake is null, v1 or v2", () => {
    const stage1 = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial, path: ["intake"] })
    );
    expect(stage1).toContain("What are we building toward?");
    expect(stage1).toContain("1 / 4");
    expect(stage1).toContain("Continue");
    expect(stage1).toContain("Fat Loss / Cut");

    const v1Intake = {
      ...initial,
      confirmedIntake: {
        goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [],
        foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC",
      },
    };
    expect(() =>
      renderToStaticMarkup(createElement(AiCoachExperience, { initial: v1Intake, path: ["intake"] }))
    ).not.toThrow();

    const v2Intake = {
      ...initial,
      confirmedIntake: {
        intakeVersion: 2,
        goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [],
        foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC",
        ageStatus: "CONFIRMED", ageYears: 30,
        allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
        dietaryPattern: { pattern: "OMNIVORE", otherLabel: null, mandatory: false, reason: "PREFERENCE", status: "CONFIRMED" },
      },
    };
    const v2Html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: v2Intake, path: ["intake"] })
    );
    expect(v2Html).toContain("What are we building toward?");
    expect(v2Html).toContain("1 / 4");
  });
  it("labels an unfinalized proposal honestly without numerical instructions or an accept action", () => {
    const view = {
      ...initial,
      proposals: [
        {
          id: "pending",
          status: "PENDING_FINALIZATION",
          payload: null,
          authorization: {
            outcome: null,
            reasonCodes: [],
            nextActionTemplateId: null,
            interpretation: null,
            explanation: null,
            clarification: null,
          },
          expectedBaseVersionId: null,
          expectedContextRevision: 1,
          expectedProfileRevision: 1,
          expectedObservationRevision: 0,
          expectedSafetyRevision: 0,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "pending"] })
    );
    expect(html).toContain("Run the server-owned safety");
    expect(html).toContain("Run final safety checks");
    expect(html).not.toContain("Accept proposal");
    expect(html).not.toContain("kcal/day");
  });
});

// T-2030 review r1 MAJOR 4 — the five render states named in the ticket,
// made reachable and asserted against the actual component's SSR output
// (the same `renderToStaticMarkup` harness the rest of this file uses).
// Full-browser pixel screenshots at 320px remain ui-qa's job; this proves
// the states are reachable and render the right content/no empty paragraph.
describe("T-2030 bounded explanation prose — proposal screen render states", () => {
  const fixturePlan = buildInitialFixturePlan(
    {
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
    },
    "rx",
    "MEALS"
  ).payload;

  function proposalWith(overrides: Partial<AiWorkspace["proposals"][number]>) {
    return {
      id: "prop-1",
      status: "READY" as const,
      payload: fixturePlan,
      authorization: {
        outcome: "APPROVE_AUTOMATICALLY" as const,
        reasonCodes: [],
        nextActionTemplateId: null,
        interpretation: null,
        explanation: null,
        clarification: null,
      },
      expectedBaseVersionId: null,
      expectedContextRevision: 1,
      expectedProfileRevision: 1,
      expectedObservationRevision: 0,
      expectedSafetyRevision: 0,
      ...overrides,
    };
  }

  it("(a) accepted prose: renders the validated explanation text under the automated-explanation heading", () => {
    const view: AiWorkspace = {
      ...initial,
      proposals: [
        proposalWith({
          authorization: {
            outcome: "APPROVE_AUTOMATICALLY",
            reasonCodes: [],
            nextActionTemplateId: null,
            interpretation: null,
            explanation: {
              text: "SYNTHETIC FIXTURE: your energy target is 1314 kcal per day.",
              kind: "MODEL_VALIDATED",
            },
            clarification: null,
          },
        }),
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "prop-1"] })
    );
    expect(html).toContain("Automated explanation");
    expect(html).toContain("SYNTHETIC FIXTURE: your energy target is 1314 kcal per day.");
  });

  it("(b) rejected prose falls back to the run's template decision sentence, never an empty paragraph", () => {
    const view: AiWorkspace = {
      ...initial,
      proposals: [proposalWith({})],
      runs: [
        {
          id: "run-1",
          kind: "INITIAL",
          status: "COMPLETED",
          createdAt: new Date().toISOString(),
          resultPlanVersionId: "prop-1",
          decision: {
            action: "HOLD",
            reasonCodes: ["INITIAL_FIXTURE"],
            explanation: "TEMPLATE FIXTURE: your synthetic proposal is ready for review.",
            limitations: [],
            nextAction: "Review the proposal.",
            changeClass: "INITIAL",
          },
          failureMessage: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "prop-1"] })
    );
    expect(html).toContain("Automated explanation");
    expect(html).toContain("TEMPLATE FIXTURE: your synthetic proposal is ready for review.");
    expect(html).not.toMatch(/<p class="mt-1 text-zinc-100"><\/p>/);
  });

  it("(c) no run decision at all: no automated-explanation block, no empty paragraph", () => {
    const view: AiWorkspace = {
      ...initial,
      proposals: [proposalWith({})],
      runs: [],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "prop-1"] })
    );
    expect(html).not.toContain("Automated explanation");
    expect(html).not.toMatch(/<p class="mt-1 text-zinc-100"><\/p>/);
  });

  it("(d) FOCUSED_CLARIFICATION with clarification absent: the template sentence renders, not a blank space", () => {
    const view: AiWorkspace = {
      ...initial,
      proposals: [
        proposalWith({
          status: "FOCUSED_CLARIFICATION",
          payload: null,
          authorization: {
            outcome: "FOCUSED_CLARIFICATION",
            reasonCodes: ["PROVIDER_CLARIFICATION_REQUESTED"],
            nextActionTemplateId: null,
            interpretation: null,
            explanation: null,
            clarification: null,
          },
        }),
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "prop-1"] })
    );
    expect(html).toContain("A specific answer is still required. Your current plan remains unchanged.");
  });

  it("(d-accepted) FOCUSED_CLARIFICATION with validated clarification text: renders the validated text instead of the template", () => {
    const view: AiWorkspace = {
      ...initial,
      proposals: [
        proposalWith({
          status: "FOCUSED_CLARIFICATION",
          payload: null,
          authorization: {
            outcome: "FOCUSED_CLARIFICATION",
            reasonCodes: ["PROVIDER_CLARIFICATION_REQUESTED"],
            nextActionTemplateId: null,
            interpretation: null,
            explanation: null,
            clarification: {
              text: "SYNTHETIC FIXTURE: please confirm your preferred protein source.",
              clarificationId: "SYNTHETIC_CLARIFY_PREFERENCE",
              kind: "MODEL_VALIDATED",
            },
          },
        }),
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "prop-1"] })
    );
    expect(html).toContain("SYNTHETIC FIXTURE: please confirm your preferred protein source.");
    expect(html).not.toContain(
      "A specific answer is still required. Your current plan remains unchanged."
    );
  });

  it("(e) long prose renders intact in a single flowing paragraph (no truncation class, no crash)", () => {
    const longText = `SYNTHETIC FIXTURE: ${"a very long validated explanation sentence about your plan ".repeat(6)}your energy target is 1314 kcal per day.`;
    const view: AiWorkspace = {
      ...initial,
      proposals: [
        proposalWith({
          authorization: {
            outcome: "APPROVE_AUTOMATICALLY",
            reasonCodes: [],
            nextActionTemplateId: null,
            interpretation: null,
            explanation: { text: longText, kind: "MODEL_VALIDATED" },
            clarification: null,
          },
        }),
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial: view, path: ["proposals", "prop-1"] })
    );
    expect(html).toContain(longText);
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("line-clamp");
  });
});
