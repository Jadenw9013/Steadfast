import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanDisplay } from "@/components/ai-coach/plan-display";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { describe, expect, it } from "vitest";
import { AiCoachExperience } from "@/components/ai-coach/experience";
import type { AiWorkspace } from "@/lib/queries/ai-coach";
const initial: AiWorkspace = { schemaVersion: 1, origin: "AI", contextRevision: 1, profileRevision: 1, observationRevision: 0, safetyRevision: 0, confirmedIntake: null, draft: null, reviewTimezone: "America/Los_Angeles", permissions: { nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW" }, safetyDisposition: "CLEAR", activePlan: null, proposals: [], runs: [] };
describe("AI client screen states", () => {
  it("offers swaps only in actionable meal views and includes prepared grocery quantities", () => {
    const plan = buildInitialFixturePlan({ goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 }, "rx", "MEALS").payload;
    const current = renderToStaticMarkup(createElement(PlanDisplay, { plan, onSubstitute: () => undefined }));
    expect(current).toContain("Propose an equivalent swap"); expect(current).toContain("Weekly ingredient quantities");
    expect(renderToStaticMarkup(createElement(PlanDisplay, { plan }))).not.toContain("Propose an equivalent swap");
  });
  it("shows a clear synthetic provider label and intake next step", () => {
    const html = renderToStaticMarkup(createElement(AiCoachExperience, { initial }));
    expect(html).toContain("Steadfast AI Coach"); expect(html).toContain("Synthetic preview"); expect(html).toContain("Complete your intake");
  });
  it("does not present missing safety answers as No", () => {
    const html = renderToStaticMarkup(createElement(AiCoachExperience, { initial, path: ["intake"] }));
    expect(html.match(/value="" selected=""/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain('value="NO" selected');
    expect(html).toContain("Unsure");
  });
  it("labels an unapproved proposal honestly without numerical instructions or an accept action", () => {
    const view = { ...initial, proposals: [{ id: "pending", status: "PENDING_REVIEW", payload: null, expectedBaseVersionId: null, expectedContextRevision: 1, expectedProfileRevision: 1, expectedObservationRevision: 0, expectedSafetyRevision: 0 }] };
    const html = renderToStaticMarkup(createElement(AiCoachExperience, { initial: view, path: ["proposals", "pending"] }));
    expect(html).toContain("awaiting qualified review"); expect(html).not.toContain("Accept proposal"); expect(html).not.toContain("kcal/day");
  });
});
