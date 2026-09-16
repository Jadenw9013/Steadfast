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
// T-672: the coach DM Server Component is exercised directly, so its two
// rendering-time dependencies are stubbed. Both mocks are file-scoped and no
// other test in this file imports either module.
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/messages/message-thread", () => ({ MessageThread: function MessageThread() { return null; } }));

import { db } from "@/lib/db";
import { sendMessage } from "@/app/actions/messages";
import { GET as getMessagesRoute } from "@/app/api/messages/route";
import { GET as getCoachWeeklyMessagesRoute } from "@/app/api/coach/clients/[clientId]/messages/route";
import { getAllMessages, getMessages } from "@/lib/queries/messages";
import CoachClientMessagesPage from "@/app/coach/clients/[clientId]/messages/page";
import { MessageThread } from "@/components/messages/message-thread";
import { NextRequest } from "next/server";

/**
 * The coach DM page is an async Server Component: awaiting it yields a React
 * element tree without rendering it, so the assertion is made on the props the
 * page hands to MessageThread. That matters — MessageThread polls the already
 * scoped GET /api/messages on mount and replaces its list, so a browser-level
 * assertion passes even against the pre-T-672 leak. The leak lives in the
 * server-rendered HTML and the RSC payload, which is what these props are.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function threadMessages(node: any): { body: string; senderId: string }[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(threadMessages);
  if (node.type === MessageThread) return node.props.messages;
  return threadMessages(node.props?.children);
}

async function coachPageMessages(clientId: string) {
  const tree = await CoachClientMessagesPage({ params: Promise.resolve({ clientId }) });
  return threadMessages(tree);
}

async function coachPageBodies(clientId: string) {
  return (await coachPageMessages(clientId)).map((m) => m.body);
}

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
    const otherCoach = await makeCoach("AmbigOtherCoach");
    const client = await makeClient("AmbigClient");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.coachClient.create({ data: { coachId: otherCoach.id, clientId: client.id } });

    // Simulate a legacy row with no recoverable recipient: client-authored,
    // coachId left NULL. The client has two CoachClient rows, so no single
    // coach can be attributed — not even by the T-661 single-coach backfill
    // (20260915000000_message_coach_backfill_single_coach), which only writes
    // rows for clients with exactly one relationship. The requester is one of
    // the two coaches, so the read is authorized and this stays a filter test.
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
  // --- T-672: app/coach/clients/[clientId]/messages/page.tsx ---------------
  // The page fetched every message for the client with no coachId filter, so
  // a successor coach received a predecessor's conversation in the SSR HTML
  // and the RSC payload. These cases assert the page's output props.

  const concurrentWeek = new Date("2026-01-05T00:00:00Z");

  /**
   * Coach A's whole history, then the client is handed to coach B — the
   * moment of handover, before B has sent anything. This is the state with the
   * largest blast radius on this page: the only correct thread for B is empty.
   */
  async function handoverFixture() {
    const coachA = await makeCoach("PageCoachA");
    const coachB = await makeCoach("PageCoachB");
    const client = await makeClient("PageClient");

    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    mocks.authUserId = coachA.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Hi from coach A" });
    mocks.authUserId = client.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Reply to coach A" });

    await db.coachClient.deleteMany({ where: { coachId: coachA.id, clientId: client.id } });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id } });

    return { coachA, coachB, client };
  }

  /** The same handover, continued: coach B and the client exchange messages. */
  async function successorFixture() {
    const { coachA, coachB, client } = await handoverFixture();

    mocks.authUserId = coachB.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-12", body: "Hi from coach B" });
    mocks.authUserId = client.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-12", body: "Reply to coach B" });

    return { coachA, coachB, client };
  }

  /**
   * Two concurrently assigned coaches. The client replies are written
   * directly with an explicit coachId: sendMessage resolves a client's coach
   * with an unordered findFirst, which is non-deterministic for a two-coach
   * client.
   */
  async function concurrentFixture() {
    const coachA = await makeCoach("BothCoachA");
    const coachB = await makeCoach("BothCoachB");
    const client = await makeClient("BothClient");
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id } });

    mocks.authUserId = coachA.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "A concurrent note" });
    await db.message.create({
      data: { clientId: client.id, senderId: client.id, weekOf: concurrentWeek, body: "reply to A", coachId: coachA.id },
    });

    mocks.authUserId = coachB.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "B concurrent note" });
    await db.message.create({
      data: { clientId: client.id, senderId: client.id, weekOf: concurrentWeek, body: "reply to B", coachId: coachB.id },
    });

    return { coachA, coachB, client };
  }

  it("case A — the coach DM page hands a successor coach only their own thread, across every week", async () => {
    const { coachB, client } = await successorFixture();

    mocks.authUserId = coachB.clerkId;
    const bodies = await coachPageBodies(client.id);

    // Exact array: both of coach B's weeks, in createdAt order, and nothing
    // from coach A. An exact match also catches an over-narrow fix that
    // truncates the thread to a single weekOf.
    expect(bodies).toEqual(["Hi from coach B", "Reply to coach B"]);
    expect(bodies).not.toContain("Hi from coach A");
    expect(bodies).not.toContain("Reply to coach A");
  });

  it("case A2 — a successor coach with no messages of their own gets an empty thread, never the predecessor's", async () => {
    // The first second of every handover, and the highest-risk state on this
    // page: the client has a long history with coach A, coach B opens the DM
    // page before sending anything. The only correct answer is []; the wrong
    // answer is coach A's entire thread. Pins against a later "the thread looks
    // broken, let me be helpful" fallback of the shape
    //   if (scoped.length === 0) return getAllMessages(clientId)
    // which every other case in this file would still pass.
    const { client, coachB } = await handoverFixture();

    mocks.authUserId = coachB.clerkId;
    expect(await coachPageBodies(client.id)).toEqual([]);

    // Not a vacuous empty: coach A's conversation is still on disk and still in
    // the client's own archive, it is simply not coach B's to read.
    const archive = await getAllMessages(client.id);
    expect(archive.map((m) => m.body)).toEqual(["Hi from coach A", "Reply to coach A"]);
  });

  it("case B — two concurrently assigned coaches each get only their own conversation, while the client archive keeps both", async () => {
    const { coachA, coachB, client } = await concurrentFixture();

    mocks.authUserId = coachA.clerkId;
    expect(await coachPageBodies(client.id)).toEqual(["A concurrent note", "reply to A"]);

    mocks.authUserId = coachB.clerkId;
    expect(await coachPageBodies(client.id)).toEqual(["B concurrent note", "reply to B"]);

    // AC #4: the client's own unfiltered archive is untouched.
    const archive = await getAllMessages(client.id);
    expect(archive.map((m) => m.body)).toEqual(
      expect.arrayContaining(["A concurrent note", "reply to A", "B concurrent note", "reply to B"])
    );
  });

  it("case C — a legacy client-authored message with no coachId is not shown on the coach DM page but stays in the client archive", async () => {
    const coach = await makeCoach("NullCoach");
    const client = await makeClient("NullClient");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });

    mocks.authUserId = coach.clerkId;
    await sendMessage({ clientId: client.id, weekStartDate: "2026-01-05", body: "Attributed coach note" });
    await db.message.create({
      data: { clientId: client.id, senderId: client.id, weekOf: new Date("2025-01-06T00:00:00Z"), body: "legacy unattributed reply", coachId: null },
    });

    mocks.authUserId = coach.clerkId;
    const bodies = await coachPageBodies(client.id);
    expect(bodies).toContain("Attributed coach note");
    expect(bodies).not.toContain("legacy unattributed reply");

    const archive = await getAllMessages(client.id);
    expect(archive.map((m) => m.body)).toContain("legacy unattributed reply");
  });

  it("case D — the coach DM page still 404s for a coach with no assignment (regression)", async () => {
    const outsider = await makeCoach("OutsiderCoach");
    const client = await makeClient("UnassignedClient");

    mocks.authUserId = outsider.clerkId;
    await expect(
      CoachClientMessagesPage({ params: Promise.resolve({ clientId: client.id }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("case E — the client-facing query functions are unchanged by the new optional parameter (regression)", async () => {
    const { client } = await concurrentFixture();

    // One argument: the full archive, unfiltered, createdAt asc.
    const archive = await getAllMessages(client.id);
    expect(archive.map((m) => m.body)).toEqual([
      "A concurrent note",
      "reply to A",
      "B concurrent note",
      "reply to B",
    ]);

    // Two arguments: still unfiltered by coach for the client's own week view.
    const week = await getMessages(client.id, concurrentWeek);
    expect(week.map((m) => m.body)).toEqual(
      expect.arrayContaining(["A concurrent note", "reply to A", "B concurrent note", "reply to B"])
    );
  });

  it("case F — the coach DM page and GET /api/messages return the same bodies, so the SSR list and the 4s poll no longer disagree", async () => {
    const { coachB, client } = await successorFixture();

    mocks.authUserId = coachB.clerkId;
    const pageMessages = await coachPageMessages(client.id);
    const pageBodies = pageMessages.map((m) => m.body);

    const req = new NextRequest(`https://example.test/api/messages?clientId=${client.id}`);
    const res = await getMessagesRoute(req);
    const apiBody = await res.json() as { messages: { body: string; senderId: string }[] };
    const apiBodies = apiBody.messages.map((m) => m.body);

    // The set pin: same rows, in the same order, from both readers.
    expect(pageBodies).toEqual(apiBodies);
    expect(pageBodies).toEqual(["Hi from coach B", "Reply to coach B"]);

    // The shape pin: the SSR props carry senderId like the route does, so the
    // two payloads for the same list cannot drift field-wise either.
    const pick = (m: { body: string; senderId: string }) => ({ body: m.body, senderId: m.senderId });
    expect(pageMessages.map(pick)).toEqual(apiBody.messages.map(pick));
    expect(pageMessages.every((m) => typeof m.senderId === "string" && m.senderId.length > 0)).toBe(true);
  });
});
