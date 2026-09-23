import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * T-978 — the funnel matrix. This is the deliverable: every lead-creation
 * path crossed with every activation path, asserting invariant I1 against
 * the database after each call. This is the regression net that would have
 * caught both incidents in docs/onboarding-funnel.md, because each incident
 * left every individual route test green — the leak was between routes,
 * and a route test structurally cannot see that.
 *
 * The assertion function below (`assertInvariant`) re-derives I1 from the
 * database. It imports NOTHING from lib/leads/activate-lead.ts or
 * lib/activation.ts, so a bug in the service cannot make this checker agree
 * with itself.
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
import {
  activateClient,
  bypassPipelineAndActivate,
  updateConsultationStage,
  addLeadManually,
  submitCoachingRequest,
} from "@/app/actions/coaching-requests";
import { redeemInvite } from "@/app/actions/client-invites";
import { POST as activateRoute } from "@/app/api/coach/leads/[leadId]/activate/route";
import { POST as bypassActivateRoute } from "@/app/api/coach/leads/[leadId]/bypass-activate/route";
import { PATCH as patchLeadRoute } from "@/app/api/coach/leads/[leadId]/route";
import { PUT as stageRoute } from "@/app/api/coach/leads/[leadId]/stage/route";
import { POST as createLeadRoute } from "@/app/api/coach/leads/route";
import { POST as publicCoachingRequestRoute } from "@/app/api/public/coaching-request/route";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

// ── I1, asserted against the database. Never against a return value. ───────
// Verbatim from the frozen spec (T-978) — deliberately does not import
// activateLead, establishRelationshipOrInvite or any production resolver.
async function assertInvariant(
  requestId: string
): Promise<{ active: boolean; onRoster: boolean; liveInvite: boolean }> {
  const lead = await db.coachingRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: {
      consultationStage: true,
      prospectId: true,
      prospectEmailAddr: true,
      coachProfile: { select: { userId: true } },
    },
  });
  if (lead.consultationStage !== "ACTIVE") return { active: false, onRoster: false, liveInvite: false };

  const coachUserId = lead.coachProfile.userId;
  const coach = await db.user.findUniqueOrThrow({ where: { id: coachUserId }, select: { email: true } });
  const invite = await db.clientInvite.findUnique({ where: { requestId } });

  const ids = new Set<string>();
  if (lead.prospectId) ids.add(lead.prospectId);
  for (const addr of [lead.prospectEmailAddr, invite?.email]) {
    if (!addr) continue;
    const u = await db.user.findUnique({ where: { email: addr.toLowerCase() }, select: { id: true } });
    if (u) ids.add(u.id);
  }
  const roster = ids.size
    ? await db.coachClient.findFirst({ where: { coachId: coachUserId, clientId: { in: [...ids] } }, select: { clientId: true } })
    : null;

  const liveInvite =
    !!invite && invite.status === "PENDING" && invite.expiresAt > new Date() &&
    invite.email.toLowerCase() !== coach.email.toLowerCase();

  expect(
    roster !== null || liveInvite,
    `I1 VIOLATED: ${requestId} is ACTIVE with no CoachClient and no live invite. invite=${JSON.stringify(invite)} candidates=${[...ids]}`
  ).toBe(true);
  return { active: true, onRoster: roster !== null, liveInvite };
}

// ── Fixtures ─────────────────────────────────────────────────────────────

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
    data: {
      userId: coach.id,
      slug: `coach-${id}`,
      isPublished: true,
      acceptingClients: true,
    },
  });
  return { coach, profile };
}

async function makeClientAccount(email: string) {
  const id = randomUUID();
  return db.user.create({ data: { clerkId: id, email, isClient: true, firstName: "Prospect" } });
}

// ── Creation paths (each uses the real product code, not a raw insert) ─────

