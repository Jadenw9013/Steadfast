import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-1012 — invite redemption must work for every way a client can sign in.
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
 *   - when nothing matches, redemption returns a structured `mismatch` (never a
 *     string error) and succeeds on explicit confirmation, recording the
 *     confirmed-from address in coachNotes;
 *   - every success produces exactly one CoachClient and marks the invite
 *     ACCEPTED.
 *
 * Negative control: on 87181e5 every case except "exact match" returns
 * `{ error: "This invite was sent to a different email address." }`.
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
    expect(row.coachNotes).toBe("Joined via direct invite.");
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

  it("Apple Hide My Email: returns a structured mismatch, then succeeds on confirmation", async () => {
    const u = randomUUID().slice(0, 8);
    const relay = `${u}@privaterelay.appleid.com`;
    const { coach, client, invite } = await fixture(relay, `${u}@icloud.com`);
    clerkAccount(relay);

    const first = await redeemInvite(invite.inviteToken);
    expect(first).toMatchObject({ mismatch: true, signedInAs: relay });
    expect((first as { invitedEmailHint?: string }).invitedEmailHint).toBe(`${u.slice(0, 1)}***@icloud.com`);
    expect(first).not.toHaveProperty("error");
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
    expect(result).toMatchObject({ mismatch: true });
    expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(0);
  });

  it("confirmation cannot revive a used invite", async () => {
    const u = randomUUID();
    const { invite } = await fixture(`${u}@example.test`, `${u}@example.test`);
    clerkAccount(`${u}@example.test`);
    expect(await redeemInvite(invite.inviteToken)).toMatchObject({ success: true });
    expect(await redeemInvite(invite.inviteToken, { confirmDifferentEmail: true })).toMatchObject({
      error: "This invite has already been used.",
    });
  });
});
