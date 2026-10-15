import { describe, it, expect } from "vitest";
import { AI_PLAN_ACCEPTANCE_PUSH } from "@/lib/notifications/ai-coach-plan";

/**
 * T-502 — G03 frozen copy. Counsel's launch-time copy pass can change the
 * literal strings; the constant exists precisely so that is a one-line
 * diff with this test attached. No number, no body metric, no plan
 * detail, no "we noticed", no supervision/monitoring claim reaches a
 * lock screen (docs/ai-coach/09 §2 last paragraph).
 */
describe("AI_PLAN_ACCEPTANCE_PUSH — frozen G03 copy", () => {
  it("carries no digit in the body (no metric can ever reach a lock screen)", () => {
    expect(AI_PLAN_ACCEPTANCE_PUSH.body).toMatch(/^[^0-9]*$/);
  });

  it("title and body contain none of the disallowed monitoring/clinical phrases", () => {
    const forbidden = /we noticed|monitor|tracking|supervis|review(ed|ing) your|clinical|doctor/i;
    expect(AI_PLAN_ACCEPTANCE_PUSH.title).not.toMatch(forbidden);
    expect(AI_PLAN_ACCEPTANCE_PUSH.body).not.toMatch(forbidden);
  });

  it("uses the frozen MEAL_PLAN_UPDATED routing contract for the shipped iOS build", () => {
    expect(AI_PLAN_ACCEPTANCE_PUSH.type).toBe("MEAL_PLAN_UPDATED");
  });

  it("carries no data key — nothing on the lock screen needs an id", () => {
    expect("data" in AI_PLAN_ACCEPTANCE_PUSH).toBe(false);
  });

  it("matches the exact frozen G03 strings, so any edit is a deliberate, reviewed diff", () => {
    expect(AI_PLAN_ACCEPTANCE_PUSH).toStrictEqual({
      title: "Plan updated",
      body: "Your coach updated your plan. Open Steadfast to see it.",
      type: "MEAL_PLAN_UPDATED",
    });
  });
});
