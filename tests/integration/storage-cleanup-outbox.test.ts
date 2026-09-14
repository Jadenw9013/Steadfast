import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB09 — replacing a check-in photo deleted its CheckInPhoto row without
 * ever recording that the underlying storage object still needed
 * deleting, so it was orphaned forever (surviving even a later full
 * account-deletion purge, which only ever enumerated currently-linked
 * rows). F08 also requires that a failure in reminder-sending cannot
 * suppress the account-deletion purge sweep that's piggybacked on the
 * same cron invocation.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V07): replacement enqueues durable cleanup; cleanup failure/retry is
 * possible via the outbox; a failure elsewhere in the cron does not
 * suppress deletion-related sweeps.
 */

const mocks = vi.hoisted(() => ({ authUserId: "", remove: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ storage: { from: (bucket: string) => ({ remove: (paths: string[]) => mocks.remove(bucket, paths) }) } }),
}));

import { db } from "@/lib/db";
import { createCheckIn } from "@/app/actions/check-in";
import { enqueueStorageCleanup, processStorageCleanupOutbox } from "@/lib/storage/cleanup-outbox";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("CB09 — durable storage cleanup outbox with real PostgreSQL constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue({ error: null });
  });
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoachClient() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, isClient: false } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isCoach: false, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    return { coach, client };
  }

  it("replacing check-in photos enqueues the old paths for cleanup instead of losing the reference", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;

    await createCheckIn({ weight: 150, photoPaths: [`${client.clerkId}/batch/old1.jpg`, `${client.clerkId}/batch/old2.jpg`] });
    await createCheckIn({ weight: 151, overwriteToday: true, photoPaths: [`${client.clerkId}/batch/new.jpg`] });

    const outboxRows = await db.storageCleanupOutbox.findMany({ where: { bucket: "check-in-photos", storagePath: { startsWith: `${client.clerkId}/` } } });
    const paths = outboxRows.map((r) => r.storagePath).sort();
    expect(paths).toEqual([`${client.clerkId}/batch/old1.jpg`, `${client.clerkId}/batch/old2.jpg`]);
    expect(outboxRows.every((r) => r.processedAt === null)).toBe(true);
  });

  it("processStorageCleanupOutbox deletes enqueued objects and marks them processed", async () => {
    await enqueueStorageCleanup([
      { bucket: "check-in-photos", storagePath: `test/${randomUUID()}.jpg`, reason: "test" },
    ]);

    const result = await processStorageCleanupOutbox();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(mocks.remove).toHaveBeenCalled();

    const remaining = await db.storageCleanupOutbox.count({ where: { processedAt: null } });
    expect(remaining).toBe(0);
  });

  it("a storage removal failure leaves the entry unprocessed with attempts/lastError recorded, for retry", async () => {
    mocks.remove.mockResolvedValueOnce({ error: { message: "network error" } });
    const path = `test/${randomUUID()}.jpg`;
    await enqueueStorageCleanup([{ bucket: "check-in-photos", storagePath: path, reason: "test" }]);

    const firstAttempt = await processStorageCleanupOutbox();
    expect(firstAttempt.failed).toBeGreaterThanOrEqual(1);

    const row = await db.storageCleanupOutbox.findUniqueOrThrow({ where: { bucket_storagePath: { bucket: "check-in-photos", storagePath: path } } });
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("network error");

    // Retry succeeds.
    const secondAttempt = await processStorageCleanupOutbox();
    expect(secondAttempt.processed).toBeGreaterThanOrEqual(1);
    const rowAfter = await db.storageCleanupOutbox.findUniqueOrThrow({ where: { bucket_storagePath: { bucket: "check-in-photos", storagePath: path } } });
    expect(rowAfter.processedAt).not.toBeNull();
  });

  it("enqueueing the same path twice does not error (idempotent)", async () => {
    const path = `test/${randomUUID()}.jpg`;
    await enqueueStorageCleanup([{ bucket: "check-in-photos", storagePath: path, reason: "first" }]);
    await enqueueStorageCleanup([{ bucket: "check-in-photos", storagePath: path, reason: "second" }]);
    const count = await db.storageCleanupOutbox.count({ where: { bucket: "check-in-photos", storagePath: path } });
    expect(count).toBe(1);
  });
});
