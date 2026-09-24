import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";

/**
 * T-1012 / T-987 — invite redemption must work for every way a client can
 * sign in.
 *
 * The deployed check compared the invite's address against the Clerk PRIMARY
 * email only. That locked out: anyone whose invited address was a verified
 * secondary; iCloud users invited at an @me.com/@mac.com alias; Gmail users
 * whose coach typed dots differently; and EVERY Apple "Hide My Email" user,
 * whose primary is a privaterelay address that can never match anything a
 * coach types.
 *
 * Contract this file pins:
 *   - any VERIFIED address on the account matches, with provider-aware
 *     normalization;
 *   - an unverified address never matches;
 *   - when nothing matches, redemption returns a structured
 *     `confirmationRequired` (never only a string error) and succeeds on
 *     explicit confirmation, recording the confirmed-from address in
 *     coachNotes and structurally on the ClientInvite row;
 *   - every success produces exactly one CoachClient and marks the invite
 *     ACCEPTED.
 *
 * T-987 moved this rule into the shared service, `acceptClientInviteForUser`
 * (lib/activation.ts), so every acceptance surface inherits it — this file
 * now also exercises `POST /api/client/connect-coach` directly.
 *
 * Negative control: on 87181e5 (pre-T-1012) every case except "exact match"
 * returns `{ error: "This invite was sent to a different email address." }`.
 * On team/sprint-1@1c59ba3 (the commit that would ship the regression this
 * ticket fixes) the identity cases below fail the same way — see
 * board/evidence/T-987.md for that run.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  sendEmail: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mocks.sendEmail }));

import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { redeemInvite } from "@/app/actions/client-invites";
import { POST as connectCoach } from "@/app/api/client/connect-coach/route";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

type ClerkEmail = { id: string; emailAddress: string; verification: { status: string } | null };

function clerkAccount(primary: string, others: Array<{ address: string; verified: boolean }> = []) {
  const addresses: ClerkEmail[] = [
    { id: "primary", emailAddress: primary, verification: { status: "verified" } },
    ...others.map((o, i) => ({
      id: `secondary-${i}`,
      emailAddress: o.address,
      verification: { status: o.verified ? "verified" : "unverified" },
    })),
  ];
  vi.mocked(currentUser).mockResolvedValue({
    id: mocks.authUserId,
    primaryEmailAddressId: "primary",
    emailAddresses: addresses,
    publicMetadata: {},
  } as unknown as Awaited<ReturnType<typeof currentUser>>);
}

suite("T-1012 invite redemption across sign-in identities", () => {
  const created: string[] = [];

  async function fixture(clientDbEmail: string, invitedEmail: string) {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({
      data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" },
    });
    const clientClerkId = randomUUID();
    const client = await db.user.create({
      data: { clerkId: clientClerkId, email: clientDbEmail, isClient: true },
    });
    created.push(coach.id, client.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const invite = await db.clientInvite.create({
      data: { coachId: coach.id, email: invitedEmail.toLowerCase(), name: "Test Client", expiresAt },
    });
    mocks.authUserId = client.clerkId;
    return { coach, client, invite };
  }

  async function assertJoined(coachId: string, clientId: string, inviteId: string) {
    const rows = await db.coachClient.findMany({ where: { coachId, clientId } });
    expect(rows).toHaveLength(1);
    const invite = await db.clientInvite.findUnique({ where: { id: inviteId } });
    expect(invite?.status).toBe("ACCEPTED");
    return rows[0];
  }

  beforeEach(() => {
    vi.mocked(currentUser).mockReset();
  });

  afterAll(async () => {
    if (!created.length) return;
    // T-987: acceptClientInviteForUser (the shared service every acceptance
    // surface now calls) reconciles a ClientCoachingContext row on every
    // successful acceptance — a row the pre-T-987 deployed action never
    // created, so this cleanup needs a line the original test didn't.
    await db.clientCoachingContext.deleteMany({ where: { clientId: { in: created } } });
    await db.clientInvite.deleteMany({ where: { coachId: { in: created } } });
    await db.coachClient.deleteMany({ where: { OR: [{ coachId: { in: created } }, { clientId: { in: created } }] } });
    await db.user.deleteMany({ where: { id: { in: created } } });
  });

  it("exact match still works (baseline, passes on the deployed commit too)", async () => {
    const u = randomUUID();
    const { coach, client, invite } = await fixture(`${u}@example.test`, `${u}@example.test`);
    clerkAccount(`${u}@example.test`);
    const result = await redeemInvite(invite.inviteToken);
    expect(result).toMatchObject({ success: true });
    await assertJoined(coach.id, client.id, invite.id);
  });

  it("matches a VERIFIED non-primary address — the core regression", async () => {
    const u = randomUUID();
    const { coach, client, invite } = await fixture(`${u}-primary@example.test`, `${u}-second@example.test`);
    clerkAccount(`${u}-primary@example.test`, [{ address: `${u}-second@example.test`, verified: true }]);
    const result = await redeemInvite(invite.inviteToken);
    expect(result).toMatchObject({ success: true });
    const row = await assertJoined(coach.id, client.id, invite.id);
    // sprint's shared service writes its own note (lib/activation.ts); the
    // deployed action's "Joined via direct invite." is a different lineage.
    expect(row.coachNotes).toBe("Joined via invite.");
  });

  it("matches an Apple alias: invited at @me.com, signed in as @icloud.com", async () => {
    const u = randomUUID().slice(0, 8);
    const { coach, client, invite } = await fixture(`${u}@icloud.com`, `${u}@me.com`);
    clerkAccount(`${u}@icloud.com`);
    expect(await redeemInvite(invite.inviteToken)).toMatchObject({ success: true });
    await assertJoined(coach.id, client.id, invite.id);
  });

  it("matches Gmail when the coach typed the dots differently", async () => {
    const u = randomUUID().slice(0, 8);
    const { coach, client, invite } = await fixture(`${u}client@gmail.com`, `${u}.client@gmail.com`);
    clerkAccount(`${u}client@gmail.com`);
    expect(await redeemInvite(invite.inviteToken)).toMatchObject({ success: true });
    await assertJoined(coach.id, client.id, invite.id);
  });

  it("Apple Hide My Email: returns a structured confirmationRequired, then succeeds on confirmation", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { coach, client, invite } = await fixture(relay, `${u}@icloud.com`);
    clerkAccount(relay);

    const first = await redeemInvite(invite.inviteToken);
    expect(first).toMatchObject({ confirmationRequired: true, signedInAs: relay });
    expect((first as { invitedEmailHint?: string }).invitedEmailHint).toBe(`${u.slice(0, 1)}***@icloud.com`);
    // T-987: the confirmation arm carries a sentence even though the page
    // never reads it — an unaware caller degrades instead of disappearing.
    expect((first as { error?: string }).error).toContain("different email");
    // Nothing happened yet.
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(0);

    const confirmed = await redeemInvite(invite.inviteToken, { confirmDifferentEmail: true });
    expect(confirmed).toMatchObject({ success: true });
    const row = await assertJoined(coach.id, client.id, invite.id);
    expect(row.coachNotes).toContain(`confirmed from ${relay}`);
    expect(row.coachNotes).toContain(`${u}@icloud.com`);
  });

  it("an UNVERIFIED secondary address never auto-matches", async () => {
    const u = randomUUID();
    const { coach, client, invite } = await fixture(`${u}-primary@example.test`, `${u}-unverified@example.test`);
    clerkAccount(`${u}-primary@example.test`, [{ address: `${u}-unverified@example.test`, verified: false }]);
    const result = await redeemInvite(invite.inviteToken);
    expect(result).toMatchObject({ confirmationRequired: true });
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(0);
  });

  it("confirmation cannot revive a used invite (same user replay is idempotent)", async () => {
    const u = randomUUID();
    const { client, invite } = await fixture(`${u}@example.test`, `${u}@example.test`);
    clerkAccount(`${u}@example.test`);
    expect(await redeemInvite(invite.inviteToken)).toMatchObject({ success: true });
    // redeemInvite's frozen action contract only carries { success, coachName }
    // on the success arm; alreadyConnected is a service-level field, asserted
    // directly against acceptClientInviteForUser here, same pattern as
    // coach-client-consent.test.ts's replay case.
    const { acceptClientInviteForUser } = await import("@/lib/activation");
    const acceptedInvite = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    const second = await acceptClientInviteForUser(acceptedInvite, client);
    expect(second).toMatchObject({ success: true, alreadyConnected: true });
  });

  it("confirmation cannot revive a used invite (a different signed-in user replaying the token is refused, no row for them)", async () => {
    const u = randomUUID();
    const { coach, invite } = await fixture(`${u}@example.test`, `${u}@example.test`);
    clerkAccount(`${u}@example.test`);
    expect(await redeemInvite(invite.inviteToken)).toMatchObject({ success: true });

    // A different account, holding the same (now-accepted) token.
    const intruderClerkId = randomUUID();
    const intruder = await db.user.create({
      data: { clerkId: intruderClerkId, email: `intruder-${u}@example.test`, isClient: true },
    });
    created.push(intruder.id);
    mocks.authUserId = intruder.clerkId;
    clerkAccount(`intruder-${u}@example.test`);

    const replay = await redeemInvite(invite.inviteToken);
    expect(replay).toMatchObject({ error: "This invite has already been used." });
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: intruder.id } })).toBe(0);
  });
});

/**
 * T-987 — the three structural columns this ticket adds to ClientInvite,
 * and the REST confirm path. Kept in its own describe (separate from the
 * identity cases above) because the baseline worktree used for the negative
 * control below has no migration for these columns.
 */
