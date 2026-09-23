import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * T-978 — properties the funnel matrix cannot express: reissue mechanics,
 * the post-commit email failure, atomicity under a mid-transaction failure,
 * ownership, the lock-order fix, and the REST decode contract. Unlike the
 * matrix file, this one DOES import activateLead directly — it is testing
 * the service's own behaviour, not re-deriving an invariant from the
 * database independently of it.
 *
 * NEGATIVE CONTROL GAP, stated rather than implied (T-978 review round 1):
 * this file imports `@/lib/leads/activate-lead`, which does not exist on
 * this branch's base (`f1a2816`), so it cannot even be loaded there — every
 * case in it, including R5 ("the single most important assertion in the
 * ticket"), has no negative control. That is unavoidable given the file
 * under test is new. The matrix file's negative control (run against the
 * same base, copied verbatim, nothing here imported) is the only evidence
 * that exists for this ticket's regression-catching power; see its own run
 * log for the predicted failing set.
 */

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({
  getCurrentDbUser: async () => {
    if (!auth.user) throw new Error("Unauthorized");
    return auth.user;
  },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
  currentUser: vi.fn(),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mail.sendEmail }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { activateLead } from "@/lib/leads/activate-lead";
import { acceptClientInviteForUser } from "@/lib/activation";
import { approveCoachingRequest, submitCoachingRequest } from "@/app/actions/coaching-requests";
import { redeemInvite } from "@/app/actions/client-invites";
import { POST as activateRoute } from "@/app/api/coach/leads/[leadId]/activate/route";
import { POST as bypassActivateRoute } from "@/app/api/coach/leads/[leadId]/bypass-activate/route";
import { PUT as stageRoute } from "@/app/api/coach/leads/[leadId]/stage/route";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

// ── Fixtures — deliberately not shared with the matrix file; each
//    integration file is self-contained by convention in this repo. ───────

async function makeCoach() {
  const id = randomUUID();
  const coach = await db.user.create({
    data: {
      clerkId: id,
      email: `coach-${id}@example.test`,
      isCoach: true,
      isClient: false,
      firstName: "Coach",
      activeRole: "COACH",
      emailCoachingRequests: false,
      pushCoachingRequests: false,
    },
  });
  const profile = await db.coachProfile.create({
    data: { userId: coach.id, slug: `coach-${id}`, isPublished: true, acceptingClients: true },
  });
  return { coach, profile };
}

async function makeClientAccount(email: string) {
  const id = randomUUID();
  return db.user.create({ data: { clerkId: id, email, isClient: true, firstName: "Prospect" } });
}

async function createLead(profileId: string, name: string, emailAddr?: string): Promise<string> {
  const req = await submitCoachingRequest({
    coachProfileId: profileId,
    prospectName: name,
    prospectEmail: "555" + Math.floor(1_000_000 + Math.random() * 8_000_000).toString(),
    prospectEmailAddr: emailAddr,
    intakeAnswers: { goals: "Get fit and build habits" },
  });
  return req.id;
}

async function walkToStage(coachUser: unknown, leadId: string, stage: string) {
  auth.user = coachUser;
  const res = await stageRoute(
    new NextRequest(`https://example.test/api/coach/leads/${leadId}/stage`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    }),
    { params: Promise.resolve({ leadId }) }
  );
  if (res.status !== 200) {
    throw new Error(`walk to ${stage} failed: ${res.status} ${JSON.stringify(await res.json())}`);
  }
}

/** Forces exactly one call to `tx.<model>.<method>` inside the NEXT
 *  `db.$transaction` to reject, while every other statement in that same
 *  transaction runs for real against Postgres. Because the rejection is
 *  injected before any SQL for that statement executes, the surrounding
 *  transaction is healthy right up to the point of the throw — so when the
 *  code under test lets the error propagate, Prisma's real COMMIT becomes a
 *  real ROLLBACK (Postgres itself converts a COMMIT issued against an
 *  aborted transaction into a rollback). This is what makes the assertion
 *  below real atomicity, not a mocked return value.
 *
 *  `vi.spyOn` cannot target `db.$transaction` directly (`lib/db.ts` wraps
 *  the client in a read-only Proxy with no property descriptor to spy on),
 *  and cannot target the interactive-transaction-scoped `tx` object either
 *  (verified empirically: it is not the same object `db.<model>` returns,
 *  so a spy on the latter is never called from inside a transaction
 *  callback). The singleton PrismaClient instance Prisma stores on
 *  `globalThis.prisma` (see `lib/db.ts`) is a real, spyable object and is
 *  the one `db.$transaction` actually calls through, so spying there does
 *  intercept.
 */
type PrismaLike = Record<string, unknown> & { $transaction: (...args: unknown[]) => unknown };