async function createC1(profileId: string, name: string, emailAddr?: string): Promise<string> {
  const req = await submitCoachingRequest({
    coachProfileId: profileId,
    prospectName: name,
    prospectEmail: "555" + Math.floor(1_000_000 + Math.random() * 8_000_000).toString(),
    prospectEmailAddr: emailAddr,
    intakeAnswers: { goals: "Get fit and build habits" },
  });
  return req.id;
}

async function createC2(profileId: string, slug: string, name: string): Promise<string> {
  const res = await publicCoachingRequestRoute(
    new NextRequest("https://example.test/api/public/coaching-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coachSlug: slug, firstName: name, phoneNumber: "5555550100" }),
    })
  );
  const body = await res.json();
  if (res.status !== 200 || !body.success) {
    throw new Error(`C2 create failed: ${res.status} ${JSON.stringify(body)}`);
  }
  const row = await db.coachingRequest.findFirstOrThrow({
    where: { coachProfileId: profileId, prospectName: name },
    orderBy: { createdAt: "desc" },
  });
  return row.id;
}

async function createC3(coachUser: unknown, name: string, emailAddr: string): Promise<string> {
  auth.user = coachUser;
  const res = await addLeadManually({
    prospectName: name,
    prospectEmailAddr: emailAddr,
    prospectPhone: "5555550100",
    source: "OTHER",
  });
  if (!res.success) throw new Error(`C3 create failed: ${JSON.stringify(res)}`);
  const row = await db.coachingRequest.findFirstOrThrow({
    where: { prospectEmailAddr: emailAddr },
    orderBy: { createdAt: "desc" },
  });
  return row.id;
}

async function createC4(coachUser: unknown, name: string, emailAddr?: string): Promise<string> {
  auth.user = coachUser;
  const res = await createLeadRoute(
    new NextRequest("https://example.test/api/coach/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prospectName: name, prospectEmail: "5555550100", prospectEmailAddr: emailAddr }),
    })
  );
  const body = await res.json();
  if (res.status !== 201) throw new Error(`C4 create failed: ${res.status} ${JSON.stringify(body)}`);
  return body.lead.id as string;
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

// ── Activation paths ─────────────────────────────────────────────────────

type ActivationPath = "A1" | "A2" | "A3" | "A4" | "A5" | "A6";

