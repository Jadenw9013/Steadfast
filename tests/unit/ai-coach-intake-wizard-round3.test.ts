import { describe, expect, it } from "vitest";
import {
  autoAllergenStatus,
  buildConfirmPayload,
  confirmedWithoutValue,
  defaultAnswers,
  foodStageIssues,
  isAbsent,
  pruneUnconfirmed,
  requiredAnswerIssues,
  reviewBlockingIssues,
  trainingStageIssues,
} from "@/components/ai-coach/intake-wizard";
import { intakeV2ConfirmSchema } from "@/lib/ai-coach/intake";

/**
 * T-2024 review round 3 fixes.
 */

describe("MAJOR 1 (r2 finding 1 / parity BLOCKER 1) — the seven unconditionally-required v1 fields are named and gate Confirm", () => {
  it("hydrating from an untouched draft leaves Goal etc. unanswered, named by requiredAnswerIssues and reviewBlockingIssues", () => {
    const answers = defaultAnswers({});
    expect(requiredAnswerIssues(answers, 1)).toEqual(
      expect.arrayContaining([
        "Goal: choose an answer.",
        "Training experience: choose an answer.",
        "Preferred nutrition display: choose an answer.",
        "Preferred units: choose an answer.",
      ])
    );
    expect(requiredAnswerIssues(answers, 2)).toEqual(["Food budget: choose an answer."]);
    expect(reviewBlockingIssues(answers).length).toBeGreaterThan(0);
    expect(reviewBlockingIssues(answers)).toEqual(expect.arrayContaining(["Goal: choose an answer."]));
  });

  it("isAbsent and requiredAnswerIssues treat a re-picked placeholder (\"\") the same as never-answered", () => {
    const answers = defaultAnswers({ goal: "" });
    expect(isAbsent(answers.goal)).toBe(true);
    expect(requiredAnswerIssues(answers, 1)).toContain("Goal: choose an answer.");
  });

  it("buildConfirmPayload omits an empty-string field rather than sending an invalid value", () => {
    const answers = defaultAnswers({ goal: "" });
    const payload = buildConfirmPayload(pruneUnconfirmed(answers));
    expect(payload).not.toHaveProperty("goal");
  });

  it("invariant: whenever reviewBlockingIssues is empty, buildConfirmPayload parses under intakeV2ConfirmSchema", () => {
    const fullAnswers = defaultAnswers({
      intakeVersion: 2,
      goal: "GENERAL_FITNESS",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      foodBudgetLevel: "LOW",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
    });
    expect(reviewBlockingIssues(fullAnswers)).toEqual([]);
    const payload = buildConfirmPayload(pruneUnconfirmed(fullAnswers));
    expect(intakeV2ConfirmSchema.safeParse(payload).success).toBe(true);
  });

  it("a client who never opens Goal cannot reach an empty blocking list (Confirm stays disabled)", () => {
    const answers = defaultAnswers({
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      foodBudgetLevel: "LOW",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
    });
    expect(reviewBlockingIssues(answers)).toContain("Goal: choose an answer.");
  });
});

describe("MINOR 4 (parity MINOR 7) — autoAllergenStatus mirrors iOS's self-repair", () => {
  it("adding the first item (noKnownAllergens false, items non-empty) resolves CONFIRMED", () => {
    expect(autoAllergenStatus(false, [{ category: "MILK" }])).toBe("CONFIRMED");
  });

  it("checking no known allergens resolves CONFIRMED", () => {
    expect(autoAllergenStatus(true, [])).toBe("CONFIRMED");
  });

  it("emptying both (no items, no known allergens unchecked) resolves UNKNOWN", () => {
    expect(autoAllergenStatus(false, [])).toBe("UNKNOWN");
  });
});

describe("MINOR 5 (parity MINOR 9) — cookingAccess.equipment min 1 and cuisinePreferences max 10 named client-side", () => {
  it("cookingAccessStatus CONFIRMED with an empty equipment list is named on the Training stage", () => {
    const answers = defaultAnswers({
      cookingAccessStatus: "CONFIRMED",
      cookingAccess: { equipment: [], refrigeration: "FRIDGE", mealPrepCapacity: "SOME", typicalPrepMinutesBand: "MIN_15_30" },
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
    });
    expect(trainingStageIssues(answers)).toContain(
      "Cooking and storage access: choose at least one cooking equipment option."
    );
  });

  it("cookingAccessStatus not CONFIRMED does not require equipment", () => {
    const answers = defaultAnswers({ trainingDaysPerWeek: 3, equipmentAccess: ["NONE"] });
    expect(trainingStageIssues(answers)).not.toContain(
      "Cooking and storage access: choose at least one cooking equipment option."
    );
  });

  it("more than 10 cuisinePreferences is named on the Food stage", () => {
    const answers = defaultAnswers({
      cuisinePreferences: Array.from({ length: 11 }, (_, i) => `Cuisine ${i}`),
    });
    expect(foodStageIssues(answers)).toContain("Cuisines you enjoy: choose at most 10.");
  });

  it("10 or fewer cuisinePreferences is not flagged", () => {
    const answers = defaultAnswers({ cuisinePreferences: Array.from({ length: 10 }, (_, i) => `Cuisine ${i}`) });
    expect(foodStageIssues(answers)).not.toContain("Cuisines you enjoy: choose at most 10.");
  });
});

describe("confirmedWithoutValue and buildConfirmPayload still treat DECLINED/UNKNOWN as legal gaps", () => {
  it("does not name a group whose status is DECLINED or UNKNOWN", () => {
    const answers = defaultAnswers({ ageStatus: "DECLINED", energyMethodPopulationCategoryStatus: "UNKNOWN" });
    expect(confirmedWithoutValue(answers)).toEqual([]);
  });
});
