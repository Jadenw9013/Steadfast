import { describe, it, expect } from "vitest";
import { calculateMacros } from "@/lib/utils/nutrition";

describe("calculateMacros", () => {
  it("calculates correct calories for typical macros", () => {
    const result = calculateMacros(150, 200, 50);
    // 150*4 + 200*4 + 50*9 = 600 + 800 + 450 = 1850
    expect(result).toEqual({
      calories: 1850,
      protein: 150,
      carbs: 200,
      fat: 50,
    });
  });

  it("handles zero macros correctly", () => {
    const result = calculateMacros(0, 0, 0);
    expect(result).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });

  it("handles decimal inputs correctly", () => {
    const result = calculateMacros(10.5, 20.2, 5.5);
    // 10.5*4 + 20.2*4 + 5.5*9 = 42 + 80.8 + 49.5 = 172.3
    expect(result).toEqual({
      calories: 172.3,
      protein: 10.5,
      carbs: 20.2,
      fat: 5.5,
    });
  });

  it("returns exactly what is passed for protein, carbs, and fat", () => {
    const result = calculateMacros(1, 2, 3);
    expect(result.protein).toBe(1);
    expect(result.carbs).toBe(2);
    expect(result.fat).toBe(3);
  });
});