function forceOneTxCallToReject(modelName: string, methodName: string) {
  const client = (globalThis as unknown as { prisma?: PrismaLike }).prisma;
  if (!client) throw new Error("prisma client not initialized — call a db.* method before this helper");
  const realTransaction = client.$transaction.bind(client);
  return vi.spyOn(client, "$transaction").mockImplementationOnce(((cb: unknown, opts?: unknown) => {
    return realTransaction(async (tx: Record<string, unknown>) => {
      const wrapped = new Proxy(tx, {
        get(target, prop) {
          if (prop === modelName) {
            const real = target[modelName] as object;
            return new Proxy(real, {
              get(t2, p2) {
                if (p2 === methodName) return () => Promise.reject(new Error("boom (forced by test)"));
                return Reflect.get(t2, p2);
              },
            });
          }
          return Reflect.get(target, prop);
        },
      });
      return (cb as (tx: unknown) => unknown)(wrapped);
    }, opts as never);
  }) as never);
}

suite("T-978 — transaction properties the matrix cannot express", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendEmail.mockResolvedValue({ success: true });
    auth.user = null;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("R1 — reissue read path: an EXPIRED invite is updated in place (never duplicated) and the reissued row redeems", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createLead(profile.id, "R1 Person", email);

    auth.user = coach;
    await approveCoachingRequest(leadId);
    const firstInvite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    await db.clientInvite.update({ where: { id: firstInvite.id }, data: { status: "EXPIRED" } });

    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const result = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });
    expect(result.ok).toBe(true);

    expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(1);
    const reissued = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    expect(reissued.status).toBe("PENDING");
    expect(reissued.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const client = await makeClientAccount(email);
    auth.user = client;
    const accept = (await redeemInvite(reissued.inviteToken)) as { success?: boolean };
    expect(accept.success).toBe(true);
    expect(
      await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })
    ).toBe(1);
  });

  it("R2 — same-address reissue keeps inviteToken, createdAt and expiresAt untouched (reusable, no write at all)", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createLead(profile.id, "R2 Person", email);

    auth.user = coach;
    await approveCoachingRequest(leadId);
    const before = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });

    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const result = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });
    expect(result.ok).toBe(true);

    const after = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    expect(after.inviteToken).toBe(before.inviteToken);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
  });

  it("R3 — an address change between issue and activation rotates the token; the old token resolves to nothing", async () => {
    const { coach, profile } = await makeCoach();
    const oldEmail = `prospect-old-${randomUUID()}@example.test`;
    const newEmail = `prospect-new-${randomUUID()}@example.test`;
    const leadId = await createLead(profile.id, "R3 Person", oldEmail);

    auth.user = coach;
    await approveCoachingRequest(leadId);
    const before = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    expect(before.email).toBe(oldEmail);

    // The coach corrected the address on file before activating. No route
    // exposes this write (T-976's territory); a direct DB update sets up
    // the precondition this test is about, exactly as other integration
    // tests in this repo do for preconditions no route can produce.
    await db.coachingRequest.update({ where: { id: leadId }, data: { prospectEmailAddr: newEmail } });

    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const result = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });
    expect(result.ok).toBe(true);

    expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(1);
    const after = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    expect(after.email).toBe(newEmail);
    expect(after.inviteToken).not.toBe(before.inviteToken);

    const oldTokenLookup = await db.clientInvite.findUnique({ where: { inviteToken: before.inviteToken } });
    expect(oldTokenLookup).toBeNull();
  });

  it("R4 — a post-commit email failure never rolls back committed authority and never fakes success", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createLead(profile.id, "R4 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");

    mail.sendEmail.mockRejectedValueOnce(new Error("SMTP down"));
    const result = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("invite_created_email_failed");
      expect(result.emailSent).toBe(false);
    }

    const lead = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.consultationStage).toBe("ACTIVE");
    expect(lead.inviteLastSentAt).not.toBeNull();
    expect(lead.inviteSendCount).toBe(1);
    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    expect(invite.status).toBe("PENDING");
  });

  it("R5 — atomicity: a genuinely-INSERTed invite is rolled back when the later stage write fails (the single most important assertion in this ticket)", async () => {
    // T-978 review round 1, CR-6: the original version of this test forced
    // clientInvite.create — the FIRST write in the invite branch — to
    // reject, so nothing had been written when the transaction aborted.
    // That proves statement ordering, not rollback: there was nothing to
    // roll back. This version lets the create() genuinely INSERT a real
    // row, then forces the *second*, later write (coachingRequest.update)
    // to reject, and asserts the invite row is gone afterwards. That
    // assertion can only pass if Postgres rolled back a write that had
    // already succeeded — which is what "atomicity" actually means.
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`; // P3: no account, valid address -> invite branch
    const leadId = await createLead(profile.id, "R5 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const before = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true } });

    const spy = forceOneTxCallToReject("coachingRequest", "update");
    try {
      const result = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal).toBe("failed");
    } finally {
      spy.mockRestore();
    }

    const after = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true, prospectId: true } });
    expect(after.consultationStage).toBe(before.consultationStage);
    expect(after.consultationStage).not.toBe("ACTIVE");
    // The real proof: ensureInviteForRequest's clientInvite.create() ran
    // for real (it is upstream of the forced rejection, not the target of
    // it) — if this is 0, Postgres genuinely undid that INSERT.
    expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(0);
  });

  it("R6 — the same spy on the roster branch (coachingRequest.update rejects): stage unchanged, no prospectId written. This branch's only write is the one forced to reject, so — unlike R5 — this proves ordering (the write never lands), not a rollback of a prior write; there is no prior write in this branch to roll back.", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const account = await makeClientAccount(email);
    await db.coachClient.create({ data: { coachId: coach.id, clientId: account.id } });
    const leadId = await createLead(profile.id, "R6 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");

    const spy = forceOneTxCallToReject("coachingRequest", "update");
    try {
      const result = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal).toBe("failed");
    } finally {
      spy.mockRestore();
    }

    const after = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId } });
    expect(after.consultationStage).not.toBe("ACTIVE");
    expect(after.prospectId).toBeNull();
  });

  it("R7 — ownership: another coach's lead refuses not_found from every activation path, nothing written", async () => {
    const { coach: owner, profile } = await makeCoach();
    const { coach: intruder } = await makeCoach();

    for (const mode of ["A1", "A2", "A3", "A4"] as const) {
      const email = `prospect-${randomUUID()}@example.test`;
      const leadId = await createLead(profile.id, `R7 Person ${mode}`, email);
      if (mode === "A1" || mode === "A2") {
        await walkToStage(owner, leadId, "INTAKE_SUBMITTED");
      }
      const before = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true } });

      auth.user = intruder;
      if (mode === "A1") {
        await expect(activateLead({ requestId: leadId, coachUserId: intruder.id, mode: "PIPELINE" })).resolves.toMatchObject({
          ok: false,
          refusal: "not_found",
        });
      } else if (mode === "A3") {
        const result = await activateLead({ requestId: leadId, coachUserId: intruder.id, mode: "BYPASS" });
        expect(result).toMatchObject({ ok: false, refusal: "not_found" });
      } else if (mode === "A2") {
        const res = await activateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
          params: Promise.resolve({ leadId }),
        });
        expect(res.status).toBe(404);
      } else {
        const res = await bypassActivateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
          params: Promise.resolve({ leadId }),
        });
        expect(res.status).toBe(404);
      }

      const after = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true } });
      expect(after.consultationStage).toBe(before.consultationStage);
      expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(0);
    }
  });

  it("R8 — lock order: acceptClientInviteForUser and activateLead fired concurrently for the same lead in a loop of 10, no deadlock surfaces, I1 holds", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createLead(profile.id, "R8 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");

    const first = await activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" });
    expect(first.ok).toBe(true);
    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    const client = await makeClientAccount(email);

    for (let i = 0; i < 10; i++) {
      const [a, b] = await Promise.allSettled([
        activateLead({ requestId: leadId, coachUserId: coach.id, mode: "PIPELINE" }),
        acceptClientInviteForUser(invite, client),
      ]);
      expect(a.status, `iteration ${i}: activateLead ${a.status === "rejected" ? a.reason : ""}`).toBe("fulfilled");
      expect(b.status, `iteration ${i}: acceptClientInviteForUser ${b.status === "rejected" ? b.reason : ""}`).toBe(
        "fulfilled"
      );
    }

    const conn = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
    });
    expect(conn).not.toBeNull();
    const lead = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true } });
    expect(lead.consultationStage).toBe("ACTIVE");
  });

  it("R9 — activate and bypass-activate: success in every 2xx body, error+message with the identical sentence in every 4xx body", async () => {
    // 200: valid address, walked to INTAKE_SUBMITTED.
    {
      const { coach, profile } = await makeCoach();
      const email = `prospect-${randomUUID()}@example.test`;
      const leadId = await createLead(profile.id, "R9 Success", email);
      await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
      auth.user = coach;
      const res = await activateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    }

    // 422: no email on file.
    {
      const { coach, profile } = await makeCoach();
      const leadId = await createLead(profile.id, "R9 NoEmail");
      await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
      auth.user = coach;
      const res = await activateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe(body.message);
      expect(body.error.length).toBeGreaterThan(0);
    }

    // 404: not found, on both routes.
    {
      const { coach } = await makeCoach();
      auth.user = coach;
      const res1 = await activateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId: "not-a-real-id" }),
      });
      expect(res1.status).toBe(404);
      const body1 = await res1.json();
      expect(body1.success).toBe(false);
      expect(body1.error).toBe(body1.message);

      const res2 = await bypassActivateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId: "not-a-real-id" }),
      });
      expect(res2.status).toBe(404);
      const body2 = await res2.json();
      expect(body2.success).toBe(false);
      expect(body2.error).toBe(body2.message);
    }

    // 409: already active, bypass only.
    {
      const { coach, profile } = await makeCoach();
      const email = `prospect-${randomUUID()}@example.test`;
      const leadId = await createLead(profile.id, "R9 AlreadyActive", email);
      await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
      auth.user = coach;
      const first = await activateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId }),
      });
      expect(first.status).toBe(200);

      const res = await bypassActivateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe(body.message);
      expect(body.error).toBe("Already active.");
    }
  });
});
