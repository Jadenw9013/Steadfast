import { describe, it, expect, vi } from "vitest";

/**
 * T-102a (review round 1) — the two coach-editor rules the plan-mode toggle
 * made load-bearing:
 *
 *  1. Finding 1 — toggling plan mode swaps the entire editor and throws away
 *     everything it holds in `useState`. `shouldProceedWithModeSwitch` +
 *     `foodsEditorSignature` / `macroEditorSignature` decide when a coach must
 *     confirm first.
 *  2. Finding 2 — each editor authors exactly one representation, so the draft
 *     it creates must say `planMode` explicitly. The literal now lives in
 *     `buildFoodsDraftInput` / `buildMacroDraftInput`, so deleting it fails
 *     here instead of silently publishing a foods plan labelled MACROS.
 *
 * T-103 extends the same module with the rest of the coach-editor rules:
 * publish-time meal-name validation, the advisory calories-vs-macros check and
 * the macro autofill request/response mapping — plus plan notes, which the
 * macros editor can now author and which therefore had to join
 * `macroEditorSignature` (a required second argument) or the toggle would
 * destroy them.
 *
 * These helpers are pure and DOM-free by construction (this repo has no jsdom /
 * React testing dependency and adding one needs its own ticket), which is why
 * they live in `lib/` rather than inline in the components.
 */

import {
  PLAN_MODE_SWITCH_WARNING,
  VERSION_HISTORY_NAV_WARNING,
  MACRO_CALORIE_TOLERANCE,
  isNewTabOrWindowClick,
  shouldProceedWithModeSwitch,
  shouldProceedWithUnsavedChanges,
  foodsEditorSignature,
  macroEditorSignature,
  buildFoodsDraftInput,
  buildMacroDraftInput,
  findMealNameProblem,
  mealNameProblemMessage,
  derivedCalories,
  macroCalorieMismatch,
  buildAutofillRequest,
  applyMacroEstimates,
  type AutofillSourceItem,
} from "@/lib/meal-plans/editor-state";
import {
  groupItemsToMeals,
  type EditableMacroMeal,
  type MacroMealTarget,
  type MealGroup,
} from "@/types/meal-plan";

const OATS = {
  id: "row-1",
  foodName: "Oats",
  quantity: "80",
  unit: "g",
  servingDescription: "80 g",
  calories: 300,
  protein: 10,
  carbs: 54,
  fats: 5,
};

function mealsWithOats(): MealGroup[] {
  return [{ mealName: "Breakfast", items: [{ ...OATS }] }];
}

// ── Finding 1: the toggle's guard ─────────────────────────────────────────────

