import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), deleteIdentity: vi.fn(), billing: vi.fn(), authUserId: "" }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ storage: { from: (bucket: string) => ({ remove: (paths: string[]) => mocks.remove(bucket, paths) }) } }) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn(), clerkClient: async () => ({ users: { deleteUser: mocks.deleteIdentity } }) }));
vi.mock("@/lib/account-deletion/billing", () => ({ stopAccountBilling: mocks.billing }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
import { NextRequest } from "next/server";
import { sendMessage } from "@/app/actions/messages";
import { createCheckIn } from "@/app/actions/check-in";
import { POST as postMessage } from "@/app/api/messages/route";
import { POST as requestDeletion } from "@/app/api/actions/account-deletion/route";
import { POST as cancelDeletion } from "@/app/api/actions/account-deletion/cancel/route";
import { db } from "@/lib/db";
import { consumeQuota } from "@/lib/security/quota";
import { purgeUserAccount } from "@/lib/account-deletion/purge";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;
suite("account deletion with real PostgreSQL constraints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.deleteIdentity.mockResolvedValue({});
    mocks.billing.mockResolvedValue(undefined);
  });
  afterAll(async () => { await db.$disconnect(); });
  async function fixture(coach = false) {
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: coach, isClient: true, isDeactivated: true } });
    const otherId = randomUUID();
    const other = await db.user.create({ data: { clerkId: otherId, email: `${otherId}@example.test`, isCoach: true } });
    const receipt = await db.accountDeletionRequest.create({ data: { userId: user.id, roleAtRequest: coach ? "BOTH" : "CLIENT", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) } });
    await db.message.create({ data: { clientId: user.id, senderId: other.id, body: "Coach-authored message", weekOf: new Date() } });
    await db.userBlock.create({ data: { blockerId: other.id, blockedId: user.id } });
    await db.messageReport.create({ data: { reporterId: user.id, reportedId: other.id, reason: "test" } });
    const checkIn = await db.checkIn.create({ data: { clientId: user.id, weekOf: new Date(), weight: 160, photos: { create: [ { storagePath: `${id}/web-batch/photo.jpg` }, { storagePath: "ios-checkin/photo.jpg" } ] } } });
    if (coach) {
      await db.coachProfile.create({ data: { userId: user.id, slug: id } });
      await db.mealPlanUpload.create({ data: { coachId: user.id, clientId: other.id, storagePath: `${id}/plan.pdf`, draft: { create: { parsedJson: {} } } } });
    }
    return { user, other, receipt, checkIn };
  }
  it("enforces blocks in both the web action and mobile REST route", async () => {
    const { user, other } = await fixture();
    await db.user.update({ where: { id: other.id }, data: { activeRole: "COACH" } });
    await db.coachClient.create({ data: { coachId: other.id, clientId: user.id } });
    mocks.authUserId = other.clerkId;
    await expect(sendMessage({ clientId: user.id, weekStartDate: "2026-09-07", body: "blocked" })).rejects.toThrow("can't message");
    const response = await postMessage(new NextRequest("https://example.test/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: user.id, content: "blocked" }) }));
    expect(response.status).toBe(403);
    expect(await db.message.count({ where: { clientId: user.id, body: "blocked" } })).toBe(0);
  });
  it("rejects attaching another account's photo through the web action", async () => {
    const { user, other } = await fixture();
    await db.user.update({ where: { id: user.id }, data: { isDeactivated: false } });
    await db.coachClient.create({ data: { coachId: other.id, clientId: user.id } });
    mocks.authUserId = user.clerkId;
    const result = await createCheckIn({ weight: 160, photoPaths: [`${other.clerkId}/batch/private.jpg`] });
    expect(result).toMatchObject({ error: { photoPaths: expect.any(Array) } });
  });
  it("supports deletion and cancellation through the mobile REST contract", async () => {
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    mocks.authUserId = id;
    const response = await requestDeletion(new NextRequest("https://example.test/api/actions/account-deletion", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationText: "DELETE MY ACCOUNT" }),
    }));
    expect(response.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isDeactivated).toBe(true);
    const cancelled = await cancelDeletion(new NextRequest("https://example.test/api/actions/account-deletion/cancel", { method: "POST" }));
    expect(cancelled.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isDeactivated).toBe(false);
  });
  it("enforces one quota across concurrent callers", async () => {
    const quotaId = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeQuota("test", quotaId, 5, 60)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });
  it.each([false, true])("purges messages/blocks/reports and preserves the receipt (coach=%s)", async coach => {
    const { user, other, receipt } = await fixture(coach);
    await purgeUserAccount(user.id);
    expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await db.accountDeletionRequest.findUnique({ where: { id: receipt.id } })).toMatchObject({ status: "COMPLETED", userId: null });
    expect(mocks.remove).toHaveBeenCalledWith("check-in-photos", expect.arrayContaining([`${user.clerkId}/web-batch/photo.jpg`, "ios-checkin/photo.jpg"]));
  });
  it("purges AI Coach records (A02/A03) on account deletion", async () => {
    const { user } = await fixture();
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI", revision: 1 } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiIntakeDraft.create({ data: { clientId: user.id, answers: { goal: "STRENGTH" } } });
    await db.aiCoachReviewerGrant.create({ data: { userId: user.id, qualificationNote: "test fixture" } });
    const profile = await db.aiCoachProfile.create({ data: { clientId: user.id } });
    await db.aiSafetyDisclosureEvent.create({
      data: {
        clientId: user.id, structuredAnswers: {}, dispositionAfter: "CLEAR",
        nutritionPermissionAfter: "ALLOW", strengthPermissionAfter: "ALLOW", cardioPermissionAfter: "ALLOW",
        safetyRevisionAfter: 1,
      },
    });
    const plan = await db.aiPlanVersion.create({
      data: {
        clientId: user.id, version: 1, status: "ACCEPTED", acceptedAt: new Date(),
        payload: {}, payloadHash: "hash", contextRevision: 1, profileRevision: 1,
        observationRevision: 1, safetyRevision: 1, policyVersion: "p1", catalogVersions: {},
      },
    });
    await db.aiCoachProfile.update({ where: { id: profile.id }, data: { activePlanVersionId: plan.id } });
    await db.aiAdjustmentSlot.create({ data: { clientId: user.id, reviewWindowKey: "2026-W01", acceptedPlanVersionId: plan.id } });
    await db.aiPlanAcceptanceOutbox.create({ data: { clientId: user.id, planVersionId: plan.id } });
    await db.aiPlanAcceptanceReceipt.create({ data: { clientId: user.id, requestKey: "test-key", inputDigest: "digest", planVersionId: plan.id, alreadyAccepted: false, activeVersionIdAtReceiptTime: plan.id } });
    await db.aiWorkoutSession.create({
      data: { clientId: user.id, clientEventId: "evt-1", planVersionId: plan.id, exerciseId: "ex-1", occurredAt: new Date(), timezone: "UTC", setIndex: 0, loadKind: "BODYWEIGHT" },
    });
    const run = await db.aiCoachRun.create({
      data: { clientId: user.id, kind: "WEEKLY_REVIEW", businessKey: randomUUID(), contextRevision: 1, profileRevision: 1, observationRevision: 1, safetyRevision: 1 },
    });

    await purgeUserAccount(user.id);

    expect(await db.clientCoachingContext.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachEntitlement.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiIntakeDraft.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachReviewerGrant.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await db.aiSafetyDisclosureEvent.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiPlanVersion.findUnique({ where: { id: plan.id } })).toBeNull();
    expect(await db.aiAdjustmentSlot.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiWorkoutSession.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await db.aiPlanAcceptanceOutbox.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiPlanAcceptanceReceipt.findFirst({ where: { clientId: user.id } })).toBeNull();
  });
  it("keeps all DB records and identity when storage cleanup fails", async () => {
    const { user, receipt, checkIn } = await fixture();
    mocks.remove.mockResolvedValue({ error: { message: "storage unavailable" } });
    await expect(purgeUserAccount(user.id)).rejects.toThrow("Storage cleanup failed");
    expect(mocks.deleteIdentity).not.toHaveBeenCalled();
    expect(await db.checkIn.findUnique({ where: { id: checkIn.id } })).not.toBeNull();
    expect((await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("PURGING");
  });
  it("keeps DB records when identity deletion fails", async () => {
    const { user, checkIn } = await fixture();
    mocks.deleteIdentity.mockRejectedValue(new Error("Clerk unavailable"));
    await expect(purgeUserAccount(user.id)).rejects.toThrow("Clerk unavailable");
    expect(await db.checkIn.findUnique({ where: { id: checkIn.id } })).not.toBeNull();
  });
  it("rolls back earlier deletes on a database failure and succeeds on retry", async () => {
    const { user, checkIn } = await fixture();
    await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "PurgeTestGuard" ("userId" text REFERENCES "User"(id) ON DELETE RESTRICT)');
    await db.$executeRaw`INSERT INTO "PurgeTestGuard" ("userId") VALUES (${user.id})`;
    await expect(purgeUserAccount(user.id)).rejects.toThrow();
    expect(await db.checkIn.findUnique({ where: { id: checkIn.id } })).not.toBeNull();
    await db.$executeRaw`DELETE FROM "PurgeTestGuard" WHERE "userId" = ${user.id}`;
    await purgeUserAccount(user.id);
    expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});