async function attemptActivation(
  path: ActivationPath,
  coachUser: unknown,
  leadId: string
): Promise<{ threw: boolean; status?: number; body: unknown }> {
  auth.user = coachUser;
  switch (path) {
    case "A1": {
      try {
        return { threw: false, body: await activateClient({ requestId: leadId }) };
      } catch (e) {
        return { threw: true, body: { message: e instanceof Error ? e.message : String(e) } };
      }
    }
    case "A2": {
      const res = await activateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId }),
      });
      return { threw: false, status: res.status, body: await res.json() };
    }
    case "A3": {
      try {
        return { threw: false, body: await bypassPipelineAndActivate({ requestId: leadId }) };
      } catch (e) {
        return { threw: true, body: { message: e instanceof Error ? e.message : String(e) } };
      }
    }
    case "A4": {
      const res = await bypassActivateRoute(new NextRequest("https://example.test/x", { method: "POST" }), {
        params: Promise.resolve({ leadId }),
      });
      return { threw: false, status: res.status, body: await res.json() };
    }
    case "A5": {
      try {
        return { threw: false, body: await updateConsultationStage({ requestId: leadId, stage: "ACTIVE" }) };
      } catch (e) {
        return { threw: true, body: { message: e instanceof Error ? e.message : String(e) } };
      }
    }
    case "A6": {
      const res = await patchLeadRoute(
        new NextRequest(`https://example.test/api/coach/leads/${leadId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consultationStage: "ACTIVE" }),
        }),
        { params: Promise.resolve({ leadId }) }
      );
      return { threw: false, status: res.status, body: await res.json() };
    }
  }
}

// ── Prospect states ───────────────────────────────────────────────────────

type ProspectState = "P1" | "P2" | "P3" | "P4";
const EXPECTED: Record<ProspectState, "roster" | "invite" | "refuse"> = {
  P1: "roster",
  P2: "invite",
  P3: "invite",
  P4: "refuse",
};

/** Returns the emailAddr to give the creation path (undefined for P4) and,
 *  for P1/P2, the pre-created account so a test can pin the CB01 count. */
async function setupProspectState(
  state: ProspectState,
  coachId: string
): Promise<{ emailAddr?: string; account?: { id: string } }> {
  const email = `prospect-${randomUUID()}@example.test`;
  if (state === "P4") return {};
  if (state === "P3") return { emailAddr: email };
  const account = await makeClientAccount(email);
  if (state === "P1") {
    await db.coachClient.create({ data: { coachId, clientId: account.id } });
  }
  return { emailAddr: email, account };
}

async function snapshotBefore(leadId: string) {
  const row = await db.coachingRequest.findUniqueOrThrow({
    where: { id: leadId },
    select: { consultationStage: true, inviteSendCount: true },
  });
  return { stage: row.consultationStage, inviteSendCount: row.inviteSendCount };
}

/** Runs the shared assertions for one matrix cell. */
async function assertCell(
  leadId: string,
  coachId: string,
  expected: "roster" | "invite" | "refuse",
  before: { stage: string; inviteSendCount: number }
) {
  const inviteCount = await db.clientInvite.count({ where: { requestId: leadId } });
  expect(inviteCount, "at most one ClientInvite row per requestId, never two").toBeLessThanOrEqual(1);

  const result = await assertInvariant(leadId);

  if (expected === "refuse") {
    expect(result.active, "expected a refusal but the lead is ACTIVE").toBe(false);
    const after = await snapshotBefore(leadId);
    expect(after.stage, "a refusal must leave the stage byte-identical").toBe(before.stage);
    expect(after.inviteSendCount, "a refusal must leave inviteSendCount byte-identical").toBe(
      before.inviteSendCount
    );
    return;
  }

  expect(result.active, `expected ${expected} but the lead is not ACTIVE`).toBe(true);
  if (expected === "roster") {
    expect(result.onRoster).toBe(true);
  } else {
    expect(result.liveInvite).toBe(true);
    expect(result.onRoster).toBe(false);
  }
}

suite("T-978 — the funnel matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendEmail.mockResolvedValue({ success: true });
    auth.user = null;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  // ── The 32-cell core grid ────────────────────────────────────────────
  // Both manual-add creation paths carry an optional dedicated address
  // (marketplace C1, iOS Add Lead C4), so both can express all four
  // prospect states. C2 (iOS enquiry) structurally cannot — it has no
  // email key at all — and C3 (web Add Lead) structurally cannot either —
  // its form requires a valid address. Both get dedicated, smaller
  // coverage below instead of forcing them into cells they cannot express.
  const creationPaths: Array<{ id: "C1" | "C4"; label: string }> = [
    { id: "C1", label: "marketplace web form" },
    { id: "C4", label: "manual iOS Add Lead" },
  ];
  const activationPaths: Array<{ id: "A1" | "A2" | "A3" | "A4"; label: string; mode: "PIPELINE" | "BYPASS" }> = [
    { id: "A1", label: "activateClient (web)", mode: "PIPELINE" },
    { id: "A2", label: "POST .../activate (iOS)", mode: "PIPELINE" },
    { id: "A3", label: "bypassPipelineAndActivate (web)", mode: "BYPASS" },
    { id: "A4", label: "POST .../bypass-activate (iOS)", mode: "BYPASS" },
  ];
  const prospectStates: ProspectState[] = ["P1", "P2", "P3", "P4"];

  for (const creation of creationPaths) {
    for (const activation of activationPaths) {
      for (const state of prospectStates) {
        it(`${creation.id} (${creation.label}) -> ${activation.id} (${activation.label}) x ${state} ends with I1 holding`, async () => {
          const { coach, profile } = await makeCoach();
          const { emailAddr, account } = await setupProspectState(state, coach.id);

          const leadId =
            creation.id === "C1"
              ? await createC1(profile.id, "Prospect Person", emailAddr)
              : await createC4(coach, "Prospect Person", emailAddr);

          if (activation.mode === "PIPELINE") {
            await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
          }

          const before = await snapshotBefore(leadId);
          const outcome = await attemptActivation(activation.id, coach, leadId);
          expect(outcome.threw, `${activation.id} threw unexpectedly: ${JSON.stringify(outcome.body)}`).toBe(false);

          await assertCell(leadId, coach.id, EXPECTED[state], before);

          if (state === "P2") {
            // CB01 pin: an existing account with no prior relationship must
            // never be linked without acceptance, even after activation.
            expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: account!.id } })).toBe(0);
          }
        });
      }
    }
  }

  // ── A5 / A6 refuse in every cell — the acceptance criterion "one
  //    exported service is the only writer", proven by effect. ──────────
  for (const path of ["A5", "A6"] as const) {
    for (const state of prospectStates) {
      it(`${path} (stage-edit path) x ${state} always refuses, stage unchanged`, async () => {
        const { coach, profile } = await makeCoach();
        const { emailAddr } = await setupProspectState(state, coach.id);
        const leadId = await createC1(profile.id, "Stage Edit Target", emailAddr);
        // FORMS_SIGNED specifically: on the pre-T-978 code this was the one
        // stage VALID_STAGE_TRANSITIONS let a stage edit reach ACTIVE from
        // (`FORMS_SIGNED: ["ACTIVE"]`), so the negative control is
        // meaningless from any other stage — it would refuse on both
        // commits for an unrelated reason (a transition-map miss).
        await walkToStage(coach, leadId, "FORMS_SIGNED");

        const before = await snapshotBefore(leadId);
        const outcome = await attemptActivation(path, coach, leadId);
        if (path === "A5") {
          expect(outcome.threw, "A5 must refuse (by throwing) rather than activate").toBe(true);
        } else {
          expect(outcome.status, `A6 must not answer 2xx: ${JSON.stringify(outcome.body)}`).not.toBe(200);
        }
        await assertCell(leadId, coach.id, "refuse", before);
      });
    }
  }

  // ── Dedicated coverage for the two creation paths that cannot express
  //    every prospect state (see the core-grid comment above). ──────────
  it("C2 (public REST, iOS enquiry — no email key at all) x A1 refuses no_email_on_file", async () => {
    const { coach, profile } = await makeCoach();
    const leadId = await createC2(profile.id, profile.slug, "No Email Person");
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const before = await snapshotBefore(leadId);
    const outcome = await attemptActivation("A1", coach, leadId);
    expect(outcome.threw).toBe(false);
    const result = outcome.body as { success: boolean; message: string };
    expect(result.success).toBe(false);
    expect(result.message).toContain("email");
    await assertCell(leadId, coach.id, "refuse", before);
  });

  it("C2 (public REST, iOS enquiry) x A2 (REST activate) refuses no_email_on_file", async () => {
    const { coach, profile } = await makeCoach();
    const leadId = await createC2(profile.id, profile.slug, "No Email Person Two");
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const before = await snapshotBefore(leadId);
    const outcome = await attemptActivation("A2", coach, leadId);
    expect(outcome.status).toBe(422);
    await assertCell(leadId, coach.id, "refuse", before);
  });

  it("C3 (web manual Add Lead, address required by its own form) x A1 x P3 issues a live invite", async () => {
    const { coach } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC3(coach, "Web Added Lead", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const before = await snapshotBefore(leadId);
    const outcome = await attemptActivation("A1", coach, leadId);
    expect(outcome.threw).toBe(false);
    await assertCell(leadId, coach.id, "invite", before);
  });

  it("C3 (web manual Add Lead) x A3 (bypass) x P1 reports already_on_roster", async () => {
    const { coach } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const account = await makeClientAccount(email);
    await db.coachClient.create({ data: { coachId: coach.id, clientId: account.id } });
    const leadId = await createC3(coach, "Web Added Roster Lead", email);
    const before = await snapshotBefore(leadId);
    const outcome = await attemptActivation("A3", coach, leadId);
    expect(outcome.threw).toBe(false);
    await assertCell(leadId, coach.id, "roster", before);
  });

  // ── Cross-route cells — the leaks between routes individual route tests
  //    cannot see. ────────────────────────────────────────────────────────

  it("X1 — A1 then A4 on the same lead: the second is a no-op, one invite row, I1 holds", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC1(profile.id, "X1 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");

    const first = await attemptActivation("A1", coach, leadId);
    expect(first.threw).toBe(false);
    await assertInvariant(leadId);

    const second = await attemptActivation("A4", coach, leadId);
    expect(second.status).toBe(409);

    expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(1);
    await assertInvariant(leadId);
  });

  it("X2 — A2 and A4 fired concurrently: exactly one invite, exactly one ACTIVE, no unhandled rejection", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC1(profile.id, "X2 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");

    auth.user = coach;
    // A one-macrotask stagger on the second call only, not a serialisation
    // of the two requests: real concurrent HTTP requests are never
    // sub-millisecond-simultaneous either, and the actual race this test
    // exists to exercise is the Postgres FOR UPDATE lock, which the first
    // call is still awaiting (real DB I/O, several ms) by the time the
    // second one starts. Without this stagger, firing two `await
    // import("@/lib/auth/roles")` calls (both A2 and A4 route deep into a
    // Server Action that dynamically imports it) in the exact same
    // microtask tick hits a genuine Vitest/Vite-node module-loader race
    // that can resolve one of the two dynamic imports to the real,
    // unmocked module instead of the cached mock — verified in isolation
    // with no production code involved at all. Confirmed the stagger does
    // not mask a real deadlock: the status assertions below still fail
    // loudly on a 500 if one occurs.
    const [r1, r2] = await Promise.all([
      attemptActivation("A2", coach, leadId),
      new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => attemptActivation("A4", coach, leadId)),
    ]);
    expect(r1.threw).toBe(false);
    expect(r2.threw).toBe(false);
    // T-978 review round 1, CR-7: threw === false is true for every REST
    // response including a 500 (a Response was still returned, nothing
    // was thrown) — a deadlock surfacing as 500 on one side would pass
    // the assertions above with one invite and one ACTIVE lead. Pin the
    // actual status codes: the winner is 200, the loser (already ACTIVE)
    // is 200 on A2 or 409 on A4 — never 500.
    expect([200, 409]).toContain(r1.status);
    expect([200, 409]).toContain(r2.status);

    expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(1);
    const lead = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true } });
    expect(lead.consultationStage).toBe("ACTIVE");
    await assertInvariant(leadId);
  });

  it("X3 — invite issued, then the client signs in and redeems it: this is the exact path both incidents lived in", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC1(profile.id, "X3 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");

    const activation = await attemptActivation("A1", coach, leadId);
    expect(activation.threw).toBe(false);
    await assertInvariant(leadId);

    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    const client = await makeClientAccount(email);
    auth.user = client;
    const accept = (await redeemInvite(invite.inviteToken)) as { success?: boolean; error?: string };
    expect(accept.success).toBe(true);

    const requestAfter = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId } });
    expect(requestAfter.prospectId).toBe(client.id);
    const result = await assertInvariant(leadId);
    expect(result.onRoster).toBe(true);
  });

  it("X4 — a non-activating invite writer (approveCoachingRequest) then A3 (bypass): one invite row, token preserved", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC1(profile.id, "X4 Person", email);

    const { approveCoachingRequest } = await import("@/app/actions/coaching-requests");
    auth.user = coach;
    await approveCoachingRequest(leadId);
    const firstInvite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });

    const outcome = await attemptActivation("A3", coach, leadId);
    expect(outcome.threw).toBe(false);

    const secondInvite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    expect(secondInvite.inviteToken).toBe(firstInvite.inviteToken);
    expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(1);
    await assertInvariant(leadId);
  });

  it("X5 — self-addressed: every activation path refuses, no ClientInvite created, no self CoachClient", async () => {
    for (const path of ["A1", "A2", "A3", "A4"] as const) {
      const { coach, profile } = await makeCoach();
      const leadId = await createC1(profile.id, "Self Addressed", coach.email);
      if (path === "A1" || path === "A2") {
        await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
      }
      const before = await snapshotBefore(leadId);
      const outcome = await attemptActivation(path, coach, leadId);
      expect(outcome.threw, `${path} threw unexpectedly`).toBe(false);
      await assertCell(leadId, coach.id, "refuse", before);
      expect(await db.clientInvite.count({ where: { requestId: leadId } })).toBe(0);
      expect(
        await db.coachClient.count({ where: { coachId: coach.id, clientId: coach.id } })
      ).toBe(0);
    }
  });

  // ── Decay cells — asserted as violations, deliberately, so nobody later
  //    "fixes" them silently. ───────────────────────────────────────────

  it("D1 — documents the I2 decay boundary — owned by T-977 (an invite expiring is legitimate decay, not an I1 bug)", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC1(profile.id, "D1 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const outcome = await attemptActivation("A1", coach, leadId);
    expect(outcome.threw).toBe(false);
    const before = await assertInvariant(leadId);
    expect(before.liveInvite).toBe(true);

    await db.clientInvite.update({ where: { requestId: leadId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const lead = await db.coachingRequest.findUniqueOrThrow({
      where: { id: leadId },
      select: { consultationStage: true, prospectId: true, prospectEmailAddr: true, coachProfile: { select: { userId: true } } },
    });
    expect(lead.consultationStage).toBe("ACTIVE");
    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    const stillLive = invite.status === "PENDING" && invite.expiresAt > new Date();
    // I1 is an establishment rule, not a permanent guarantee — expiry is
    // legitimate decay (I2), which is why this is asserted as a documented
    // gap rather than "fixed" here.
    expect(stillLive, "documents I2 decay: the invite has legitimately expired").toBe(false);
  });

  it("D2 — owned by T-979 (removeClient's prospectId-only match misses a null prospectId and leaves the lead stranded)", async () => {
    const { coach, profile } = await makeCoach();
    const email = `prospect-${randomUUID()}@example.test`;
    const leadId = await createC1(profile.id, "D2 Person", email);
    await walkToStage(coach, leadId, "INTAKE_SUBMITTED");
    const activation = await attemptActivation("A1", coach, leadId);
    expect(activation.threw).toBe(false);

    const invite = await db.clientInvite.findUniqueOrThrow({ where: { requestId: leadId } });
    const client = await makeClientAccount(email);
    auth.user = client;
    const accept = (await redeemInvite(invite.inviteToken)) as { success?: boolean };
    expect(accept.success).toBe(true);

    // Force the known gap: prospectId null at removal time (removeClient
    // matches only on prospectId, which T-979 owns fixing).
    await db.coachingRequest.update({ where: { id: leadId }, data: { prospectId: null } });

    const { removeClient } = await import("@/app/actions/coach-client");
    auth.user = coach;
    await removeClient({ clientId: client.id });

    const conn = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
    });
    expect(conn, "the relationship really is gone").toBeNull();

    const lead = await db.coachingRequest.findUniqueOrThrow({ where: { id: leadId }, select: { consultationStage: true } });
    // Documents the known I3 gap: the lead is still ACTIVE with the
    // relationship gone, because removeClient's decline only matches
    // prospectId, which this test forced to null.
    expect(lead.consultationStage, "documents the I3 gap: still ACTIVE with the relationship gone").toBe("ACTIVE");
  });
});
