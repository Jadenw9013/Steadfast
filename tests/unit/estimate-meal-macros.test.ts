import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { estimatedMealMacrosSchema } from "@/lib/llm/estimate-meal-macros";

describe("estimatedMealMacrosSchema", () => {
  it("accepts a well-shaped response", () => {
    const result = estimatedMealMacrosSchema.safeParse({
      meals: [{ name: "Breakfast", calories: 500, protein: 40, carbs: 50, fats: 15 }],
    });
    expect(result.success).toBe(true);
  });

  it("coerces numeric strings (LLMs sometimes quote numbers)", () => {
    const result = estimatedMealMacrosSchema.safeParse({
      meals: [{ name: "Lunch", calories: "700", protein: "55", carbs: "70", fats: "20" }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.meals[0].calories).toBe(700);
  });

  it("rejects negative macros", () => {
    const result = estimatedMealMacrosSchema.safeParse({
      meals: [{ name: "Dinner", calories: -100, protein: 40, carbs: 50, fats: 15 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects absurdly large macros (bounds check)", () => {
    const result = estimatedMealMacrosSchema.safeParse({
      meals: [{ name: "Dinner", calories: 999999, protein: 40, carbs: 50, fats: 15 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing meals array", () => {
    const result = estimatedMealMacrosSchema.safeParse({ notMeals: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a meal missing a required field", () => {
    const result = estimatedMealMacrosSchema.safeParse({
      meals: [{ name: "Snack", calories: 200, protein: 10, carbs: 20 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("estimateMealMacros", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("short-circuits with no API call when there are no meals", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { estimateMealMacros } = await import("@/lib/llm/estimate-meal-macros");
    const result = await estimateMealMacros({ meals: [] });
    expect(result).toEqual({ meals: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws a clear error when the LLM returns a different meal count than requested", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ meals: [{ name: "Breakfast", calories: 1, protein: 1, carbs: 1, fats: 1 }] }) } }],
      }),
    }) as unknown as typeof fetch;
    const { estimateMealMacros } = await import("@/lib/llm/estimate-meal-macros");
    await expect(
      estimateMealMacros({
        meals: [
          { name: "Breakfast", items: [{ food: "Eggs", portion: "2" }] },
          { name: "Lunch", items: [{ food: "Rice", portion: "1 cup" }] },
        ],
      })
    ).rejects.toThrow("different number of meals");
  });

  it("throws a clear error when the LLM returns invalid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    }) as unknown as typeof fetch;
    const { estimateMealMacros } = await import("@/lib/llm/estimate-meal-macros");
    await expect(
      estimateMealMacros({ meals: [{ name: "Breakfast", items: [] }] })
    ).rejects.toThrow("invalid response");
  });
});
