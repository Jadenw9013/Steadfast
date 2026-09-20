import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  getCurrentDbUser: vi.fn(),
  consumeQuota: vi.fn(),
  claimDailyReminder: vi.fn(),
  submitCheckIn: vi.fn(),
  userFindMany: vi.fn(),
  stripeFindUnique: vi.fn(),
  transaction: vi.fn(),
  sweepAccountDeletions: vi.fn(),
  processStorageCleanupOutbox: vi.fn(),
  constructStripeEvent: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => "00000000-0000-4000-8000-000000000921" };
});

vi.mock("@/lib/observability/sinks", () => ({
  activeSinks: () => [{ name: "test", emit: mocks.emit }],
}));

vi.mock("@/lib/auth/roles", () => ({
  getCurrentDbUser: mocks.getCurrentDbUser,
}));

vi.mock("@/lib/security/quota", () => ({
  consumeQuota: mocks.consumeQuota,
  claimDailyReminder: mocks.claimDailyReminder,
}));

vi.mock("@/lib/check-ins/submit", () => ({
  submitCheckIn: mocks.submitCheckIn,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: mocks.userFindMany },
    stripeWebhookEvent: { findUnique: mocks.stripeFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/account-deletion/sweep", () => ({
  sweepAccountDeletions: mocks.sweepAccountDeletions,
}));

vi.mock("@/lib/storage/cleanup-outbox", () => ({
  processStorageCleanupOutbox: mocks.processStorageCleanupOutbox,
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructStripeEvent } },
  getStripeWebhookSecret: () => "whsec_test",
}));

vi.mock("@/lib/billing", () => ({
  upsertCoachSubscriptionFromStripeSubscription: vi.fn(),
}));

import { AiCoachError } from "@/lib/ai-coach/access";
import { aiHttp } from "@/lib/ai-coach/http";
import { POST as submitCheckInRoute } from "@/app/api/client/checkin/route";
import { GET as checkinReminderCron } from "@/app/api/cron/checkin-reminders/route";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { isCriticalRoute } from "@/lib/observability/critical-paths";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe.sequential : describe.skip;
const originalCronSecret = process.env.CRON_SECRET;

suite("T-921 critical-path error capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentDbUser.mockResolvedValue({ id: "client_1", isClient: true });
    mocks.consumeQuota.mockResolvedValue(true);
    mocks.claimDailyReminder.mockResolvedValue(true);
    mocks.sweepAccountDeletions.mockResolvedValue({ processed: 3, errors: 0 });
    mocks.processStorageCleanupOutbox.mockResolvedValue({
      processed: 2,
      failed: 0,
      abandoned: 0,
    });
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
    vi.restoreAllMocks();
  });

  it("reports a reminder-phase failure while preserving both later sweeps and the response", async () => {
    process.env.CRON_SECRET = "test-secret";
    mocks.userFindMany.mockRejectedValueOnce(new Error("simulated reminder-phase failure"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await checkinReminderCron(
      new NextRequest("https://example.test/api/cron/checkin-reminders", {
        headers: { authorization: "Bearer test-secret" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sentClientReminders: 0,
      sentEmailReminders: 0,
      sentCoachAlerts: 0,
      reminderError: "simulated reminder-phase failure",
      purge: { processed: 3, errors: 0 },
      storageCleanup: { processed: 2, failed: 0, abandoned: 0 },
    });
    expect(mocks.sweepAccountDeletions).toHaveBeenCalledTimes(1);
    expect(mocks.processStorageCleanupOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "sf.cron.failed",
        route: "/api/cron/checkin-reminders",
        context: { job: "checkin-reminders", phase: "reminders" },
      })
    );
    consoleSpy.mockRestore();
  });

  it("keeps the AI Coach 503 envelope while omitting an arbitrary error message", async () => {
    const response = await aiHttp(
      new NextRequest("https://example.test/api/client/ai-coach", {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
      false,
      async () => {
        throw new Error("client note: bob@example.com");
      }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "TEMPORARILY_UNAVAILABLE",
        message: "This request could not finish. Please try again.",
        retryable: true,
      },
      requestId: "00000000-0000-4000-8000-000000000921",
    });
    const event = mocks.emit.mock.calls[0][0];
    expect(event).toEqual(
      expect.objectContaining({
        evt: "sf.aicoach.envelope_failed",
        errorName: "Error",
        statusCode: 503,
      })
    );
    expect(event).not.toHaveProperty("errorMessage");
    expect(JSON.stringify(event)).not.toContain("bob@example.com");
  });

  it("does not report a deliberate AI Coach error", async () => {
    const response = await aiHttp(
      new NextRequest("https://example.test/api/client/ai-coach", {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
      false,
      async () => {
        throw new AiCoachError("FORBIDDEN", "A client account is required.", 403);
      }
    );

    expect(response.status).toBe(403);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("reports a caught check-in 500 without changing its response", async () => {
    mocks.submitCheckIn.mockRejectedValueOnce(new Error("database unavailable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await submitCheckInRoute(
      new NextRequest("https://example.test/api/client/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    const event = mocks.emit.mock.calls[0][0];
    expect(event).toEqual(
      expect.objectContaining({
        evt: "sf.route.failed",
        route: "/api/client/checkin",
        method: "POST",
        statusCode: 500,
      })
    );
    expect(isCriticalRoute(event.route)).toBe(true);
    consoleSpy.mockRestore();
  });

  it("reports Stripe processing metadata without forwarding its payload", async () => {
    mocks.constructStripeEvent.mockReturnValue({
      id: "evt_safe",
      type: "customer.unknown",
      created: 1_700_000_000,
      data: { object: { customer: "cus_private", email: "alice@example.com" } },
    });
    mocks.stripeFindUnique.mockResolvedValue(null);
    mocks.transaction.mockRejectedValueOnce(new Error("transaction failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await stripeWebhook(
      new NextRequest("https://example.test/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "signed" },
        body: "{}",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Webhook handler error");
    const event = mocks.emit.mock.calls[0][0];
    expect(event).toEqual(
      expect.objectContaining({
        evt: "sf.webhook.failed",
        route: "/api/webhooks/stripe",
        ids: { requestId: "evt_safe" },
        context: {
          provider: "stripe",
          phase: "processing",
          eventType: "customer.unknown",
        },
      })
    );
    const encoded = JSON.stringify(event);
    expect(encoded).not.toContain("cus_private");
    expect(encoded).not.toContain("alice@example.com");
    consoleSpy.mockRestore();
  });
});
