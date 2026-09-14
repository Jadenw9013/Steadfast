import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB07 — the check-in web action and iOS API route had diverging
 * validation, and the overwrite path in both unconditionally deleted
 * existing photos even when the caller never sent replacements. Template
 * lookups also accepted any templateId with no ownership check.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V04): equivalent web/API transport semantics, metric-only photo
 * preservation, foreign-template rejection, and preserved multiple-
 * submissions-per-day behavior.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyClientCheckInSubmitted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/notifications/push", () => ({ pushClientCheckinSubmitted: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { createCheckIn } from "@/app/actions/check-in";
import { POST as checkinApiPost } from "@/app/api/client/checkin/route";
import { NextRequest } from "next/server";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("CB07 — unified check-in service with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoachClient() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, isClient: false } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isCoach: false, isClient: true, timezone: "America/Los_Angeles" } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    return { coach, client };
  }

  it("rejects a templateId belonging to a different coach", async () => {
    const { client } = await makeCoachClient();
    const otherCoachClerkId = randomUUID();
    const otherCoach = await db.user.create({ data: { clerkId: otherCoachClerkId, email: `other-${otherCoachClerkId}@example.test`, isCoach: true } });
    const foreignTemplate = await db.checkInTemplate.create({ data: { coachId: otherCoach.id, name: "Foreign", questions: [] } });

    mocks.authUserId = client.clerkId;
    const result = await createCheckIn({ weight: 150, photoPaths: [], templateId: foreignTemplate.id }) as { error?: Record<string, string[]> };
    expect(result.error).toBeDefined();
    expect(result.error?.templateId).toBeDefined();

    const stored = await db.checkIn.findFirst({ where: { clientId: client.id } });
    expect(stored).toBeNull();
  });

  it("accepts a templateId belonging to the client's own assigned coach", async () => {
    const { coach, client } = await makeCoachClient();
    const template = await db.checkInTemplate.create({ data: { coachId: coach.id, name: "Weekly", questions: [{ id: "q1", label: "How was it?" }] } });

    mocks.authUserId = client.clerkId;
    const result = await createCheckIn({ weight: 150, photoPaths: [], templateId: template.id }) as { checkInId?: string };
    expect(result.checkInId).toBeDefined();

    const stored = await db.checkIn.findUniqueOrThrow({ where: { id: result.checkInId! } });
    expect(stored.templateId).toBe(template.id);
    expect(stored.templateSnapshot).toMatchObject({ name: "Weekly" });
  });

  it("an overwrite that omits photoPaths preserves existing photos (metric-only update)", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;

    const first = await createCheckIn({ weight: 150, photoPaths: [`${client.clerkId}/batch/a.jpg`] }) as { checkInId: string };
    const before = await db.checkInPhoto.findMany({ where: { checkInId: first.checkInId } });
    expect(before).toHaveLength(1);

    // Metric-only overwrite: no photoPaths key at all in the payload.
    const overwritten = await createCheckIn({ weight: 151, overwriteToday: true }) as { checkInId: string; overwritten: boolean };
    expect(overwritten.checkInId).toBe(first.checkInId);

    const after = await db.checkInPhoto.findMany({ where: { checkInId: first.checkInId } });
    expect(after).toHaveLength(1);
    expect(after[0].storagePath).toBe(`${client.clerkId}/batch/a.jpg`);

    const updated = await db.checkIn.findUniqueOrThrow({ where: { id: first.checkInId } });
    expect(updated.weight).toBe(151);
  });

  it("an overwrite that explicitly sends photoPaths replaces existing photos", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;

    const first = await createCheckIn({ weight: 150, photoPaths: [`${client.clerkId}/batch/old.jpg`] }) as { checkInId: string };

    const overwritten = await createCheckIn({
      weight: 150,
      overwriteToday: true,
      photoPaths: [`${client.clerkId}/batch/new.jpg`],
    }) as { checkInId: string };
    expect(overwritten.checkInId).toBe(first.checkInId);

    const after = await db.checkInPhoto.findMany({ where: { checkInId: first.checkInId } });
    expect(after).toHaveLength(1);
    expect(after[0].storagePath).toBe(`${client.clerkId}/batch/new.jpg`);
  });

  it("rejects a photo path that does not belong to the caller", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;
    const result = await createCheckIn({ weight: 150, photoPaths: ["someone-else/batch/photo.jpg"] }) as { error?: Record<string, string[]> };
    expect(result.error?.photoPaths).toBeDefined();
  });

  it("the web action and the iOS API route behave identically for the same input", async () => {
    const { client: webClient } = await makeCoachClient();
    const { client: apiClient } = await makeCoachClient();

    mocks.authUserId = webClient.clerkId;
    const webResult = await createCheckIn({ weight: 160, dietCompliance: 7, notes: "felt good" }) as { checkInId: string };

    mocks.authUserId = apiClient.clerkId;
    const apiReq = new NextRequest("https://example.test/api/client/checkin", {
      method: "POST",
      body: JSON.stringify({ weight: 160, dietCompliance: 7, notes: "felt good" }),
    });
    const apiRes = await checkinApiPost(apiReq);
    expect(apiRes.status).toBe(201);
    const apiBody = await apiRes.json() as { checkIn: { id: string } };

    const webRow = await db.checkIn.findUniqueOrThrow({ where: { id: webResult.checkInId } });
    const apiRow = await db.checkIn.findUniqueOrThrow({ where: { id: apiBody.checkIn.id } });
    expect(apiRow.weight).toBe(webRow.weight);
    expect(apiRow.dietCompliance).toBe(webRow.dietCompliance);
    expect(apiRow.status).toBe(webRow.status);
  });

  it("the API route now also requires weight, matching the web action", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;
    const req = new NextRequest("https://example.test/api/client/checkin", {
      method: "POST",
      body: JSON.stringify({ notes: "no weight given" }),
    });
    const res = await checkinApiPost(req);
    expect(res.status).toBe(422);
  });

  it("preserves multiple independent check-ins per day when overwriteToday is false", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;
    const first = await createCheckIn({ weight: 150, photoPaths: [] }) as { checkInId: string };
    const second = await createCheckIn({ weight: 150.5, photoPaths: [], overwriteToday: false }) as { checkInId: string };
    expect(second.checkInId).not.toBe(first.checkInId);

    const count = await db.checkIn.count({ where: { clientId: client.id, deletedAt: null } });
    expect(count).toBe(2);
  });

  it("the auto-posted check-in message is scoped to the client's assigned coach (CB03 consistency)", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;
    const result = await createCheckIn({ weight: 150, photoPaths: [] }) as { checkInId: string };

    const posted = await db.message.findFirst({ where: { clientId: client.id, body: { contains: result.checkInId } } });
    expect(posted).not.toBeNull();
    expect(posted?.coachId).toBe(coach.id);
  });
});
