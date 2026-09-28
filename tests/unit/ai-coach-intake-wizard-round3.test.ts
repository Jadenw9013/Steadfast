import { describe, expect, it, vi } from "vitest";
import {
  confirmAndRedirect,
  feetAndInchesToCentimeters,
  intakeStepIssues,
  kilogramsToPounds,
  poundsToKilograms,
  safetyAnswersComplete,
  toggleAllergen,
  type IntakeSelections,
  type SafetyAnswers,
} from "@/components/ai-coach/intake-wizard";

const completeSelections: IntakeSelections = {
  goal: "GENERAL_FITNESS",
  experience: "BEGINNER",
  trainingDaysPerWeek: 3,
  equipment: "BODYWEIGHT",
  sessionLength: "MIN_30_45",
  dietaryStyle: "BALANCED",
  trackingStyle: "PORTIONS",
  allergens: ["NONE"],
  unitSystem: "IMPERIAL",
  heightCm: 167.6,
  weightKg: 68,
  ageYears: 29,
  weightMeasuredOn: "2026-09-27",
};

const allNoSafety: SafetyAnswers = {
  chestPainDuringExercise: "NO",
  dizzinessOrFainting: "NO",
  heartCondition: "NO",
  pregnantOrPostpartum: "NO",
  recentInjuryOrSurgery: "NO",
  ageEligibilityConcern: "NO",
  eatingDisorderHistoryOrConcern: "NO",
  type1Diabetes: "NO",
};

describe("T-2028 four-step validation", () => {
  it("names only the missing choices on each step", () => {
    const empty: IntakeSelections = {
      allergens: [],
      unitSystem: "IMPERIAL",
      weightMeasuredOn: "2026-09-27",
    };

    expect(intakeStepIssues(0, empty, {}, true)).toEqual([
      "Choose your main goal.",
      "Choose your experience level.",
    ]);
    expect(intakeStepIssues(1, empty, {}, true)).toEqual([
      "Choose your training days.",
      "Choose your equipment setup.",
      "Choose a session length.",
    ]);
    expect(intakeStepIssues(2, empty, {}, true)).toEqual([
      "Choose a dietary style.",
      "Choose a tracking style.",
      "Choose any allergens, or choose None.",
    ]);
    expect(intakeStepIssues(3, empty, {}, true)).toEqual([
      "Enter a valid height.",
      "Enter a valid weight.",
      "Enter your age in whole years.",
      "Complete the quick safety check.",
    ]);
  });

  it("allows a confirmed user to edit without repeating the one-time safety disclosure", () => {
    expect(intakeStepIssues(3, completeSelections, {}, false)).toEqual([]);
    expect(intakeStepIssues(3, completeSelections, {}, true)).toEqual([
      "Complete the quick safety check.",
    ]);
  });

  it("requires every safety answer and treats unsure as a real completed answer", () => {
    expect(safetyAnswersComplete({ ...allNoSafety, type1Diabetes: undefined })).toBe(false);
    expect(safetyAnswersComplete({ ...allNoSafety, type1Diabetes: "UNSURE" })).toBe(true);
  });

  it("makes None mutually exclusive with individual allergen tags", () => {
    expect(toggleAllergen(["DAIRY"], "NONE")).toEqual(["NONE"]);
    expect(toggleAllergen(["NONE"], "PEANUTS")).toEqual(["PEANUTS"]);
    expect(toggleAllergen(["DAIRY", "PEANUTS"], "DAIRY")).toEqual(["PEANUTS"]);
  });

  it("converts displayed imperial stats into canonical metric values", () => {
    expect(feetAndInchesToCentimeters(5, 6)).toBe(167.6);
    expect(poundsToKilograms(150)).toBeCloseTo(68.04, 2);
    expect(kilogramsToPounds(68.04)).toBeCloseTo(150, 1);
  });
});

describe("T-2028 confirm workflow", () => {
  it("saves safety, then allergens, then the existing CONFIRM_INTAKE command before redirecting", async () => {
    const operations: string[] = [];
    const command = vi.fn(async (input: Record<string, unknown>) => {
      operations.push(String(input.operation));
      return {};
    });
    const redirect = vi.fn();

    await confirmAndRedirect({
      selections: completeSelections,
      safetyAnswers: allNoSafety,
      needsSafetyDisclosure: true,
      command,
      redirect,
    });

    expect(operations).toEqual(["SAFETY", "ALLERGIES", "CONFIRM_INTAKE"]);
    expect(command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "CONFIRM_INTAKE",
        answers: expect.objectContaining({ intakeVersion: 2 }),
      })
    );
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("does not repeat safety for an already-confirmed intake", async () => {
    const command = vi.fn(async (input: Record<string, unknown>) => {
      void input;
      return {};
    });

    await confirmAndRedirect({
      selections: completeSelections,
      safetyAnswers: {},
      needsSafetyDisclosure: false,
      command,
      redirect: vi.fn(),
    });

    expect(command.mock.calls.map(([input]) => input.operation)).toEqual([
      "ALLERGIES",
      "CONFIRM_INTAKE",
    ]);
  });

  it("never redirects when confirm fails, so the UI can show the real error and keep the answers", async () => {
    const command = vi.fn(async (input: Record<string, unknown>) => {
      if (input.operation === "CONFIRM_INTAKE") throw new Error("schema rejected");
      return {};
    });
    const redirect = vi.fn();

    await expect(
      confirmAndRedirect({
        selections: completeSelections,
        safetyAnswers: allNoSafety,
        needsSafetyDisclosure: true,
        command,
        redirect,
      })
    ).rejects.toThrow("schema rejected");
    expect(redirect).not.toHaveBeenCalled();
  });
});
