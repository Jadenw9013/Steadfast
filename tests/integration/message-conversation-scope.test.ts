import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB03 — messages are scoped by clientId only, with no per-coach
 * conversation boundary. A client changing from coach A to coach B let B
 * read every message A ever exchanged with that client, through every
 * read path (general API, coach weekly API, coach-workspace pages).
 *
 * Required regression (docs/ai-coach/03-Codebase-Audit.md CB03,
 * docs/ai-coach/09-Validation-Release-Operations.md V02): B cannot read
 * A's private conversation; the client's own archive remains available;
 * ambiguous legacy history is not assigned by guesswork.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messages/permissions", () => ({ assertMessagingAllowed: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/sms/notify", () => ({ notifyCoachMessage: vi.fn().mockResolvedValue(undefined), notifyClientMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/notifications/push", () => ({ pushNewMessage: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { sendMessage } from "@/app/actions/messages";
import { GET as getMessagesRoute } from "@/app/api/messages/route";
import { GET as getCoachWeeklyMessagesRoute } from "@/app/api/coach/clients/[clientId]/messages/route";
import { getAllMessages } from "@/lib/queries/messages";
import { NextRequest } from "next/server";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("CB03 — messages are scoped to a specific coach conversation with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoach(label: string) {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${label}-${id}@example.test`, isCoach: true, isClient: false, activeRole: "COACH", firstName: label } });
  }

  async function makeClient(label: string) {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${label}-${id}@example.test`, isCoach: false, isClient: true, activeRole: "CLIENT", firstName: label } });
  }

  it("a successor coach cannot read the predecessor coach's conversation via the message query function", async () => {
    const coachA = await makeCoach("CoachA");
    const coachB = await makeCoach("CoachB");
    const client = await makeClient("Client");
    const weekOf = new Date("2026-01-05T00:00:00Z");

    // Era 1: assigned to coach A, both sides exchange messages.
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    mocks.authUserId = coachA.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Hi from coach A" });
    mocks.authUserId = client.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Reply to coach A" });

    // Client leaves coach A, gets assigned to coach B (hard delete, no history).
    await db.coachClient.deleteMany({ where: { coachId: coachA.id, clientId: client.id } });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id } });

    mocks.authUserId = coachB.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Hi from coach B" });

    // Coach B's scoped weekly view must show only coach B's own message.
    const request = new NextRequest(`https://example.test/api/coach/clients/${client.id}/messages?weekOf=2026-01-05`);
    const response = await getCoachWeeklyMessagesRoute(request, { params: Promise.resolve({ clientId: client.id }) });
    const body = await response.json() as { messages: { content: string }[] };
    const bodies = body.messages.map((m) => m.content);

    expect(bodies).toContain("Hi from coach B");
    expect(bodies).not.toContain("Hi from coach A");
    expect(bodies).not.toContain("Reply to coach A");

    // The client's own archive still has everything from both eras.
    const clientArchive = await getAllMessages(client.id);
    expect(clientArchive.map((m) => m.body)).toEqual(
      expect.arrayContaining(["Hi from coach A", "Reply to coach A", "Hi from coach B"])
    );
  });

  it("the general messages API scopes a coach requester but not the client themselves", async () => {
    const coachA = await makeCoach("GenA");
    const coachB = await makeCoach("GenB");
    const client = await makeClient("GenClient");

    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    mocks.authUserId = coachA.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Coach A private note" });

    await db.coachClient.deleteMany({ where: { coachId: coachA.id, clientId: client.id } });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id } });
    mocks.authUserId = coachB.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-12", body: "Coach B note" });

    // Coach B hits the general API — must not see coach A's message.
    mocks.authUserId = coachB.clerkId;
    const coachReq = new NextRequest(`https://example.test/api/messages?clientId=${client.id}`);
    const coachRes = await getMessagesRoute(coachReq);
    const coachBody = await coachRes.json() as { messages: { body: string }[] };
    const coachBodies = coachBody.messages.map((m) => m.body);
    expect(coachBodies).toContain("Coach B note");
    expect(coachBodies).not.toContain("Coach A private note");

    // The client hits the same API — sees the full archive.
    mocks.authUserId = client.clerkId;
    const clientReq = new NextRequest(`https://example.test/api/messages?clientId=${client.id}`);
    const clientRes = await getMessagesRoute(clientReq);
    const clientBody = await clientRes.json() as { messages: { body: string }[] };
    const clientBodies = clientBody.messages.map((m) => m.body);
    expect(clientBodies).toEqual(expect.arrayContaining(["Coach A private note", "Coach B note"]));
  });

  it("a pre-migration client-authored message with no recoverable recipient is never surfaced to any coach", async () => {
    const coach = await makeCoach("AmbigCoach");
    const client = await makeClient("AmbigClient");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });

    // Simulate a legacy row from before this migration's backfill: client-
    // authored, coachId left NULL because the original recipient could not
    // be reconstructed.
    await db.message.create({
      data: { clientId: client.id, senderId: client.id, weekOf: new Date("2025-01-06T00:00:00Z"), body: "legacy ambiguous reply", coachId: null },
    });

    mocks.authUserId = coach.clerkId;
    const req = new NextRequest(`https://example.test/api/messages?clientId=${client.id}`);
    const res = await getMessagesRoute(req);
    const resBody = await res.json() as { messages: { body: string }[] };
    expect(resBody.messages.map((m) => m.body)).not.toContain("legacy ambiguous reply");

    // But the client can still see it in their own archive.
    const archive = await getAllMessages(client.id);
    expect(archive.map((m) => m.body)).toContain("legacy ambiguous reply");
  });
});
