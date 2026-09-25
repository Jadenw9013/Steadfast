import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanDisplay } from "@/components/ai-coach/plan-display";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { describe, expect, it } from "vitest";
import { AiCoachExperience } from "@/components/ai-coach/experience";
import type { AiWorkspace } from "@/lib/queries/ai-coach";
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
  permissions: { nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW" },
  safetyDisposition: "CLEAR",
  activePlan: null,
  proposals: [],
  runs: [],
};
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
  it("does not present missing safety answers as No", () => {
    const html = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial, path: ["intake"] })
    );
    expect(html.match(/value="" selected=""/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain('value="NO" selected');
    expect(html).toContain("Unsure");
  });
  it("T-2024: the intake wizard renders stage 1 and never throws, whether confirmedIntake is null, v1 or v2", () => {
    const stage1 = renderToStaticMarkup(
      createElement(AiCoachExperience, { initial, path: ["intake"] })
    );
    expect(stage1).toContain("1. Eligibility and safety");
    expect(stage1).toContain("Continue");

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
    expect(v2Html).toContain("1. Eligibility and safety");
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
