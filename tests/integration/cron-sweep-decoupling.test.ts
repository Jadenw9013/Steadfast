import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F08 — the account-deletion purge sweep and the storage-cleanup outbox
 * sweep are piggybacked on the check-in-reminders cron. Both used to live
 * inside the same try block as reminder-sending, so an exception while
 * sending reminders (a bad cadence config, a transient DB error mid-loop)
 * skipped both sweeps entirely for that invocation, silently deferring
 * account deletion with no failure signal of its own.
 *
 * Required regression: a failure in the reminder phase must not suppress
 * the purge/cleanup sweeps.
 */

import { db } from "@/lib/db";
import { GET as cronGet } from "@/app/api/cron/checkin-reminders/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/account-deletion/sweep", () => ({
  sweepAccountDeletions: vi.fn().mockResolvedValue({ processed: 3, errors: 0 }),
}));
vi.mock("@/lib/storage/cleanup-outbox", () => ({
  processStorageCleanupOutbox: vi.fn().mockResolvedValue({ processed: 2, failed: 0, abandoned: 0 }),
}));

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("F08 — reminder failures never suppress the purge/cleanup sweeps", () => {
  const originalSecret = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    vi.restoreAllMocks();
  });
  afterAll(async () => { await db.$disconnect(); });

  function req() {
    return new NextRequest("https://example.test/api/cron/checkin-reminders", {
      headers: { authorization: "Bearer test-secret" },
    });
  }

  it("still runs both sweeps when the reminder phase throws", async () => {
    vi.spyOn(db.user, "findMany").mockRejectedValueOnce(new Error("simulated reminder-phase failure"));

    const res = await cronGet(req());
    expect(res.status).toBe(200);
    const body = await res.json() as { reminderError?: string; purge: { processed: number }; storageCleanup: { processed: number } };

    expect(body.reminderError).toContain("simulated reminder-phase failure");
    expect(body.purge.processed).toBe(3);
    expect(body.storageCleanup.processed).toBe(2);
  });

  it("still runs both sweeps when the reminder phase succeeds normally", async () => {
    vi.spyOn(db.user, "findMany").mockResolvedValue([]);

    const res = await cronGet(req());
    expect(res.status).toBe(200);
    const body = await res.json() as { reminderError?: string; purge: { processed: number }; storageCleanup: { processed: number } };

    expect(body.reminderError).toBeUndefined();
    expect(body.purge.processed).toBe(3);
    expect(body.storageCleanup.processed).toBe(2);
  });
});
