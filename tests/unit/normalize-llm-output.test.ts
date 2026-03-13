import { describe, it, expect } from "vitest";
import { normalizeLlmOutput } from "@/lib/llm/parse-meal-plan";

describe("normalizeLlmOutput", () => {
  it("returns primitives unchanged", () => {
    expect(normalizeLlmOutput(null)).toBe(null);
    expect(normalizeLlmOutput(undefined)).toBe(undefined);
    expect(normalizeLlmOutput(42)).toBe(42);
    expect(normalizeLlmOutput(true)).toBe(true);
  });

  it("trims string values in objects", () => {
    const result = normalizeLlmOutput({ food: "  Chicken Breast  " });
    expect(result).toEqual({ food: "Chicken Breast" });
  });

  it('coerces null portion to ""', () => {
    const result = normalizeLlmOutput({ food: "Rice", portion: null });
    expect(result).toEqual({ food: "Rice", portion: "" });
  });

  it('coerces undefined portion to ""', () => {
    const result = normalizeLlmOutput({ food: "Rice", portion: undefined });
    expect(result).toEqual({ food: "Rice", portion: "" });
  });

  it("trims portion strings", () => {
    const result = normalizeLlmOutput({ portion: "  6 oz  " });
    expect(result).toEqual({ portion: "6 oz" });
  });

  it("normalizes nested arrays recursively", () => {
    const input = {
      meals: [
        {
          name: " Breakfast ",
          items: [{ food: " Oats ", portion: null }],
        },
      ],
    };
    const result = normalizeLlmOutput(input) as Record<string, unknown>;
    const meals = result.meals as Array<Record<string, unknown>>;
    const items = meals[0].items as Array<Record<string, unknown>>;
    expect(meals[0].name).toBe("Breakfast");
    expect(items[0].food).toBe("Oats");
    expect(items[0].portion).toBe("");
  });

  it("preserves non-string, non-object values", () => {
    const result = normalizeLlmOutput({ count: 3, active: true });
    expect(result).toEqual({ count: 3, active: true });
  });

  it("filters out items with blank food names", () => {
    const input = {
      items: [
        { food: "Chicken", portion: "6 oz" },
        { food: "", portion: "1 cup" },
        { food: "  ", portion: "" },
      ],
    };
    const result = normalizeLlmOutput(input) as Record<string, unknown>;
    const items = result.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].food).toBe("Chicken");
  });

  it("removes meals with zero items after filtering", () => {
    const input = {
      meals: [
        { name: "Breakfast", items: [{ food: "Oats", portion: "1 cup" }] },
        { name: "Empty Meal", items: [{ food: "", portion: "" }] },
      ],
    };
    const result = normalizeLlmOutput(input) as Record<string, unknown>;
    const meals = result.meals as Array<Record<string, unknown>>;
    expect(meals).toHaveLength(1);
    expect(meals[0].name).toBe("Breakfast");
  });

  it("filters out supplements with empty names", () => {
    const input = {
      supplements: [
        { name: "Creatine", timing: "AM", dosage: "5g" },
        { name: "", timing: "PM" },
      ],
    };
    const result = normalizeLlmOutput(input) as Record<string, unknown>;
    const supps = result.supplements as Array<Record<string, unknown>>;
    expect(supps).toHaveLength(1);
    expect(supps[0].name).toBe("Creatine");
  });

  it('defaults supplement timing to "with meal" when missing', () => {
    const input = {
      supplements: [
        { name: "Fish Oil", dosage: "2 caps" },
        { name: "Vitamin D", timing: "", dosage: "2000 IU" },
        { name: "Magnesium", timing: "before bed" },
      ],
    };
    const result = normalizeLlmOutput(input) as Record<string, unknown>;
    const supps = result.supplements as Array<Record<string, unknown>>;
    expect(supps[0].timing).toBe("with meal");
    expect(supps[1].timing).toBe("with meal");
    expect(supps[2].timing).toBe("before bed");
  });

  it("normalizes a meal-only plan without supplements cleanly", () => {
    const input = {
      title: "Test Plan",
      meals: [
        { name: "Meal 1", items: [{ food: "Rice", portion: "1 cup" }] },
      ],
    };
    const result = normalizeLlmOutput(input) as Record<string, unknown>;
    expect(result.title).toBe("Test Plan");
    expect(result.supplements).toBeUndefined();
    const meals = result.meals as Array<Record<string, unknown>>;
    expect(meals).toHaveLength(1);
  });
});
