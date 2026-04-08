import { describe, it, expect } from "vitest";
import { diffMealPlans, type ChangeEntry } from "@/lib/utils/diff-meal-plan";
import type { MealGroup } from "@/types/meal-plan";
import type { PlanExtras } from "@/types/meal-plan-extras";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMeal(name: string, items: { foodName: string; servingDescription?: string; quantity?: string; unit?: string }[]): MealGroup {
  return {
    mealName: name,
    items: items.map((i) => ({
      id: Math.random().toString(36).slice(2),
      foodName: i.foodName,
      servingDescription: i.servingDescription ?? "",
      quantity: i.quantity ?? "1",
      unit: i.unit ?? "serving",
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
    })),
  };
}

function changeTypes(changes: ChangeEntry[]): string[] {
  return changes.map((c) => c.type);
}

function changeCategories(changes: ChangeEntry[]): string[] {
  return changes.map((c) => c.category);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("diffMealPlans", () => {
  describe("no changes", () => {
    it("returns empty array when plans are identical", () => {
      const meals = [makeMeal("Breakfast", [{ foodName: "Oats", servingDescription: "1 cup" }])];
      const changes = diffMealPlans(meals, meals, null, null);
      expect(changes).toEqual([]);
    });

    it("returns empty array for two empty plans", () => {
      expect(diffMealPlans([], [], null, null)).toEqual([]);
    });
  });

  describe("meal-level changes", () => {
    it("detects a new meal added", () => {
      const before: MealGroup[] = [];
      const after = [makeMeal("Breakfast", [{ foodName: "Oats" }])];
      const changes = diffMealPlans(before, after, null, null);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].category).toBe("meal");
      expect(changes[0].label).toContain("Breakfast");
    });

    it("includes item count in new meal detail", () => {
      const after = [makeMeal("Lunch", [{ foodName: "A" }, { foodName: "B" }, { foodName: "C" }])];
      const changes = diffMealPlans([], after, null, null);
      expect(changes[0].detail).toBe("3 items");
    });

    it("uses singular 'item' for single-item meals", () => {
      const after = [makeMeal("Snack", [{ foodName: "Apple" }])];
      const changes = diffMealPlans([], after, null, null);
      expect(changes[0].detail).toBe("1 item");
    });

    it("detects a removed meal", () => {
      const before = [makeMeal("Dinner", [{ foodName: "Steak" }])];
      const changes = diffMealPlans(before, [], null, null);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("removed");
      expect(changes[0].category).toBe("meal");
      expect(changes[0].label).toContain("Dinner");
    });
  });

  describe("item-level changes within shared meals", () => {
    const breakfast = (items: { foodName: string; servingDescription?: string }[]) =>
      [makeMeal("Breakfast", items)];

    it("detects added item", () => {
      const before = breakfast([{ foodName: "Oats" }]);
      const after = breakfast([{ foodName: "Oats" }, { foodName: "Berries" }]);
      const changes = diffMealPlans(before, after, null, null);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].category).toBe("item");
      expect(changes[0].label).toContain("Berries");
    });

    it("detects removed item", () => {
      const before = breakfast([{ foodName: "Oats" }, { foodName: "Berries" }]);
      const after = breakfast([{ foodName: "Oats" }]);
      const changes = diffMealPlans(before, after, null, null);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("removed");
      expect(changes[0].category).toBe("item");
      expect(changes[0].label).toContain("Berries");
    });

    it("detects portion modification", () => {
      const before = breakfast([{ foodName: "Oats", servingDescription: "1 cup" }]);
      const after = breakfast([{ foodName: "Oats", servingDescription: "1.5 cups" }]);
      const changes = diffMealPlans(before, after, null, null);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("modified");
      expect(changes[0].category).toBe("item");
      expect(changes[0].detail).toContain("1 cup");
      expect(changes[0].detail).toContain("1.5 cups");
    });

    it("food matching is case-insensitive", () => {
      const before = breakfast([{ foodName: "Oats", servingDescription: "1 cup" }]);
      const after = breakfast([{ foodName: "oats", servingDescription: "2 cups" }]);
      const changes = diffMealPlans(before, after, null, null);
      // Should detect as modified, not add+remove
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("modified");
    });
  });

  describe("support content changes", () => {
    it("detects support content modification", () => {
      const changes = diffMealPlans([], [], null, null, "Old notes", "New notes");
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("modified");
      expect(changes[0].category).toBe("support");
    });

    it("detects support content added from null", () => {
      const changes = diffMealPlans([], [], null, null, null, "New notes");
      expect(changes).toHaveLength(1);
      expect(changes[0].category).toBe("support");
    });

    it("no change when support content is identical", () => {
      const changes = diffMealPlans([], [], null, null, "Same", "Same");
      expect(changes).toEqual([]);
    });
  });

  describe("extras: day overrides", () => {
    it("detects a new day override", () => {
      const extrasAfter: PlanExtras = {
        dayOverrides: [{ label: "Cardio Day", weekdays: ["Monday"] }],
      } as PlanExtras;
      const changes = diffMealPlans([], [], null, extrasAfter);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].category).toBe("override");
      expect(changes[0].label).toContain("Cardio Day");
    });

    it("no change when overrides are the same", () => {
      const extras: PlanExtras = {
        dayOverrides: [{ label: "Rest Day", weekdays: ["Sunday"] }],
      } as PlanExtras;
      const changes = diffMealPlans([], [], extras, extras);
      expect(changes).toEqual([]);
    });
  });

  describe("highlighted changes metadata", () => {
    it("propagates highlightedChanges as info entry", () => {
      const extrasAfter: PlanExtras = {
        dayOverrides: [],
        metadata: { highlightedChanges: "Updated macros to match new TDEE" },
      } as unknown as PlanExtras;
      const changes = diffMealPlans([], [], null, extrasAfter);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("info");
      expect(changes[0].category).toBe("meta");
      expect(changes[0].label).toBe("Updated macros to match new TDEE");
    });
  });

  describe("complex scenario", () => {
    it("detects multiple changes at once", () => {
      const before = [
        makeMeal("Breakfast", [{ foodName: "Oats", servingDescription: "1 cup" }]),
        makeMeal("Lunch", [{ foodName: "Chicken", servingDescription: "6 oz" }]),
      ];
      const after = [
        makeMeal("Breakfast", [
          { foodName: "Oats", servingDescription: "1.5 cups" },  // modified
          { foodName: "Protein Shake" },                          // added
        ]),
        // Lunch removed
        makeMeal("Dinner", [{ foodName: "Salmon" }]),             // new meal
      ];
      const changes = diffMealPlans(before, after, null, null);

      const types = changeTypes(changes);
      expect(types).toContain("added");
      expect(types).toContain("removed");
      expect(types).toContain("modified");
      expect(changes.length).toBeGreaterThanOrEqual(4);
    });
  });
});
