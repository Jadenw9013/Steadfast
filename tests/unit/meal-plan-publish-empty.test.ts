import { describe, it, expect, vi } from "vitest";

/**
 * T-102b — the two pure pieces of the empty-plan publish guard:
 * `isPlanEmptyForMode` (the single definition of "empty for this mode") and
 * `emptyPlanMessage` (the single copy of the wording all three publish
 * transports return).
 *
 * The service's own behavior around them — check order, the row read, the
 * RACE_LOST fallback — is covered in
 * tests/integration/meal-plan-publish-parity.test.ts against real rows.
 */

// `publish.ts` imports the db singleton at module load; neither function under
// test touches it. Same shape as tests/unit/prisma-error.test.ts's approach of
// stubbing the data layer so no DATABASE_URL validation runs.
vi.mock("@/lib/db", () => ({ db: {} }));

import { isPlanEmptyForMode, emptyPlanMessage } from "@/lib/meal-plans/publish";

describe("isPlanEmptyForMode", () => {
  it("treats a MACROS plan with zero targets as empty even when it carries foods", () => {
    // The T-101 carry-forward interaction, and the exact state the parent
    // ticket found publishable: after T-101 `items` and `macroTargets` coexist
    // on every version, so "some array is non-empty" is NOT the rule.
    expect(isPlanEmptyForMode("MACROS", { items: 12, macroTargets: 0 })).toBe(true);
  });

  it("accepts a MACROS plan with targets and no foods", () => {
    expect(isPlanEmptyForMode("MACROS", { items: 0, macroTargets: 3 })).toBe(false);
  });

  it("treats a MEAL_PLAN plan with zero items as empty even when it carries macro targets", () => {
    // The mirror of the case above.
    expect(isPlanEmptyForMode("MEAL_PLAN", { items: 0, macroTargets: 4 })).toBe(true);
  });

  it("accepts a MEAL_PLAN plan with a single item and no targets", () => {
    expect(isPlanEmptyForMode("MEAL_PLAN", { items: 1, macroTargets: 0 })).toBe(false);
  });

  it("treats a plan with no content at all as empty in both modes", () => {
    expect(isPlanEmptyForMode("MACROS", { items: 0, macroTargets: 0 })).toBe(true);
    expect(isPlanEmptyForMode("MEAL_PLAN", { items: 0, macroTargets: 0 })).toBe(true);
  });
});

describe("emptyPlanMessage", () => {
  it("returns the frozen mode-specific sentences", () => {
    expect(emptyPlanMessage("MACROS")).toBe(
      "Add at least one meal with macro targets before publishing."
    );
    expect(emptyPlanMessage("MEAL_PLAN")).toBe("Add at least one food before publishing.");
  });

  it("says something different in each mode", () => {
    expect(emptyPlanMessage("MACROS")).not.toBe(emptyPlanMessage("MEAL_PLAN"));
  });

  it("stays under iOS's 300-character userFacingErrorMessage cutoff", () => {
    // APIService.swift `userFacingErrorMessage` returns the `error` key verbatim
    // only while it is <= 300 characters; past that the coach gets a generic
    // string instead of the actionable sentence.
    expect(emptyPlanMessage("MACROS").length).toBeLessThanOrEqual(300);
    expect(emptyPlanMessage("MEAL_PLAN").length).toBeLessThanOrEqual(300);
  });
});
