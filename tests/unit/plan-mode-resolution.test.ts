import { describe, it, expect, vi } from "vitest";

/**
 * T-102a — the frozen editor-mode rule, in isolation.
 *
 * `resolveEditorPlanMode` is the ONE place `draft?.planMode ?? clientPlanMode`
 * is written (lib/meal-plans/plan-mode.ts). It must be pure: an empty `db` mock
 * proves the module resolves a mode without touching the database, which is why
 * both the web query and the REST route can call it from inside a `Promise.all`
 * without ordering constraints.
 */
vi.mock("@/lib/db", () => ({ db: {} }));

import { resolveEditorPlanMode } from "@/lib/meal-plans/plan-mode";

describe("resolveEditorPlanMode", () => {
  it("lets the draft's mode win over the client default", () => {
    expect(resolveEditorPlanMode("MACROS", "MEAL_PLAN")).toBe("MACROS");
  });

  it("lets the draft's mode win even when it disagrees with the client default", () => {
    expect(resolveEditorPlanMode("MEAL_PLAN", "MACROS")).toBe("MEAL_PLAN");
  });

  it("falls back to the client default when there is no draft", () => {
    expect(resolveEditorPlanMode(null, "MACROS")).toBe("MACROS");
    expect(resolveEditorPlanMode(undefined, "MACROS")).toBe("MACROS");
    expect(resolveEditorPlanMode(null, "MEAL_PLAN")).toBe("MEAL_PLAN");
    expect(resolveEditorPlanMode(undefined, "MEAL_PLAN")).toBe("MEAL_PLAN");
  });

  it("never reads the published plan's mode — there is no third argument", () => {
    // Guards the review focus in the spec: computing the editor mode from
    // `draft ?? published` would silently restore the pre-T-102a behavior.
    expect(resolveEditorPlanMode.length).toBe(2);
  });

  it("is pure — resolving a mode touches no database client", () => {
    // `db` is mocked as `{}`; any property access on it would throw here.
    expect(() => resolveEditorPlanMode(null, "MACROS")).not.toThrow();
    expect(() => resolveEditorPlanMode("MACROS", "MEAL_PLAN")).not.toThrow();
  });
});
