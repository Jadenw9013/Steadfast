import { describe, it, expect, vi } from "vitest";

/**
 * T-801 — pure-input tests for lib/meal-plans/history.ts: the query schema
 * shared by the REST route and the web history page, the frozen
 * history-status set, and the two frozen user-facing error sentences (both
 * transports read `error` verbatim — APIService.swift:188-206 — so they must
 * stay short and HTML-free).
 */

// Hoisted no-op db mock in the style of tests/unit/prisma-error.test.ts:
// history.ts imports `db` at module scope but none of these exports touch it.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  mealPlanHistoryQuerySchema,
  MEAL_PLAN_HISTORY_STATUSES,
  sourceNotRestorableMessage,
  draftExistsMessage,
} from "@/lib/meal-plans/history";

describe("mealPlanHistoryQuerySchema", () => {
  it("defaults limit to 50 and offset to 0", () => {
    const parsed = mealPlanHistoryQuerySchema.parse({});
    expect(parsed).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces a string limit", () => {
    expect(mealPlanHistoryQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });

  it("coerces a string offset", () => {
    expect(mealPlanHistoryQuerySchema.parse({ offset: "20" }).offset).toBe(20);
  });

  it("rejects limit=0 (below the min)", () => {
    expect(mealPlanHistoryQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("rejects limit=101 (above the max)", () => {
    expect(mealPlanHistoryQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects a non-numeric limit", () => {
    expect(mealPlanHistoryQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    expect(mealPlanHistoryQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
  });

  it("rejects a non-integer limit", () => {
    expect(mealPlanHistoryQuerySchema.safeParse({ limit: "2.5" }).success).toBe(false);
  });
});

describe("MEAL_PLAN_HISTORY_STATUSES", () => {
  it("contains exactly PUBLISHED and SUPERSEDED, never DRAFT", () => {
    expect(MEAL_PLAN_HISTORY_STATUSES).toEqual(["PUBLISHED", "SUPERSEDED"]);
    expect(MEAL_PLAN_HISTORY_STATUSES).not.toContain("DRAFT");
  });
});

describe("frozen user-facing sentences", () => {
  const messages = [
    ["sourceNotRestorableMessage", sourceNotRestorableMessage()],
    ["draftExistsMessage", draftExistsMessage()],
  ] as const;

  it.each(messages)("%s is non-empty, HTML-free, and <= 300 chars", (_name, message) => {
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/[<>]/);
    expect(message.length).toBeLessThanOrEqual(300);
  });

  it("sourceNotRestorableMessage has the exact frozen wording", () => {
    expect(sourceNotRestorableMessage()).toBe("Only published plan versions can be restored.");
  });

  it("draftExistsMessage has the exact frozen wording", () => {
    expect(draftExistsMessage()).toBe("This week already has a draft. Restoring will replace it.");
  });
});
