import { describe, expect, it } from "vitest";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { decisionSchema, planPayloadSchema } from "@/lib/ai-coach/plan-contract";
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

describe("T-2040 — catalog references resolve by key", () => {
  /**
   * Golden hashes captured from the **pre-change** code at the base commit
   * `408bf8f` (team/sprint-1), with `git status` clean, by running a temporary
   * vitest file that printed `contentHash(planPayloadSchema.parse(payload))`
   * for each fixture payload this suite builds. The command and the full
   * captured set are recorded in board/evidence/T-2040.md. They exist to prove
   * the superRefine rewrite moved no existing payload: a hash produced by the
   * new code and asserted equal to itself would prove nothing.
   */
  const GOLDEN_PAYLOAD_HASHES = {
    "initial.MACROS.rx": "009e9ece949122616843c8485c67e1a01846a2552bf859307bbd1e557db1db50",
    "initial.MEALS.rx": "12e47e7b70b30e618e27739ec4aeda5080348bd14bc3dfaa095a059fa66ab359",
    "initial.MACROS.stable-rx": "ba7e85ffa3a1eddab540cbb6d7d1c0a4f870c3f06b88f425075bd35691b73991",
    "initial.MEALS.gym": "eb53a32ee968664e316575ecd4d676f36f2902d6e22960540c7b229915e6d12d",
  } as const;

  it("does not move any existing synthetic payload (golden hashes from the base commit)", () => {
    const gymAnswers = { ...answers, equipmentAccess: ["HOME_BASIC"] };
    expect({
      "initial.MACROS.rx": contentHash(
        planPayloadSchema.parse(buildInitialFixturePlan(answers, "rx", "MACROS").payload)
      ),
      "initial.MEALS.rx": contentHash(
        planPayloadSchema.parse(buildInitialFixturePlan(answers, "rx", "MEALS").payload)
      ),
      "initial.MACROS.stable-rx": contentHash(
        planPayloadSchema.parse(buildInitialFixturePlan(answers, "stable-rx", "MACROS").payload)
      ),
      "initial.MEALS.gym": contentHash(
        planPayloadSchema.parse(buildInitialFixturePlan(gymAnswers, "rx", "MEALS").payload)
      ),
    }).toEqual(GOLDEN_PAYLOAD_HASHES);
  });

  /** A payload bound to a reviewed exercise catalog this build does not carry. */
  const liveKeyedPayload = () => {
    const base = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    return {
      ...base,
      contentKind: "REVIEWED_LIVE_V1" as const,
      nutrition: null,
      meals: null,
      cardio: [],
      catalogVersions: { ...base.catalogVersions, exercise: "exercise-beginner-v1" },
      strength: [
        {
          sessionId: "strength-1",
          templateId: "reviewed-template",
          day: 1,
          exercises: [
            {
              exerciseId: "some-reviewed-exercise",
              catalogVersion: "exercise-beginner-v1",
              sets: 2,
              reps: 8,
              restSeconds: 90,
              effort: "Seeded by the test; the reviewed artifact is the authority.",
            },
          ],
        },
      ],
    };
  };

  it("parses a payload bound to a catalog this build does not carry", () => {
    // Authority for its items belongs to the artifact-backed catalogItemsValid
    // in autonomy/gate.ts. Rejecting it here would blank the workspace, the
    // session logger and the nutrition history for that client.
    const parsed = planPayloadSchema.safeParse(liveKeyedPayload());
    expect(parsed.success).toBe(true);
  });

  it("still rejects an item whose catalogVersion disagrees with the plan binding", () => {
    const payload = liveKeyedPayload();
    payload.strength[0].exercises[0].catalogVersion = "exercise-fixture-v1";
    const parsed = planPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues.map((issue) => issue.message)).toContain(
      "Unknown or incompatible strength exercise."
    );
  });

  it("keeps the in-code modality check for a catalog it does serve", () => {
    const plan = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    plan.strength[0].exercises[0].exerciseId = "brisk-walk"; // CARDIO in exercise-fixture-v1
    const parsed = planPayloadSchema.safeParse(plan);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues.map((issue) => issue.message)).toContain(
      "Unknown or incompatible strength exercise."
    );
  });

  it("keeps rejecting an unknown id and an unknown food inside a served catalog", () => {
    const plan = buildInitialFixturePlan(answers, "rx", "MEALS").payload;
    const withBadExercise = structuredClone(plan);
    withBadExercise.strength[0].exercises[0].exerciseId = "typo-squat";
    expect(planPayloadSchema.safeParse(withBadExercise).success).toBe(false);
    const withBadFood = structuredClone(plan);
    withBadFood.meals!.days[0].meals[0].ingredients[0].foodId = "typo-chicken";
    expect(planPayloadSchema.safeParse(withBadFood).success).toBe(false);
    const withBadCardio = structuredClone(plan);
    withBadCardio.cardio[0].exerciseId = "bodyweight-squat"; // STRENGTH in a cardio slot
    expect(planPayloadSchema.safeParse(withBadCardio).success).toBe(false);
  });

  it("accepts both contentKind values and no third one", () => {
    const base = buildInitialFixturePlan(answers, "rx", "MACROS").payload;
    expect(planPayloadSchema.safeParse({ ...base, contentKind: "SYNTHETIC_FIXTURE" }).success).toBe(true);
    expect(planPayloadSchema.safeParse({ ...base, contentKind: "REVIEWED_LIVE_V1" }).success).toBe(true);
    expect(planPayloadSchema.safeParse({ ...base, contentKind: "ANYTHING_ELSE" }).success).toBe(false);
  });

  it("accepts LIVE_COMPOSITION_UNAVAILABLE alongside every existing reason code", () => {
    const decision = {
      action: "HOLD" as const,
      reasonCodes: [
        "INITIAL_FIXTURE", "MISSING_INPUT", "INSUFFICIENT_EVIDENCE", "RECOVERY_CONCERN",
        "SCHEDULE_BARRIER", "SUPPORTED_FIXTURE_CHANGE", "CUMULATIVE_LIMIT",
        "CONSECUTIVE_DEFICIT_BLOCKED", "SAFETY_CONCERN", "REPRESENTATION_ONLY",
      ],
      explanation: "e", limitations: [], nextAction: "n", changeClass: null,
    };
    expect(decisionSchema.safeParse(decision).success).toBe(true);
    expect(
      decisionSchema.safeParse({
        ...decision,
        reasonCodes: ["NO_FEASIBLE_MEALS", "UNCHANGED", "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE", "LIVE_COMPOSITION_UNAVAILABLE"],
      }).success
    ).toBe(true);
    expect(decisionSchema.safeParse({ ...decision, reasonCodes: ["NOT_A_REASON_CODE"] }).success).toBe(false);
  });
});