suite("T-987 — structural mismatch recording and the REST confirm path", () => {
  const created: string[] = [];

  async function fixture(clientDbEmail: string, invitedEmail: string, expiresAt?: Date) {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({
      data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" },
    });
    const clientClerkId = randomUUID();
    const client = await db.user.create({
      data: { clerkId: clientClerkId, email: clientDbEmail, isClient: true },
    });
    created.push(coach.id, client.id);
    const invite = await db.clientInvite.create({
      data: {
        coachId: coach.id,
        email: invitedEmail.toLowerCase(),
        name: "Test Client",
        expiresAt: expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    mocks.authUserId = client.clerkId;
    return { coach, client, invite };
  }

  async function callConnectCoach(body: Record<string, unknown>) {
    const req = new NextRequest("https://example.test/api/client/connect-coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await connectCoach(req);
    const json = await res.json();
    return { status: res.status, json };
  }

  beforeEach(() => {
    vi.mocked(currentUser).mockReset();
  });

  afterAll(async () => {
    if (!created.length) return;
    // Case 3 (MAJOR 2 regression test) creates a CoachProfile/CoachingRequest/
    // IntakePacket chain; IntakePacket->CoachingRequest is ON DELETE RESTRICT,
    // so it must go before the cascade from deleting the coach's User row.
    await db.intakePacket.deleteMany({ where: { coachingRequest: { coachProfile: { userId: { in: created } } } } });
    await db.clientCoachingContext.deleteMany({ where: { clientId: { in: created } } });
    await db.clientInvite.deleteMany({ where: { coachId: { in: created } } });
    await db.coachClient.deleteMany({ where: { OR: [{ coachId: { in: created } }, { clientId: { in: created } }] } });
    await db.user.deleteMany({ where: { id: { in: created } } });
  });

  it("1. mismatch attempt then abandon: recorded once, invite stays PENDING, no roster row", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { coach, client, invite } = await fixture(relay, `${u}@icloud.com`);
    clerkAccount(relay);

    const result = await redeemInvite(invite.inviteToken);
    expect(result).toMatchObject({ confirmationRequired: true });

    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.mismatchSeenAt).not.toBeNull();
    expect(row.mismatchEmail).toBe(relay.toLowerCase());
    expect(row.acceptedWithMismatch).toBe(false);
    expect(row.status).toBe("PENDING");
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(0);
  });

  it("2. two mismatch attempts: mismatchSeenAt is set once, unchanged by the second", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { invite } = await fixture(relay, `${u}@icloud.com`);
    clerkAccount(relay);

    await redeemInvite(invite.inviteToken);
    const afterFirst = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(afterFirst.mismatchSeenAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await redeemInvite(invite.inviteToken);
    const afterSecond = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(afterSecond.mismatchSeenAt?.getTime()).toBe(afterFirst.mismatchSeenAt?.getTime());
  });

  it("3. confirmed acceptance: acceptedWithMismatch true, one CoachClient, mode HUMAN, and the originating lead (and its intake) is NOT reassigned to the confirming user", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const invitedEmail = `${u}@icloud.com`;
    const coachClerkId = randomUUID();
    const coach = await db.user.create({
      data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" },
    });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: relay, isClient: true } });
    created.push(coach.id, client.id);
    const request = await db.coachingRequest.create({
      data: {
        coachProfile: { create: { userId: coach.id, slug: `coach-${coachClerkId}` } },
        prospectName: "Test Client",
        prospectEmail: invitedEmail,
        prospectEmailAddr: invitedEmail,
        intakeAnswers: {},
        status: "PENDING",
      },
    });
    // The invited person's own submitted intake — clinical data (bodyweight,
    // health answers) that must never render under the confirming user's
    // name (T-987 review round 1, MAJOR 2).
    await db.intakePacket.create({
      data: {
        coachingRequestId: request.id,
        token: randomUUID(),
        tokenExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        submittedAt: new Date(),
        formAnswers: { bodyweight: 190, goal: "STRENGTH" },
      },
    });
    const invite = await db.clientInvite.create({
      data: {
        coachId: coach.id,
        email: invitedEmail,
        name: "Test Client",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        requestId: request.id,
      },
    });
    mocks.authUserId = client.clerkId;
    clerkAccount(relay);

    const result = await redeemInvite(invite.inviteToken, { confirmDifferentEmail: true });
    expect(result).toMatchObject({ success: true });

    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.acceptedWithMismatch).toBe(true);
    expect(row.mismatchEmail).toBe(relay.toLowerCase());
    expect(row.status).toBe("ACCEPTED");

    const rows = await db.coachClient.findMany({ where: { coachId: coach.id, clientId: client.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].coachNotes).toContain("confirmed from");
    expect(rows[0].coachNotes).toContain(relay);
    expect(rows[0].coachNotes).toContain(invitedEmail);

    // The roster row (just asserted above) IS the relationship. The
    // originating lead stays the invited person's record: neither its
    // prospectId nor its status may move to the confirming user.
    const requestAfter = await db.coachingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.prospectId).toBeNull();
    expect(requestAfter.status).toBe("PENDING");

    // What the coach's client page actually shows: no intake for this
    // client, because they never submitted one. Before the fix this
    // returned person A's submitted answers under person B's clientId.
    const { getIntakePacketForClient } = await import("@/lib/queries/intake");
    expect(await getIntakePacketForClient(coach.id, client.id)).toBeNull();

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.mode).toBe("HUMAN");
  });

  it("4. matched acceptance leaves all three columns at their defaults", async () => {
    const u = randomUUID();
    const { invite } = await fixture(`${u}@example.test`, `${u}@example.test`);
    clerkAccount(`${u}@example.test`);
    expect(await redeemInvite(invite.inviteToken)).toMatchObject({ success: true });
    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.mismatchSeenAt).toBeNull();
    expect(row.mismatchEmail).toBeNull();
    expect(row.acceptedWithMismatch).toBe(false);
  });

  it("5. POST connect-coach with a mismatched account: 409 confirmation_required, masked hint, zero rows", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { coach, client, invite } = await fixture(relay, `${u}@icloud.com`);
    clerkAccount(relay);

    const { status, json } = await callConnectCoach({ coachCode: invite.inviteToken });
    expect(status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toBe("confirmation_required");
    expect(json.invitedEmailHint).not.toBe(`${u}@icloud.com`);
    expect(json.invitedEmailHint).toBe(`${u.slice(0, 1)}***@icloud.com`);
    expect(json.signedInAs).toBe(relay);
    const { inviteConfirmationMessage } = await import("@/lib/activation");
    expect(json.message).toBe(
      inviteConfirmationMessage({
        invitedEmailHint: json.invitedEmailHint,
        signedInAs: json.signedInAs,
        coachName: json.coachName,
      })
    );
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(0);
  });

  it("6. the same POST with confirmDifferentEmail true: 200, one CoachClient, acceptedWithMismatch true; a third identical POST: 409 already_connected, still one row", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { coach, client, invite } = await fixture(relay, `${u}@icloud.com`);
    clerkAccount(relay);

    const first = await callConnectCoach({ coachCode: invite.inviteToken });
    expect(first.status).toBe(409);

    const confirmed = await callConnectCoach({ coachCode: invite.inviteToken, confirmDifferentEmail: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json).toMatchObject({ success: true });
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(1);
    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.acceptedWithMismatch).toBe(true);

    const third = await callConnectCoach({ coachCode: invite.inviteToken, confirmDifferentEmail: true });
    expect(third.status).toBe(409);
    expect(third.json).toMatchObject({ success: false, error: "already_connected" });
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(1);
  });

  it("7. the route with a mismatched account and an EXPIRED invite: 410 expired, not confirmation_required, mismatchSeenAt still NULL", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { invite } = await fixture(relay, `${u}@icloud.com`, new Date(Date.now() - 1000));
    clerkAccount(relay);

    const { status, json } = await callConnectCoach({ coachCode: invite.inviteToken });
    expect(status).toBe(410);
    expect(json).toMatchObject({ success: false, error: "expired" });
    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.mismatchSeenAt).toBeNull();
  });

  it("8. the route with a mismatched account and an invite for a client already enrolled in AI: 403 invalid_code, mismatchSeenAt still NULL", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { client, invite } = await fixture(relay, `${u}@icloud.com`);
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    clerkAccount(relay);

    const { status, json } = await callConnectCoach({ coachCode: invite.inviteToken });
    expect(status).toBe(403);
    expect(json).toMatchObject({ success: false, error: "invalid_code" });
    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.mismatchSeenAt).toBeNull();
  });

  it("9. self-addressed invite (coachId === user.id): refused at the coach-unavailable step, no confirmation offered, mismatchSeenAt NULL", async () => {
    const selfClerkId = randomUUID();
    const self = await db.user.create({
      data: {
        clerkId: selfClerkId,
        email: `self-${selfClerkId}@example.test`,
        isCoach: true,
        isClient: true,
        activeRole: "COACH",
      },
    });
    created.push(self.id);
    const invite = await db.clientInvite.create({
      data: {
        coachId: self.id,
        email: `not-me-${selfClerkId}@example.test`,
        name: "Self",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    mocks.authUserId = self.clerkId;
    clerkAccount(`not-me-${selfClerkId}@example.test`);

    const result = await redeemInvite(invite.inviteToken);
    expect(result).toMatchObject({ error: "This coach is unavailable." });
    const row = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.mismatchSeenAt).toBeNull();
  });
});
