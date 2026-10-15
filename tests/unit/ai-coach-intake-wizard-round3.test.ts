import { describe, expect, it, vi } from "vitest";
import {
  confirmAndRedirect,
  feetAndInchesToCentimeters,
  firstIncompleteIntakeStage,
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
  currentTraining: "OCCASIONAL",
  sessionLength: "MIN_30_45",
  dietaryStyle: "BALANCED",
  trackingStyle: "PORTIONS",
  foodBudgetLevel: "MODERATE",
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
      // T-2028 r3 (lead decision A): the current-training question is required.
      "Choose your current strength training.",
      "Choose a session length.",
    ]);
    expect(intakeStepIssues(2, empty, {}, true)).toEqual([
      "Choose a dietary style.",
      "Choose a tracking style.",
      "Choose a food budget preference.",
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

describe("T-2008/S-33 resume at the first incomplete stage", () => {
  const empty: IntakeSelections = {
    allergens: [],
    unitSystem: "IMPERIAL",
    weightMeasuredOn: "2026-09-27",
  };

  it("lands on stage 0 for a wholly untouched draft", () => {
    expect(firstIncompleteIntakeStage(empty, false)).toBe(0);
  });

  it("lands on stage 1 once stage 0 is satisfied", () => {
    expect(
      firstIncompleteIntakeStage({ ...empty, goal: "GENERAL_FITNESS", experience: "BEGINNER" }, false)
    ).toBe(1);
  });

  it("lands on stage 2 once stages 0-1 are satisfied, including the new food budget question", () => {
    const stage1Done: IntakeSelections = {
      ...empty,
      goal: "GENERAL_FITNESS",
      experience: "BEGINNER",
      trainingDaysPerWeek: 3,
      equipment: "BODYWEIGHT",
      currentTraining: "NONE",
      sessionLength: "MIN_30_45",
    };
    // Stage 2 is still incomplete: no dietary style, tracking style, food
    // budget or allergen choice yet.
    expect(firstIncompleteIntakeStage(stage1Done, false)).toBe(2);
    // Everything in stage 2 except the food budget is answered — still
    // incomplete, and still stage 2, not a silent skip to stage 3.
    expect(
      firstIncompleteIntakeStage(
        { ...stage1Done, dietaryStyle: "BALANCED", trackingStyle: "PORTIONS", allergens: ["NONE"] },
        false
      )
    ).toBe(2);
  });

  it("lands on stage 3 — the only destination left — once every earlier stage is satisfied, confirmed or not", () => {
    expect(firstIncompleteIntakeStage(completeSelections, false)).toBe(3);
    expect(firstIncompleteIntakeStage(completeSelections, true)).toBe(3);
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

describe("T-2055 item 1 — preferred pace is required on step 1 for Fat Loss / Build Muscle", () => {
  it("asks for a pace only when the goal needs one", () => {
    expect(
      intakeStepIssues(0, { ...completeSelections, goal: "FAT_LOSS", experience: "BEGINNER" }, {}, false)
    ).toEqual(["Choose a preferred pace, or Undecided."]);
    expect(
      intakeStepIssues(
        0,
        { ...completeSelections, goal: "FAT_LOSS", experience: "BEGINNER", goalPace: "GRADUAL" },
        {},
        false
      )
    ).toEqual([]);
    expect(
      intakeStepIssues(
        0,
        { ...completeSelections, goal: "GENERAL_FITNESS", experience: "BEGINNER" },
        {},
        false
      )
    ).toEqual([]);
  });

  it("resumes on step 1 for a Fat Loss selection missing its pace", () => {
    expect(firstIncompleteIntakeStage({ ...completeSelections, goal: "FAT_LOSS" }, true)).toBe(0);
  });
});
