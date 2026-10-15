import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveClientPlanView,
  isCheckoffEligible,
  seedSelectedDay,
  deriveCheckoffNames,
  DEGRADED_NOTICE,
  CHECKOFFS_PAUSED_HINT,
  logDegradedPlanRender,
  type ClientPlanView,
} from "@/lib/meal-plans/client-plan-view";

/**
 * T-802a — unit coverage for the pure resolver that decides which body the
 * client's plan screen renders. No mocks needed: the module is pure, no `db`
 * import, no `next/*` import (same style as `tests/unit/active-plan.test.ts`).
 */

describe("resolveClientPlanView — T-802 §4 truth table", () => {
  it("row 1: MACROS with targets renders the macro body, undegraded", () => {
    expect(
      resolveClientPlanView({ planMode: "MACROS", itemCount: 3, macroTargetCount: 2 })
    ).toEqual<ClientPlanView>({ body: "MACROS", degradation: "NONE" });
  });

  it("T-800: MACROS with zero targets and items renders the foods body", () => {
    // The production incident: a foods editor created a new version without
    // an explicit planMode, it fell through to a stale CoachClient default of
    // MACROS, and every client-facing reader rendered a blank screen for a
    // plan that plainly had food in it. This is the hotfix's rule
    // (`isMislabeledMacroPlan` in `lib/meal-plans/display-mode.ts` on
    // `hotfix/T-800-publish-plan-mode`) — row 2 of the truth table.
    expect(
      resolveClientPlanView({ planMode: "MACROS", itemCount: 2, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" });
  });

  it("row 3: MACROS with zero targets and zero items renders EMPTY", () => {
    expect(
      resolveClientPlanView({ planMode: "MACROS", itemCount: 0, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "EMPTY", degradation: "NONE" });
  });

  it("row 4: MEAL_PLAN with items renders the foods body, undegraded", () => {
    expect(
      resolveClientPlanView({ planMode: "MEAL_PLAN", itemCount: 2, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "FOODS", degradation: "NONE" });
  });

  it("row 5: MEAL_PLAN with zero items but macro targets renders the macro body (T-802's symmetric extension)", () => {
    // The mirror of T-800's rule (T-802 §4.1): declared foods, zero items,
    // non-empty macroTargets is the same blank-screen defect in the other
    // direction, reachable from the same carry-forward legacy data.
    expect(
      resolveClientPlanView({ planMode: "MEAL_PLAN", itemCount: 0, macroTargetCount: 2 })
    ).toEqual<ClientPlanView>({ body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" });
  });

  it("row 6: MEAL_PLAN with zero items and zero targets renders EMPTY", () => {
    expect(
      resolveClientPlanView({ planMode: "MEAL_PLAN", itemCount: 0, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "EMPTY", degradation: "NONE" });
  });

  it("planMode: null behaves as MEAL_PLAN", () => {
    expect(
      resolveClientPlanView({ planMode: null, itemCount: 3, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "FOODS", degradation: "NONE" });
    expect(
      resolveClientPlanView({ planMode: null, itemCount: 0, macroTargetCount: 3 })
    ).toEqual<ClientPlanView>({ body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" });
  });

  it("planMode: undefined behaves as MEAL_PLAN", () => {
    expect(
      resolveClientPlanView({ planMode: undefined, itemCount: 3, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "FOODS", degradation: "NONE" });
    expect(
      resolveClientPlanView({ planMode: undefined, itemCount: 0, macroTargetCount: 0 })
    ).toEqual<ClientPlanView>({ body: "EMPTY", degradation: "NONE" });
  });

  it("row 1 wins over degradation even when items also coexist (T-101 carry-forward is NOT degraded)", () => {
    // Targets present must win before any degradation is considered — the
    // truth table is not "whichever array is non-empty".
    expect(
      resolveClientPlanView({ planMode: "MACROS", itemCount: 5, macroTargetCount: 1 })
    ).toEqual<ClientPlanView>({ body: "MACROS", degradation: "NONE" });
  });
});

describe("isCheckoffEligible — T-802a review r2, MAJOR 1 (degraded states are read-only)", () => {
  it("row 2: MACROS_WITHOUT_TARGETS is NOT eligible", () => {
    expect(isCheckoffEligible({ body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" })).toBe(false);
  });

  it("row 5: FOODS_WITHOUT_ITEMS is NOT eligible", () => {
    expect(isCheckoffEligible({ body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" })).toBe(false);
  });

  it("undegraded FOODS and MACROS bodies ARE eligible", () => {
    expect(isCheckoffEligible({ body: "FOODS", degradation: "NONE" })).toBe(true);
    expect(isCheckoffEligible({ body: "MACROS", degradation: "NONE" })).toBe(true);
  });

  it("EMPTY (always undegraded) is eligible — never reached in practice since there is nothing to check off", () => {
    expect(isCheckoffEligible({ body: "EMPTY", degradation: "NONE" })).toBe(true);
  });
});

describe("seedSelectedDay — T-802a review r2, MAJOR 2", () => {
  it("prefers the server's todayWeekday when present", () => {
    expect(seedSelectedDay("Tuesday", () => "Monday")).toBe("Tuesday");
  });

  it("falls back to the browser-clock guess only when todayWeekday is absent", () => {
    expect(seedSelectedDay(undefined, () => "Monday")).toBe("Monday");
  });
});

describe("DEGRADED_NOTICE", () => {
  it("deep-equals the frozen copy, byte-identical to iOS's T-802b strings", () => {
    expect(DEGRADED_NOTICE).toEqual({
      MACROS_WITHOUT_TARGETS:
        "Showing the foods your coach saved for this week. Macro targets haven't been set yet.",
      FOODS_WITHOUT_ITEMS:
        "Showing this week's macro targets. Your coach hasn't added foods yet.",
    });
  });
});

describe("CHECKOFFS_PAUSED_HINT — T-802a review r3, MINOR 3", () => {
  it("pins the frozen second hint line, byte-identical to iOS's T-802b string", () => {
    expect(CHECKOFFS_PAUSED_HINT).toBe(
      "Meal check-offs are paused until your coach updates this plan."
    );
  });
});

describe("deriveCheckoffNames — T-802a review r3, MINOR 1", () => {
  it("row 2 (MACROS_WITHOUT_TARGETS, FOODS body): empty regardless of what's passed", () => {
    const view: ClientPlanView = { body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" };
    expect(deriveCheckoffNames(view, ["Breakfast", "Lunch"], [])).toEqual([]);
  });

  it("row 5 (FOODS_WITHOUT_ITEMS, MACROS body): empty regardless of what's passed", () => {
    const view: ClientPlanView = { body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" };
    expect(deriveCheckoffNames(view, [], ["Meal 1", "Meal 2"])).toEqual([]);
  });

  it("row 1 (MACROS, undegraded): returns the macro names, ignores foodsNames", () => {
    const view: ClientPlanView = { body: "MACROS", degradation: "NONE" };
    expect(deriveCheckoffNames(view, ["Breakfast"], ["Meal 1", "Meal 2"])).toEqual([
      "Meal 1",
      "Meal 2",
    ]);
  });

  it("row 4 (FOODS, undegraded): returns the foods names, ignores macroNames", () => {
    const view: ClientPlanView = { body: "FOODS", degradation: "NONE" };
    expect(deriveCheckoffNames(view, ["Breakfast", "Lunch"], ["Meal 1"])).toEqual([
      "Breakfast",
      "Lunch",
    ]);
  });

  it("exact-string de-dupe: repeated names collapse, first-occurrence order preserved", () => {
    const view: ClientPlanView = { body: "FOODS", degradation: "NONE" };
    expect(deriveCheckoffNames(view, ["Breakfast", "Lunch", "Breakfast"], [])).toEqual([
      "Breakfast",
      "Lunch",
    ]);
  });

  it("exact-string de-dupe is case-sensitive and does not trim — no case folding", () => {
    const view: ClientPlanView = { body: "MACROS", degradation: "NONE" };
    expect(deriveCheckoffNames(view, [], ["Meal 1", "meal 1", " Meal 1"])).toEqual([
      "Meal 1",
      "meal 1",
      " Meal 1",
    ]);
  });
});

describe("logDegradedPlanRender", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("emits nothing when degradation is NONE", () => {
    logDegradedPlanRender({
      mealPlanId: "plan-1",
      planMode: "MACROS",
      itemCount: 0,
      macroTargetCount: 2,
      view: { body: "MACROS", degradation: "NONE" },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits exactly one console.warn with exactly the frozen key set when degraded", () => {
    logDegradedPlanRender({
      mealPlanId: "plan-2",
      planMode: "MACROS",
      itemCount: 3,
      macroTargetCount: 0,
      view: { body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = warnSpy.mock.calls[0];
    expect(message).toBe("[client-plan] degraded render");
    // Pin the key set so nobody adds a client id or a meal name later.
    expect(Object.keys(payload as object).sort()).toEqual(
      ["degradation", "items", "macroTargets", "mealPlanId", "planMode"].sort()
    );
    expect(payload).toEqual({
      mealPlanId: "plan-2",
      planMode: "MACROS",
      items: 3,
      macroTargets: 0,
      degradation: "MACROS_WITHOUT_TARGETS",
    });
  });
});
