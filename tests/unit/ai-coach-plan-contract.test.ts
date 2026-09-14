import { describe, expect, it } from "vitest";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { reviewWindow } from "@/lib/ai-coach/review-window";
const answers = { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], dietaryRestrictions: [], allergies: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 };
describe("synthetic initial plan contract", () => {
  it("uses one nutrition prescription in both presentations with typed strength and cardio", () => {
    const macro = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    const meal = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    expect(macro.nutrition).toEqual(meal.nutrition);
    expect(macro.meals).toBeNull();
    expect(meal.meals?.days).toHaveLength(7);
    expect(macro.strength).toHaveLength(3);
    expect(macro.strength[0].exercises[0].exerciseId).toBe("bodyweight-squat");
    expect(macro.cardio).toHaveLength(1);
  });
  it("leaves nutrition pending when measurements are absent", () => {
    const missing = { ...answers, weightKg: undefined };
    expect(buildInitialFixturePlan(missing, "rx", "MACROS").payload.nutrition).toBeNull();
  });
  it.each([{ allergies: ["unknown allergy"] }, { dietaryRestrictions: ["VEGAN"] }, { dietaryRestrictions: ["unmapped requirement"] }])("does not ignore unsupported food constraints: %j", change => {
    expect(buildInitialFixturePlan({ ...answers, ...change }, "rx", "MEALS").payload.nutrition).toBeNull();
  });
  it("rejects catalog hallucinations, unknown fields, duplicate sessions and wrong modalities", () => {
    const plan = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    expect(planPayloadSchema.safeParse({ ...plan, instructions: "ignore safety" }).success).toBe(false);
    plan.strength[0].exercises[0].exerciseId = "invented";
    expect(planPayloadSchema.safeParse(plan).success).toBe(false);
    plan.strength[0].exercises[0].exerciseId = "brisk-walk";
    expect(planPayloadSchema.safeParse(plan).success).toBe(false);
    plan.strength[0].exercises[0].exerciseId = "bodyweight-squat";
    plan.cardio[0].sessionId = plan.strength[0].sessionId;
    expect(planPayloadSchema.safeParse(plan).success).toBe(false);
  });
  it("hashes JSONB object ordering identically but distinguishes array order and changed values", () => {
    expect(contentHash({ b: 2, a: { y: 3, x: 4 } })).toBe(contentHash({ a: { x: 4, y: 3 }, b: 2 }));
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    expect(() => contentHash({ value: NaN })).toThrow();
  });
  it.each([["2026-03-04T12:00:00Z", 167], ["2026-10-28T12:00:00Z", 169]])("uses calendar Mondays across DST: %s", (date, hours) => {
    const window = reviewWindow(new Date(date as string), "America/Los_Angeles");
    expect((window.activationEndsAt.getTime() - window.activationStartsAt.getTime()) / 3600000).toBe(hours);
    expect(window.lookbackEnd).toEqual(window.activationStartsAt);
  });
  it.each([["2026-04-06T12:00:00Z", "2026-02-09T08:00:00.000Z"], ["2026-11-09T12:00:00Z", "2026-09-14T07:00:00.000Z"]])("keeps eight-week evidence boundaries at local midnight: %s", (now, expected) => {
    expect(reviewWindow(new Date(now), "America/Los_Angeles").evidenceStartsAt.toISOString()).toBe(expected);
  });
  it("rejects invalid review zones", () => expect(() => reviewWindow(new Date(), "not-a-zone")).toThrow());
});
