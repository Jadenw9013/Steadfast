import { describe, it, expect, vi } from "vitest";

/**
 * T-730 — the pure mapping layer of `app/api/mealplans/import-plan/route.ts`:
 * the parsed document → `planExtras` / `supportContent` / `MealPlanItem[]`
 * translation that happens before the route hands off to the shared services.
 *
 * `@/lib/db` is mocked (same technique as tests/unit/prisma-error.test.ts) so
 * importing `@/lib/meal-plans/drafts` for the real `supportContentInputSchema`
 * does not require a database — these assertions are about pure functions.
 */
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  parsedMealPlanSchema,
  extractPlanExtras,
  splitPortion,
  type ParsedMealPlan,
} from "@/lib/validations/meal-plan-import";
import { parsePlanExtras } from "@/types/meal-plan-extras";
import { supportContentInputSchema } from "@/lib/meal-plans/drafts";

/** Parse through the real route schema so every fixture is a document the
 *  route would actually accept (defaults applied, unknown keys stripped). */
function parse(raw: unknown): ParsedMealPlan {
  return parsedMealPlanSchema.parse(raw);
}

describe("import-plan → planExtras mapping", () => {
  it("round-trips metadata + dayOverrides + confidence through parsePlanExtras", () => {
    const plan = parse({
      title: "Week 1",
      meals: [],
      metadata: { phase: "cutting", bodyweight: "82kg", coachNotes: "push protein" },
      dayOverrides: [
        {
          label: "High Carb Day",
          color: "blue",
          weekdays: ["Monday"],
          mealAdjustments: [
            { mealName: "Meal 1", changes: [{ type: "update", food: "Oats", newPortion: "120g" }] },
          ],
        },
      ],
      confidence: { meals: 0.9, overrides: 0.8, supportContent: 0.7 },
    });

    const extras = parsePlanExtras(extractPlanExtras(plan));

    expect(extras).not.toBeNull();
    expect(Object.keys(extras!).sort()).toEqual(["confidence", "dayOverrides", "metadata"]);
    expect(extras!.metadata).toEqual({ phase: "cutting", bodyweight: "82kg", coachNotes: "push protein" });
    expect(extras!.dayOverrides).toHaveLength(1);
    expect(extras!.dayOverrides![0].label).toBe("High Carb Day");
    expect(extras!.dayOverrides![0].mealAdjustments![0].changes[0]).toEqual({
      type: "update",
      food: "Oats",
      newPortion: "120g",
    });
    expect(extras!.confidence).toEqual({ meals: 0.9, overrides: 0.8, supportContent: 0.7 });
  });

  it("yields null (→ undefined at the call site) when the document carries no extras", () => {
    const plan = parse({ title: "Plain", meals: [{ name: "Meal 1", items: [{ food: "Rice", portion: "100g" }] }] });

    expect(extractPlanExtras(plan)).toBeNull();
    expect(parsePlanExtras(extractPlanExtras(plan))).toBeNull();
    // The route passes `?? undefined`, which is what createMealPlanDraft expects.
    expect(parsePlanExtras(extractPlanExtras(plan)) ?? undefined).toBeUndefined();
  });

  it("does not treat supportContent or notes as plan extras", () => {
    const plan = parse({
      title: "Notes only",
      meals: [],
      notes: "extracted by the LLM, dropped on import — T-736",
      supportContent: "Hydration: 3L/day",
    });

    // supportContent has its own column; notes is deliberately not carried (T-736).
    expect(extractPlanExtras(plan)).toBeNull();
    expect(parsePlanExtras(extractPlanExtras(plan))).toBeNull();
  });

  it("drops an empty dayOverrides array rather than writing an empty extras object", () => {
    const plan = parse({ title: "Empty overrides", meals: [], dayOverrides: [] });
    expect(extractPlanExtras(plan)).toBeNull();
  });
});

describe("import-plan → supportContent normalization", () => {
  // The route applies the SHARED schema from lib/meal-plans/drafts.ts, so the
  // import path resolves plan notes by exactly the same rules as the editor.
  it.each([
    ["absent", undefined, undefined],
    ["empty string", "", undefined],
    ["whitespace only", "   ", undefined],
    ["a real value", "Drink 3L", "Drink 3L"],
  ])("%s → %s", (_label, input, expected) => {
    expect(supportContentInputSchema.parse(input)).toBe(expected);
  });

  it("preserves surrounding formatting of a non-empty value (no trimming of content)", () => {
    expect(supportContentInputSchema.parse("Hydration: 3L/day\n\nCardio: 30m")).toBe(
      "Hydration: 3L/day\n\nCardio: 30m"
    );
  });
});

describe("import-plan → MealPlanItem mapping", () => {
  /**
   * Re-derived verbatim from `app/api/mealplans/import-plan/route.ts`.
   *
   * The spec offered two options: export this helper from the route file, or
   * re-derive it here. The first is not available — Next.js 16's generated
   * route type guard (`checkFields<Diff<{ GET?, POST?, ..., config?, ... },
   * TEntry>>` in
   * node_modules/next/dist/build/webpack/plugins/next-types-plugin/index.js)
   * rejects ANY non-handler export from a `route.ts`, so exporting it would
   * fail `next build`. The route's real mapping is covered end to end against
   * the database in tests/integration/meal-plan-import-parity.test.ts
   * ("import as draft is unchanged"); this unit case pins the shape.
   */
  function mapItems(plan: ParsedMealPlan) {
    let sortOrder = 0;
    return plan.meals.flatMap((meal) =>
      meal.items.map((item) => {
        const { quantity, unit } = splitPortion(item.portion);
        return {
          mealName: meal.name,
          sortOrder: sortOrder++,
          foodName: item.food,
          quantity,
          unit,
          servingDescription: item.portion,
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0,
        };
      })
    );
  }

  it("flattens two meals × two items into document order with sortOrder 0..3", () => {
    const plan = parse({
      title: "Week 1",
      meals: [
        { name: "Meal 1", items: [{ food: "Oats", portion: "80 g" }, { food: "Whey", portion: "1 scoop" }] },
        { name: "Meal 2", items: [{ food: "Chicken", portion: "200 g" }, { food: "Rice", portion: "150 g" }] },
      ],
    });

    const items = mapItems(plan);

    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(items.map((i) => i.foodName)).toEqual(["Oats", "Whey", "Chicken", "Rice"]);
    expect(items.map((i) => i.mealName)).toEqual(["Meal 1", "Meal 1", "Meal 2", "Meal 2"]);
  });

  it("keeps the original portion string as servingDescription and zeroes every macro", () => {
    const plan = parse({
      title: "Week 1",
      meals: [{ name: "Meal 1", items: [{ food: "Oats", portion: "80 g" }, { food: "Egg whites", portion: "3 large" }] }],
    });

    const items = mapItems(plan);

    expect(items.map((i) => i.servingDescription)).toEqual(["80 g", "3 large"]);
    // splitPortion itself is covered by tests/unit/split-portion.test.ts.
    expect(items[0]).toMatchObject({ quantity: "80", unit: "g" });
    for (const item of items) {
      expect({ ...item }).toMatchObject({ calories: 0, protein: 0, carbs: 0, fats: 0 });
    }
  });

  it("produces an empty array for an extras-only document", () => {
    const plan = parse({ title: "Guidance only", meals: [], supportContent: "Hydration: 3L/day" });
    expect(mapItems(plan)).toEqual([]);
  });
});
