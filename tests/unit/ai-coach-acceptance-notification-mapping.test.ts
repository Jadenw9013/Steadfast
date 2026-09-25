import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * T-502 — table-driven proof of `deliverAiPlanAcceptanceNotification`'s
 * APNs-status mapping. T-2037: `sendPushToUser` reports `{ sent: true,
 * result }` for every non-200 APNs response, not just success, so this
 * seam must narrow `result` itself rather than trust `sent`. A drain that
 * trusted `sent` would mark a 410-Unregistered token DELIVERED forever.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sendPushToUser: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/notifications/push", () => ({
  sendPushToUser: mocks.sendPushToUser,
}));

import { deliverAiPlanAcceptanceNotification } from "@/lib/notifications/ai-coach-plan";

const ELIGIBLE_USER = {
  isDeactivated: false,
  isClient: true,
  pushMealPlanUpdates: true,
  apnsToken: "device-token",
  deletionRequest: null,
};

describe("deliverAiPlanAcceptanceNotification — APNs mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(ELIGIBLE_USER);
  });

  it.each([
    [{ sent: true, result: { success: true, status: 200 } }, { status: "RESOLVED", outcome: "DELIVERED" }],
    [{ sent: true, result: { success: false, status: 410 } }, { status: "RESOLVED", outcome: "SUPPRESSED_NO_DEVICE" }],
    [
      { sent: true, result: { success: false, status: 400 } },
      { status: "FAILED", errorCode: "APNS_REJECTED", budgetConsumed: true },
    ],
    [
      { sent: false, reason: "No device token" },
      { status: "RESOLVED", outcome: "SUPPRESSED_NO_DEVICE" },
    ],
    [
      { sent: false, error: "socket hang up" },
      { status: "FAILED", errorCode: "APNS_UNAVAILABLE", budgetConsumed: true },
    ],
    [
      { sent: true, result: { success: false, error: "Missing config" } },
      { status: "FAILED", errorCode: "PUSH_CONFIG_MISSING", budgetConsumed: false },
    ],
  ] as const)("maps %j to %j", async (sendResult, expected) => {
    mocks.sendPushToUser.mockResolvedValue(sendResult);
    const result = await deliverAiPlanAcceptanceNotification("client-1");
    expect(result).toStrictEqual(expected);
  });

  it("never produces a lastErrorCode outside the closed AiPlanNotificationErrorCode union", async () => {
    const cases = [
      { sent: true, result: { success: false, status: 403 } },
      { sent: true, result: { success: false, status: 404 } },
      { sent: true, result: { success: false, status: 413 } },
      { sent: true, result: { success: false, status: 429 } },
      { sent: true, result: { success: false, status: 500 } },
      { sent: false, error: "boom" },
    ] as const;
    const closedSet = new Set(["APNS_REJECTED", "APNS_UNAVAILABLE", "PUSH_CONFIG_MISSING", "UNKNOWN"]);
    for (const sendResult of cases) {
      mocks.sendPushToUser.mockResolvedValue(sendResult);
      const result = await deliverAiPlanAcceptanceNotification("client-1");
      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") expect(closedSet.has(result.errorCode)).toBe(true);
    }
  });
});