describe("shouldProceedWithModeSwitch", () => {
  const confirmYes = () => true;
  const confirmNo = () => false;

  it("switches immediately when there is nothing typed — no dialog at all", () => {
    const confirmDiscard = vi.fn(confirmYes);
    const proceed = shouldProceedWithModeSwitch({
      current: "MEAL_PLAN",
      next: "MACROS",
      pending: false,
      hasUnsavedChanges: false,
      confirmDiscard,
    });
    expect(proceed).toBe(true);
    // Load-bearing: a fresh page load must keep its one-tap toggle.
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("requires a confirmation when there is unsaved content", () => {
    const confirmDiscard = vi.fn(confirmYes);
    const proceed = shouldProceedWithModeSwitch({
      current: "MEAL_PLAN",
      next: "MACROS",
      pending: false,
      hasUnsavedChanges: true,
      confirmDiscard,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(proceed).toBe(true);
  });

  it("does NOT switch when the coach cancels the confirmation", () => {
    const confirmDiscard = vi.fn(confirmNo);
    const proceed = shouldProceedWithModeSwitch({
      current: "MEAL_PLAN",
      next: "MACROS",
      pending: false,
      hasUnsavedChanges: true,
      confirmDiscard,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    // The toggle returns early on false, so `mode` never changes, the editor
    // never unmounts, and the typed content survives.
    expect(proceed).toBe(false);
  });

  it("is a no-op for the already-active mode, even with unsaved content", () => {
    const confirmDiscard = vi.fn(confirmYes);
    expect(
      shouldProceedWithModeSwitch({
        current: "MACROS",
        next: "MACROS",
        pending: false,
        hasUnsavedChanges: true,
        confirmDiscard,
      })
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("ignores clicks while a switch is already in flight", () => {
    const confirmDiscard = vi.fn(confirmYes);
    expect(
      shouldProceedWithModeSwitch({
        current: "MEAL_PLAN",
        next: "MACROS",
        pending: true,
        hasUnsavedChanges: true,
        confirmDiscard,
      })
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("warns about losing work, not about the mode change itself", () => {
    expect(PLAN_MODE_SWITCH_WARNING).toMatch(/unsaved/i);
    expect(PLAN_MODE_SWITCH_WARNING).toMatch(/lost/i);
  });
});

// ── T-801 review finding 1: the Version History link's guard ─────────────────
//
// The link unmounts the editor exactly like a plan-mode switch does, so it
// must be gated by the same underlying rule. These tests pin down the shared
// `shouldProceedWithUnsavedChanges` gate directly (what the link's onClick
// calls) rather than re-deriving `shouldProceedWithModeSwitch`'s mode-specific
// wrapper, which is covered above.

describe("shouldProceedWithUnsavedChanges (shared by the mode toggle and the Version History link)", () => {
  const confirmYes = () => true;
  const confirmNo = () => false;

  it("proceeds immediately when there is nothing typed — no dialog at all", () => {
    const confirmDiscard = vi.fn(confirmYes);
    const proceed = shouldProceedWithUnsavedChanges({
      pending: false,
      hasUnsavedChanges: false,
      confirmDiscard,
    });
    expect(proceed).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("requires confirmation when there is unsaved content, and proceeds on confirm", () => {
    const confirmDiscard = vi.fn(confirmYes);
    const proceed = shouldProceedWithUnsavedChanges({
      pending: false,
      hasUnsavedChanges: true,
      confirmDiscard,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(proceed).toBe(true);
  });

  it("does NOT proceed when the coach cancels the confirmation", () => {
    const confirmDiscard = vi.fn(confirmNo);
    const proceed = shouldProceedWithUnsavedChanges({
      pending: false,
      hasUnsavedChanges: true,
      confirmDiscard,
    });
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    // The link's onClick calls e.preventDefault() on false: navigation must
    // not happen and the editor must stay mounted with its content intact.
    expect(proceed).toBe(false);
  });

  it("ignores a click while an equivalent action is already in flight, without asking", () => {
    const confirmDiscard = vi.fn(confirmYes);
    expect(
      shouldProceedWithUnsavedChanges({
        pending: true,
        hasUnsavedChanges: true,
        confirmDiscard,
      })
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("VERSION_HISTORY_NAV_WARNING warns about losing work, is its own constant distinct from PLAN_MODE_SWITCH_WARNING", () => {
    expect(VERSION_HISTORY_NAV_WARNING).toMatch(/unsaved/i);
    expect(VERSION_HISTORY_NAV_WARNING).toMatch(/lost/i);
    expect(VERSION_HISTORY_NAV_WARNING).not.toBe(PLAN_MODE_SWITCH_WARNING);
  });
});

// ── T-801 review round 2, MINOR 3: the Version History link's new-tab guard ──

const plainClick = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };

describe("isNewTabOrWindowClick (the Version History link skips the whole confirm for these)", () => {
  it("is false for a plain left click — the confirm guard still applies", () => {
    expect(isNewTabOrWindowClick(plainClick)).toBe(false);
  });

  it("is true for cmd/ctrl/shift/alt-click, one modifier at a time", () => {
    expect(isNewTabOrWindowClick({ ...plainClick, metaKey: true })).toBe(true);
    expect(isNewTabOrWindowClick({ ...plainClick, ctrlKey: true })).toBe(true);
    expect(isNewTabOrWindowClick({ ...plainClick, shiftKey: true })).toBe(true);
    expect(isNewTabOrWindowClick({ ...plainClick, altKey: true })).toBe(true);
  });

  it("is true for a non-primary button (e.g. a middle click)", () => {
    expect(isNewTabOrWindowClick({ ...plainClick, button: 1 })).toBe(true);
  });
});

describe("foodsEditorSignature (what the foods editor would lose)", () => {
  const seededItems = [
    {
      mealName: "Breakfast",
      foodName: "Oats",
      quantity: "80",
      unit: "g",
      servingDescription: "80 g",
      calories: 300,
      protein: 10,
      carbs: 54,
      fats: 5,
    },
  ];

  it("is unchanged by the random row ids regenerated on every load", () => {
    // Both calls produce fresh crypto.randomUUID() ids. If ids leaked into the
    // signature, every published week would prompt on its first toggle.
    const a = foodsEditorSignature(groupItemsToMeals(seededItems), null, "");
    const b = foodsEditorSignature(groupItemsToMeals(seededItems), null, "");
    expect(a).toBe(b);
  });

  it("does not flag an untouched published week — the DB row still holds it", () => {
    const seed = groupItemsToMeals(seededItems);
    const baseline = foodsEditorSignature(seed, null, "");
    expect(foodsEditorSignature(seed, null, "")).toBe(baseline);
  });

  it("flags a typed food item", () => {
    const baseline = foodsEditorSignature([], null, "");
    expect(foodsEditorSignature(mealsWithOats(), null, "")).not.toBe(baseline);
  });

  it("flags an edited portion on an existing item", () => {
    const before = mealsWithOats();
    const after = mealsWithOats();
    after[0].items[0].quantity = "120";
    expect(foodsEditorSignature(after, null, "")).not.toBe(
      foodsEditorSignature(before, null, "")
    );
  });

  it("flags a renamed meal that has no items yet", () => {
    const before: MealGroup[] = [{ mealName: "Meal 1", items: [] }];
    const after: MealGroup[] = [{ mealName: "Post-workout", items: [] }];
    expect(foodsEditorSignature(after, null, "")).not.toBe(
      foodsEditorSignature(before, null, "")
    );
  });

  it("flags typed support content", () => {
    expect(foodsEditorSignature([], null, "Drink water")).not.toBe(
      foodsEditorSignature([], null, "")
    );
  });

  it("treats a whitespace-only notes box as empty — matches the write path", () => {
    expect(foodsEditorSignature([], null, "   \n ")).toBe(
      foodsEditorSignature([], null, "")
    );
  });

  it("flags plan extras added from the empty-state CTA", () => {
    expect(foodsEditorSignature([], {}, "")).not.toBe(
      foodsEditorSignature([], null, "")
    );
  });
});

describe("macroEditorSignature (what the macros editor would lose)", () => {
  const target: MacroMealTarget = {
    mealName: "Breakfast",
    calories: 500,
    protein: 40,
    carbs: 50,
    fats: 15,
  };

  it("ignores the client-side row id", () => {
    // What the macros editor actually holds is `EditableMacroMeal[]` — the
    // target plus a `crypto.randomUUID()` row id regenerated on every load. The
    // signature takes the id-free supertype, so passing editor rows straight in
    // (as macro-plan-editor.tsx does) must not leak the id.
    const rowA: EditableMacroMeal = { ...target, id: "a" };
    const rowB: EditableMacroMeal = { ...target, id: "b" };
    expect(macroEditorSignature([rowA], "")).toBe(macroEditorSignature([rowB], ""));
  });

  it("does not flag untouched seeded targets", () => {
    expect(macroEditorSignature([target], "")).toBe(macroEditorSignature([target], ""));
  });

  it("flags an edited macro number", () => {
    expect(macroEditorSignature([{ ...target, protein: 45 }], "")).not.toBe(
      macroEditorSignature([target], "")
    );
  });

  it("flags an added meal row", () => {
    expect(macroEditorSignature([target, { ...target, mealName: "Lunch" }], "")).not.toBe(
      macroEditorSignature([target], "")
    );
  });

  it("flags typed plan notes (T-103)", () => {
    // THE reason the second parameter is required rather than defaulted: the
    // macros editor can now author notes, and without them in the signature the
    // plan-mode toggle would destroy typed notes with no confirmation — the
    // exact data-loss bug T-102a closed for the foods editor.
    expect(macroEditorSignature([target], "Hydrate")).not.toBe(
      macroEditorSignature([target], "")
    );
  });

  it("treats a whitespace-only notes box as empty — matches the write path", () => {
    expect(macroEditorSignature([target], "   \n ")).toBe(
      macroEditorSignature([target], "")
    );
  });
});

// ── Finding 2: each editor stamps its own planMode ────────────────────────────

describe("buildFoodsDraftInput (the foods editor's createDraftMealPlan payload)", () => {
  const args = {
    clientId: "client-1",
    weekStartDate: "2026-09-14",
    meals: mealsWithOats(),
    planExtras: null,
    supportContent: "",
  };

  it("always stamps planMode: MEAL_PLAN", () => {
    // THE regression guard. Without it the draft inherits CoachClient.planMode,
    // so a coach who toggled to MACROS and kept typing foods would publish a
    // foods plan labelled MACROS — invisible to the client (T-102a criterion 3).
    expect(buildFoodsDraftInput(args).planMode).toBe("MEAL_PLAN");
  });

  it("stamps MEAL_PLAN for an empty plan too", () => {
    expect(buildFoodsDraftInput({ ...args, meals: [] }).planMode).toBe("MEAL_PLAN");
  });

  it("sends the typed foods as flat, sorted items", () => {
    const input = buildFoodsDraftInput(args);
    expect(input.items).toEqual([
      expect.objectContaining({ mealName: "Breakfast", foodName: "Oats", sortOrder: 0 }),
    ]);
    expect(input.clientId).toBe("client-1");
    expect(input.weekStartDate).toBe("2026-09-14");
  });

  it("sends an explicit null for an empty notes box, never undefined (T-101)", () => {
    // `undefined` means "not touched" on the create path and carries the
    // previous published plan's notes forward.
    expect(buildFoodsDraftInput({ ...args, supportContent: "" }).supportContent).toBeNull();
    expect(buildFoodsDraftInput({ ...args, supportContent: "  " }).supportContent).toBeNull();
    expect(buildFoodsDraftInput({ ...args, supportContent: "Hydrate" }).supportContent).toBe(
      "Hydrate"
    );
  });

  it("omits planExtras rather than sending null when none are configured", () => {
    expect(buildFoodsDraftInput(args).planExtras).toBeUndefined();
    expect(buildFoodsDraftInput({ ...args, planExtras: {} }).planExtras).toEqual({});
  });
});

describe("buildMacroDraftInput (the macros editor's createDraftMealPlan payload)", () => {
  const args = {
    clientId: "client-1",
    weekStartDate: "2026-09-14",
    meals: [
      { id: "row-1", mealName: "Breakfast", calories: 500, protein: 40, carbs: 50, fats: 15 },
    ],
    supportContent: "",
  };

  it("always stamps planMode: MACROS", () => {
    expect(buildMacroDraftInput(args).planMode).toBe("MACROS");
  });

  it("stamps MACROS for an empty plan too", () => {
    expect(buildMacroDraftInput({ ...args, meals: [] }).planMode).toBe("MACROS");
  });

  it("sends the macro targets with sortOrder and no client-side ids", () => {
    const input = buildMacroDraftInput(args);
    expect(input.macroTargets).toEqual([
      { mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
    ]);
    expect(input.macroTargets[0]).not.toHaveProperty("id");
  });

  it("never sends food items — the two builders are disjoint", () => {
    expect(buildMacroDraftInput(args)).not.toHaveProperty("items");
    expect(buildFoodsDraftInput({
      clientId: "c",
      weekStartDate: "2026-09-14",
      meals: [],
      planExtras: null,
      supportContent: "",
    })).not.toHaveProperty("macroTargets");
  });

  it("sends an explicit null for an empty notes box, never undefined (T-101/T-103)", () => {
    // `undefined` is what makes T-101's carry-forward resurrect the previous
    // published plan's notes, so the key must exist and must not be undefined.
    const empty = buildMacroDraftInput({ ...args, supportContent: "" });
    expect(Object.hasOwn(empty, "supportContent")).toBe(true);
    expect(empty.supportContent).not.toBeUndefined();
    expect(empty.supportContent).toBeNull();
    expect(buildMacroDraftInput({ ...args, supportContent: "  " }).supportContent).toBeNull();
    expect(buildMacroDraftInput({ ...args, supportContent: "Hydrate" }).supportContent).toBe(
      "Hydrate"
    );
  });
});

// ── T-103: publish-time meal-name validation ──────────────────────────────────

describe("findMealNameProblem", () => {
  it("passes a plan with distinct, named meals", () => {
    expect(findMealNameProblem(["Breakfast", "Lunch"])).toBeNull();
  });

  it("passes an empty plan — emptiness is a separate rule", () => {
    expect(findMealNameProblem([])).toBeNull();
  });

  it("rejects a whitespace-only name — the reachable blank case", () => {
    // A truly empty string is unreachable through either editor
    // (`tempName || "Untitled Meal"`), but a single space is, and
    // `z.string().min(1)` accepts it straight through to the DB.
    expect(findMealNameProblem(["Breakfast", " ", "Dinner"])).toEqual({
      code: "BLANK_NAME",
      index: 1,
    });
    expect(findMealNameProblem(["  "])).toEqual({ code: "BLANK_NAME", index: 0 });
  });

  it("rejects two rows left on the editors' Untitled Meal fallback", () => {
    // The reachable duplicate path: both editors fall back to this name.
    expect(findMealNameProblem(["Untitled Meal", "Untitled Meal"])).toEqual({
      code: "DUPLICATE_NAME",
      index: 1,
      name: "Untitled Meal",
    });
  });

  it("compares case-insensitively and after trimming — stricter than the DB index", () => {
    // DailyMealCheckoff's unique index is exact-match, so "Lunch"/"lunch" would
    // not literally collide, but it reads as one meal to the client. Frozen
    // decision; T-743 must use the same comparison server-side.
    expect(findMealNameProblem(["Lunch", "lunch"])).toMatchObject({
      code: "DUPLICATE_NAME",
      index: 1,
    });
    expect(findMealNameProblem(["Lunch", "Lunch "])).toMatchObject({
      code: "DUPLICATE_NAME",
      index: 1,
    });
  });

  it("reports blanks before duplicates", () => {
    // A coach who left a row blank is told to name it, not told it collides.
    expect(findMealNameProblem(["Breakfast", "Breakfast", " "])).toEqual({
      code: "BLANK_NAME",
      index: 2,
    });
  });

  it("reports the SECOND occurrence of a three-way duplicate, not the third", () => {
    expect(findMealNameProblem(["Meal", "Meal", "Meal"])).toEqual({
      code: "DUPLICATE_NAME",
      index: 1,
      name: "Meal",
    });
  });
});

describe("mealNameProblemMessage", () => {
  it("names the offending meal by its 1-based position for a blank name", () => {
    const message = mealNameProblemMessage({ code: "BLANK_NAME", index: 1 });
    expect(message).not.toBe("");
    expect(message).toMatch(/Meal 2/);
  });

  it("names the offending meal and explains the check-off consequence", () => {
    const message = mealNameProblemMessage({
      code: "DUPLICATE_NAME",
      index: 1,
      name: "Untitled Meal",
    });
    expect(message).not.toBe("");
    expect(message).toMatch(/Untitled Meal/);
    expect(message).toMatch(/check-off|checkoff/i);
  });

  it("says something different for each problem", () => {
    expect(mealNameProblemMessage({ code: "BLANK_NAME", index: 0 })).not.toBe(
      mealNameProblemMessage({ code: "DUPLICATE_NAME", index: 1, name: "Lunch" })
    );
  });
});

// ── T-103: calories vs. macros ────────────────────────────────────────────────

describe("derivedCalories", () => {
  it("uses 4/4/9", () => {
    expect(derivedCalories({ protein: 40, carbs: 50, fats: 15 })).toBe(495);
    expect(derivedCalories({ protein: 0, carbs: 0, fats: 0 })).toBe(0);
  });
});

describe("macroCalorieMismatch", () => {
  const consistent = { calories: 495, protein: 40, carbs: 50, fats: 15 };

  it("stays silent on an exactly consistent row", () => {
    expect(macroCalorieMismatch(consistent)).toBeNull();
  });

  it("stays silent inside the tolerance", () => {
    // 520 vs 495 → 5.05% off.
    expect(macroCalorieMismatch({ ...consistent, calories: 520 })).toBeNull();
  });

  it("warns outside the tolerance and reports the calculated number", () => {
    // 560 vs 495 → 13.1% off.
    expect(macroCalorieMismatch({ ...consistent, calories: 560 })).toEqual({ derived: 495 });
  });

  it("treats the boundary as inclusive — exactly 10% off is not a mismatch", () => {
    // derived = 40*4 + 40*4 + 20*9 = 500; 550 is exactly MACRO_CALORIE_TOLERANCE off.
    expect(MACRO_CALORIE_TOLERANCE).toBe(0.1);
    expect(derivedCalories({ protein: 40, carbs: 40, fats: 20 })).toBe(500);
    expect(
      macroCalorieMismatch({ calories: 550, protein: 40, carbs: 40, fats: 20 })
    ).toBeNull();
  });

  it("warns on the half-filled row the fix button exists for", () => {
    // Macros typed, calories never filled in — ratio 1.
    expect(macroCalorieMismatch({ ...consistent, calories: 0 })).toEqual({ derived: 495 });
  });

  it("does NOT warn on a calories-only prescription", () => {
    // All three macros zero is a legitimate target, and a warning the coach
    // cannot clear would train them to ignore the one that matters.
    expect(
      macroCalorieMismatch({ calories: 2000, protein: 0, carbs: 0, fats: 0 })
    ).toBeNull();
  });

  it("does not warn on a brand-new all-zero row", () => {
    expect(macroCalorieMismatch({ calories: 0, protein: 0, carbs: 0, fats: 0 })).toBeNull();
  });
});

// ── T-103: autofill request/response mapping ──────────────────────────────────

describe("buildAutofillRequest", () => {
  const item = (mealName: string, foodName: string, extra: Partial<AutofillSourceItem> = {}) => ({
    mealName,
    foodName,
    quantity: "80",
    unit: "g",
    servingDescription: "80 g",
    ...extra,
  });

  it("sends only the rows that have foods and records the rest as skipped", () => {
    // THE headline case: row 1 has no foods under its name, so it is not sent
    // and keeps whatever the coach typed.
    const request = buildAutofillRequest(
      [{ mealName: "Breakfast" }, { mealName: "Post-workout" }],
      [item("Breakfast", "Oats")]
    );
    expect(request.sourceMeals).toHaveLength(1);
    expect(request.sourceMeals[0].name).toBe("Breakfast");
    expect(request.targetIndices).toEqual([0]);
    expect(request.skippedIndices).toEqual([1]);
    expect(request.seeding).toBe(false);
  });

  it("never sends a meal with an empty item list — the silent-zeroing regression", () => {
    // The estimator's prompt rule 5 tells the model to return zeros for a meal
    // with no foods, so sending a renamed row would wipe hand-typed targets.
    const request = buildAutofillRequest(
      [{ mealName: "Renamed breakfast" }],
      [item("Breakfast", "Oats")]
    );
    expect(request.sourceMeals).toEqual([]);
    expect(request.skippedIndices).toEqual([0]);
  });

  it("builds the portion string byte-identically to the expression it replaced", () => {
    const withDescription = buildAutofillRequest(
      [{ mealName: "Breakfast" }],
      [item("Breakfast", "Oats", { servingDescription: "1 cup" })]
    );
    expect(withDescription.sourceMeals[0].items).toEqual([{ food: "Oats", portion: "1 cup" }]);

    const withoutDescription = buildAutofillRequest(
      [{ mealName: "Breakfast" }],
      [item("Breakfast", "Oats", { servingDescription: null })]
    );
    expect(withoutDescription.sourceMeals[0].items).toEqual([
      { food: "Oats", portion: "80 g" },
    ]);
  });

  it("keeps plan order for multiple foods in one meal", () => {
    const request = buildAutofillRequest(
      [{ mealName: "Breakfast" }],
      [item("Breakfast", "Oats"), item("Breakfast", "Whey"), item("Breakfast", "Banana")]
    );
    expect(request.sourceMeals[0].items.map((i) => i.food)).toEqual([
      "Oats",
      "Whey",
      "Banana",
    ]);
  });

  it("seeds one row per distinct food meal when there are no macro rows yet", () => {
    const request = buildAutofillRequest(
      [],
      [item("Breakfast", "Oats"), item("Lunch", "Chicken"), item("Breakfast", "Whey")]
    );
    expect(request.seeding).toBe(true);
    expect(request.sourceMeals.map((m) => m.name)).toEqual(["Breakfast", "Lunch"]);
    expect(request.targetIndices).toEqual([]);
  });

  it("produces nothing to send when there are no rows and no foods", () => {
    const request = buildAutofillRequest([], []);
    expect(request.sourceMeals).toEqual([]);
  });
});

describe("applyMacroEstimates", () => {
  const rows: EditableMacroMeal[] = [
    { id: "a", mealName: "Breakfast", calories: 0, protein: 0, carbs: 0, fats: 0 },
    { id: "b", mealName: "Snack", calories: 210, protein: 20, carbs: 22, fats: 4 },
    { id: "c", mealName: "Dinner", calories: 0, protein: 0, carbs: 0, fats: 0 },
  ];
  const estimates = [
    { calories: 500, protein: 40, carbs: 50, fats: 15 },
    { calories: 700, protein: 55, carbs: 70, fats: 20 },
  ];

  it("fills by index and leaves untargeted rows byte-identical", () => {
    const next = applyMacroEstimates(rows, [0, 2], estimates)!;
    expect(next[0]).toEqual({ id: "a", mealName: "Breakfast", ...estimates[0] });
    expect(next[2]).toEqual({ id: "c", mealName: "Dinner", ...estimates[1] });
    // The hand-typed row keeps its id and every number.
    expect(next[1]).toEqual(rows[1]);
  });

  it("still lands the estimate on a row renamed during the round-trip", () => {
    // The direct regression for `estimates.find(e => e.name === m.mealName)`,
    // which silently left a renamed row with its old numbers.
    const renamed = rows.map((r) => ({ ...r, mealName: `${r.mealName} (renamed)` }));
    const next = applyMacroEstimates(renamed, [0, 2], estimates)!;
    expect(next[0]).toMatchObject({ mealName: "Breakfast (renamed)", calories: 500 });
    expect(next[2]).toMatchObject({ mealName: "Dinner (renamed)", calories: 700 });
  });

  it("changes only the four numbers", () => {
    const next = applyMacroEstimates(rows, [0], [estimates[0]])!;
    expect(next[0].id).toBe("a");
    expect(next[0].mealName).toBe("Breakfast");
  });

  it("applies nothing when the response length does not match", () => {
    const before = JSON.stringify(rows);
    expect(applyMacroEstimates(rows, [0, 2], [estimates[0]])).toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("applies nothing when an index is out of range", () => {
    const before = JSON.stringify(rows);
    expect(applyMacroEstimates(rows, [0, 9], estimates)).toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("is a no-op for an empty request", () => {
    expect(applyMacroEstimates(rows, [], [])).toEqual(rows);
  });
});
