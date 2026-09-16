import { describe, it, expect, vi } from "vitest";

/**
 * T-105 — unit coverage for the pure halves of
 * `lib/meal-plans/active-plan.ts`: `deriveMealNames` (mode gate + exact-string
 * de-dup) and `ACTIVE_MEAL_PLAN_ORDER_BY` (the selection precedence).
 *
 * `db` is stubbed out entirely: nothing exercised here touches Postgres, and
 * importing the real singleton would require a live DATABASE_URL. Same hoisted
 * mock style as `tests/unit/prisma-error.test.ts`.
 */
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  ACTIVE_MEAL_PLAN_ORDER_BY,
  deriveMealNames,
  type MealNameEntry,
} from "@/lib/meal-plans/active-plan";

const item = (mealName: string, sortOrder: number) => ({ mealName, sortOrder });

describe("deriveMealNames", () => {
  it("returns item meal names with first-seen sortOrder as `order` in MEAL_PLAN mode", () => {
    const out = deriveMealNames({
      planMode: "MEAL_PLAN",
      items: [item("Breakfast", 0), item("Lunch", 1), item("Dinner", 2)],
      macroTargets: [],
    });
    expect(out).toEqual<MealNameEntry[]>([
      { mealName: "Breakfast", order: 0 },
      { mealName: "Lunch", order: 1 },
      { mealName: "Dinner", order: 2 },
    ]);
  });

  it("returns macro-target names and ignores a non-empty `items` array in MACROS mode", () => {
    // The T-101 coexistence case, and the entire reason this function exists:
    // a MACROS plan carries the previous foods week's items forward by design,
    // so "which array is non-empty" is not a usable signal.
    const out = deriveMealNames({
      planMode: "MACROS",
      items: [item("Breakfast", 0), item("Lunch", 1)],
      macroTargets: [item("Meal 1", 0), item("Meal 2", 1)],
    });
    expect(out).toEqual<MealNameEntry[]>([
      { mealName: "Meal 1", order: 0 },
      { mealName: "Meal 2", order: 1 },
    ]);
    expect(out.map((m) => m.mealName)).not.toContain("Breakfast");
  });

  it("returns [] for a MACROS plan with no targets even when it carries items", () => {
    // The pre-T-102b row shape: mode toggled before any target was entered.
    // Rows exactly like this still exist in production.
    expect(
      deriveMealNames({
        planMode: "MACROS",
        items: [item("Breakfast", 0), item("Lunch", 1)],
        macroTargets: [],
      })
    ).toEqual([]);
  });

  it("returns [] for a MEAL_PLAN plan with no items", () => {
    expect(
      deriveMealNames({
        planMode: "MEAL_PLAN",
        items: [],
        macroTargets: [item("Meal 1", 0)],
      })
    ).toEqual([]);
  });

  it("de-dups repeated names keeping the FIRST-SEEN sortOrder, not the minimum", () => {
    // Three "Breakfast" rows at sortOrder 0, 5, 2. The answer is `order: 0`
    // because 0 was seen first — not because 0 happens to be the minimum. Pin
    // the distinction: a `Math.min` implementation would pass on this input
    // only by coincidence, so the second case below moves the first occurrence.
    expect(
      deriveMealNames({
        planMode: "MEAL_PLAN",
        items: [item("Breakfast", 0), item("Breakfast", 5), item("Breakfast", 2)],
        macroTargets: [],
      })
    ).toEqual([{ mealName: "Breakfast", order: 0 }]);

    expect(
      deriveMealNames({
        planMode: "MEAL_PLAN",
        items: [item("Breakfast", 5), item("Breakfast", 0), item("Breakfast", 2)],
        macroTargets: [],
      })
    ).toEqual([{ mealName: "Breakfast", order: 5 }]);
  });

  it("de-dups on the EXACT string: casing and whitespace are distinct meals", () => {
    // Deliberate, not an oversight. `DailyMealCheckoff` is unique on
    // `(dailyAdherenceId, mealNameSnapshot)` and the checkoff-writing
    // components send `mealName` unmodified, so rows already on disk carry the
    // exact string. Trimming or case-folding here would make this helper
    // disagree with production data. Preventing duplicate-ish names at the
    // editor is T-103's job.
    const out = deriveMealNames({
      planMode: "MACROS",
      items: [],
      macroTargets: [item("Breakfast", 0), item("breakfast", 1), item("Breakfast ", 2)],
    });
    expect(out).toEqual<MealNameEntry[]>([
      { mealName: "Breakfast", order: 0 },
      { mealName: "breakfast", order: 1 },
      { mealName: "Breakfast ", order: 2 },
    ]);
  });

  it("sorts ascending by order when the input arrives out of sortOrder order", () => {
    expect(
      deriveMealNames({
        planMode: "MEAL_PLAN",
        items: [item("Dinner", 2), item("Breakfast", 0), item("Lunch", 1)],
        macroTargets: [],
      })
    ).toEqual<MealNameEntry[]>([
      { mealName: "Breakfast", order: 0 },
      { mealName: "Lunch", order: 1 },
      { mealName: "Dinner", order: 2 },
    ]);
  });
});

describe("ACTIVE_MEAL_PLAN_ORDER_BY", () => {
  it("orders by weekOf first, then publishedAt, then version", () => {
    // `weekOf` in position 0 IS the T-105 fix: a correction published to an
    // earlier week can never outrank a later week, no matter how recently it
    // was published. Demoting it below `publishedAt` reintroduces the exact bug
    // this module exists to close — last week's correction becoming this week's
    // plan and the checkoff list writing last week's `mealNameSnapshot` rows.
    // The two tie-breaks only disambiguate pre-index duplicate PUBLISHED rows
    // for one `(clientId, weekOf)`. This is the only place the precedence is
    // pinned without a database.
    expect(ACTIVE_MEAL_PLAN_ORDER_BY).toEqual([
      { weekOf: "desc" },
      { publishedAt: "desc" },
      { version: "desc" },
    ]);
  });
});
