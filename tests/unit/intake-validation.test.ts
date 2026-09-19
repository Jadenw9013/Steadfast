import { describe, it, expect } from "vitest";
import { validateIntakeForm } from "@/lib/validations/intake";

describe("validateIntakeForm", () => {
  const validData = {
    bodyweightLbs: 150,
    heightInches: 70,
    ageYears: 30,
    gender: "Male",
    primaryGoal: "Build muscle",
    targetTimeline: "6 months",
    injuries: "None",
    dietaryRestrictions: "None",
    dietaryPreferences: "High protein",
    currentDiet: "Balanced",
    trainingExperience: "Intermediate",
    trainingDaysPerWeek: 4,
    gymAccess: "Full gym",
  };

  it("accepts valid intake form data", () => {
    const result = validateIntakeForm(validData);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { bodyweightLbs, ...invalidData } = validData;
    const result = validateIntakeForm(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejects age under minimum", () => {
    const invalidData = { ...validData, ageYears: 10 }; // Min is 13
    const result = validateIntakeForm(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejects weight under minimum", () => {
    const invalidData = { ...validData, bodyweightLbs: 40 }; // Min is 50
    const result = validateIntakeForm(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejects training days out of range", () => {
    const invalidData = { ...validData, trainingDaysPerWeek: 8 }; // Max is 7
    const result = validateIntakeForm(invalidData);
    expect(result.success).toBe(false);
  });
});
