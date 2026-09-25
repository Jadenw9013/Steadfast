import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB01 — coach-controlled account linking must require the intended
 * client's own explicit acceptance. A coach entering someone's email or
 * phone number must never, by itself, create a CoachClient relationship.
 *
 * Required regression (docs/ai-coach/03-Codebase-Audit.md CB01,
 * docs/ai-coach/09-Validation-Release-Operations.md V01/V08):
 * coach-entered victim email plus activation grants no access until the
 * intended client accepts; wrong-user, expired, replayed and partial-phone
 * attempts fail; valid acceptance succeeds once.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { linkOrInviteProspect, acceptClientInviteForUser } from "@/lib/activation";
import { redeemInvite } from "@/app/actions/client-invites";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

suite("CB01 — consent-bound coach/client linking with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoach() {
    const id = randomUUID();
    const coach = await db.user.create({ data: { clerkId: id, email: `coach-${id}@example.test`, isCoach: true, isClient: false, firstName: "Coach" } });
    await db.coachProfile.create({ data: { userId: coach.id, slug: `coach-${id}` } });
    return coach;
  }

  // `label` becomes part of the email local-part purely for readability in
  // failure output — uniqueness always comes from the random id, since these
  // tests run against a persistent local database across repeated runs.
  async function makeClient(label = "client", phoneNumber?: string) {
    const id = randomUUID();
    return db.user.create({
      data: {
        clerkId: id,
        email: `${label}-${id}@example.test`,
        isCoach: false,
        isClient: true,
        firstName: "Client",
        phoneNumber: phoneNumber ?? null,
      },
    });
  }

  async function makeRequest(coachProfileUserId: string, prospectName: string, prospectEmailAddr: string | null, prospectPhone: string | null) {
    const profile = await db.coachProfile.findUniqueOrThrow({ where: { userId: coachProfileUserId } });
    return db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName,
        prospectEmail: prospectPhone ?? prospectEmailAddr ?? "unknown",
        prospectPhone,
        prospectEmailAddr,
        intakeAnswers: {},
        status: "PENDING",
      },
    });
  }

  it("coach-entered victim email grants no access until the victim accepts", async () => {
    const coach = await makeCoach();
    const victim = await makeClient("victim");
    const request = await makeRequest(coach.id, "Victim", victim.email, null);

    const result = await linkOrInviteProspect(
      { prospectName: "Victim", prospectEmail: victim.email, prospectPhone: null, prospectEmailAddr: victim.email },
      { coachId: coach.id, coachFirstName: coach.firstName },
      request.id,
    );

    expect(result.linked).toBe(false);
    // The critical assertion: no relationship exists yet.
    const conn = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: victim.id } } });
    expect(conn).toBeNull();

    const invite = await db.clientInvite.findUnique({ where: { requestId: request.id } });
    expect(invite).not.toBeNull();
    expect(invite!.status).toBe("PENDING");
  });

  it("the intended victim's own acceptance creates exactly one CoachClient row", async () => {
    const coach = await makeCoach();
    const victim = await makeClient("victim2");
    const request = await makeRequest(coach.id, "Victim2", victim.email, null);
    await linkOrInviteProspect(
      { prospectName: "Victim2", prospectEmail: victim.email, prospectPhone: null, prospectEmailAddr: victim.email },
      { coachId: coach.id, coachFirstName: coach.firstName },
      request.id,
    );
    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: request.id } });

    mocks.authUserId = victim.clerkId;
    const result = await redeemInvite(invite.inviteToken) as { success?: boolean; error?: string };
    expect(result.success).toBe(true);

    const conn = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: victim.id } } });
    expect(conn).not.toBeNull();

    const requestAfter = await db.coachingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.prospectId).toBe(victim.id);
    expect(requestAfter.status).toBe("ACCEPTED");
  });

  it("T-987 CB01: a wrong signed-in user holding the token gets confirmationRequired and writes nothing; only their own explicit confirmation creates a row, recorded as a mismatch", async () => {
    const coach = await makeCoach();
    const victim = await makeClient("victim3");
    const attacker = await makeClient("attacker");
    const request = await makeRequest(coach.id, "Victim3", victim.email, null);
    await linkOrInviteProspect(
      { prospectName: "Victim3", prospectEmail: victim.email, prospectPhone: null, prospectEmailAddr: victim.email },
      { coachId: coach.id, coachFirstName: coach.firstName },
      request.id,
    );
    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: request.id } });

    mocks.authUserId = attacker.clerkId;
    const result = await redeemInvite(invite.inviteToken) as { success?: boolean; error?: string; confirmationRequired?: boolean };
    // Free regression cover from the pre-T-987 lineage: still no `success`
    // key, and the frozen sentence still contains "different email".
    expect(result.success).toBeUndefined();
    expect(result.error).toContain("different email");
    expect(result.confirmationRequired).toBe(true);

    // CB01, restated for this ticket: the coach-typed address alone never
    // granted access, and neither does an unrelated party merely holding
    // the token. Nothing is written until THIS user explicitly confirms.
    const attackerConnBefore = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: attacker.id } } });
    expect(attackerConnBefore).toBeNull();
    const victimConn = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: victim.id } } });
    expect(victimConn).toBeNull();

    // Only now, with the attacker's own explicit confirmation, does a row
    // appear — and it is recorded as a mismatch, not a clean match.
    const confirmed = await redeemInvite(invite.inviteToken, { confirmDifferentEmail: true }) as { success?: boolean };
    expect(confirmed.success).toBe(true);
    const attackerConnAfter = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: attacker.id } } });
    expect(attackerConnAfter).not.toBeNull();
    expect(attackerConnAfter?.coachNotes).toContain("confirmed from");
    const inviteAfter = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(inviteAfter.acceptedWithMismatch).toBe(true);
    expect(inviteAfter.mismatchEmail).toBe(attacker.email.toLowerCase());
    // The victim's account is still untouched — the attacker joined their
    // OWN account, from the coach's roster point of view, not the victim's.
    const victimConnAfter = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: victim.id } } });
    expect(victimConnAfter).toBeNull();
    // T-987 review round 1, MAJOR 2: the attacker's confirmation must not
    // rebind the victim's own lead to the attacker's account — that would
    // point the coach's client page at the victim's submitted intake under
    // the attacker's clientId. The lead's prospectId is untouched.
    const requestAfter = await db.coachingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.prospectId).toBeNull();
  });

  it("an expired invite cannot be redeemed", async () => {
    const coach = await makeCoach();
    const victim = await makeClient("victim4");
    const invite = await db.clientInvite.create({
      data: { coachId: coach.id, email: victim.email, name: "Victim4", expiresAt: new Date(Date.now() - 1000) },
    });

    mocks.authUserId = victim.clerkId;
    const result = await redeemInvite(invite.inviteToken) as { success?: boolean; error?: string };
    expect(result.success).toBeUndefined();
    expect(result.error).toContain("expired");

    const conn = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: victim.id } } });
    expect(conn).toBeNull();
    const inviteAfter = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(inviteAfter.status).toBe("EXPIRED");
  });

  it("replaying an already-accepted invite is idempotent, not an error, and creates no duplicate", async () => {
    const coach = await makeCoach();
    const victim = await makeClient("victim5");
    const invite = await db.clientInvite.create({
      data: { coachId: coach.id, email: victim.email, name: "Victim5", expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const first = await acceptClientInviteForUser(invite, victim);
    expect(first.success).toBe(true);

    const acceptedInvite = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    const second = await acceptClientInviteForUser(acceptedInvite, victim);
    expect(second.success).toBe(true);
    if (second.success) expect(second.alreadyConnected).toBe(true);

    const count = await db.coachClient.count({ where: { coachId: coach.id, clientId: victim.id } });
    expect(count).toBe(1);
  });

  it("a coach-entered phone number matching a different real account's phone never links that account", async () => {
    const coach = await makeCoach();
    // An unrelated real user who happens to share the last 10 digits of a
    // phone number with what the coach types in — e.g. a formatting
    // collision or a coach fat-fingering someone else's number.
    const bystander = await makeClient("bystander", "+15551234567");
    const request = await makeRequest(coach.id, "Some Lead", "lead@example.test", "5551234567");

    await linkOrInviteProspect(
      { prospectName: "Some Lead", prospectEmail: "5551234567", prospectPhone: "5551234567", prospectEmailAddr: "lead@example.test" },
      { coachId: coach.id, coachFirstName: coach.firstName },
      request.id,
    );

    // The bystander — matched only by phone digits, never by their own
    // email — must never be linked to this coach.
    const bystanderConn = await db.coachClient.findUnique({ where: { coachId_clientId: { coachId: coach.id, clientId: bystander.id } } });
    expect(bystanderConn).toBeNull();

    // The invite that was created must target the lead's stated email, not
    // resolve to the bystander's account at all.
    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(invite.email).toBe("lead@example.test");
  });
});
