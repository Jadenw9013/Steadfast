import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * T-2058 — relationship rules from RELATIONSHIP-AUDIT-2026-10-15-web.md.
 *
 *  - T-2060 replaced the strict `relationshipStartedAt` bound with the
 *    recorded-facts rule (lib/coach-client/plan-visibility.ts). An
 *    unknown-author (legacy, NULL publishedByCoachId) plan keeps the strict
 *    bound: a same-coach re-add does not see it until the coach republishes.
 *    A plan the current coach published through the service stays visible
 *    across a same-coach re-link (S2 authored). A previous coach's plan never
 *    surfaces (S3, A->B->A, A->AI->A, review probes P1-P8), authored or not.
 *  - D5: every removal path deletes the client's unpublished DRAFT meal
 *    plans and training programs in the removal transaction.
 *  - D7: coach-initiated removal moves an ACTIVE lead to the same stage on
 *    web and iOS; the unread check is scoped to the asking coach.
 *  - D8: the Clerk webhook never claims a deactivated pending_ placeholder.
 */

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({
  getCurrentDbUser: async () => {
    if (!auth.user) throw new Error("Unauthorized");
    return auth.user;
  },
}));
// T-2060 r1: routes that authenticate through Clerk's auth() (import-plan)
// read this clerkId; null everywhere else, as before.
const clerk = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: clerk.userId }),
  currentUser: vi.fn(),
  clerkClient: async () => ({ users: { deleteUser: async () => ({}) } }),
}));
// Account purge (review r1 P1-P3) runs for real; only its network edges are stubbed.
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ storage: { from: () => ({ remove: async () => ({ error: null }) }) } }) }));
vi.mock("@/lib/account-deletion/billing", () => ({ stopAccountBilling: async () => undefined }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
const hook = vi.hoisted(() => ({ evt: null as unknown }));
vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: async () => hook.evt }));
// Lets one test make the removal transaction fail after the drafts were
// deleted, to prove the deletion rolls back with it.
const fail = vi.hoisted(() => ({ reconcile: false }));
vi.mock("@/lib/activation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activation")>();
  return {
    ...actual,
    reconcileCoachingContextForClient: async (...args: Parameters<typeof actual.reconcileCoachingContextForClient>) => {
      if (fail.reconcile) throw new Error("T-2058 injected failure");
      return actual.reconcileCoachingContextForClient(...args);
    },
  };
});

import { db } from "@/lib/db";
import { acceptClientInviteForUser } from "@/lib/activation";
import { removeClient, leaveCoach } from "@/app/actions/coach-client";
import { DELETE as deleteClientRoute } from "@/app/api/coach/clients/[clientId]/route";
import { getClientProvider } from "@/lib/queries/client-provider";
import { getCurrentClientPlan } from "@/lib/queries/current-client-plan";
import { getActiveMealNames } from "@/lib/meal-plans/active-plan";
import { getEffectiveMealPlanForReview } from "@/lib/queries/meal-plans";
import { getTrainingProgramForReview } from "@/lib/queries/training-programs";
import { hasUnreadMessages } from "@/lib/queries/messages";
import { activateLead } from "@/lib/leads/activate-lead";
import { declineRequest, markContacted } from "@/app/actions/coaching-requests";
import { GET as mealRoute } from "@/app/api/client/meal-plan/current/route";
import { GET as trainingRoute } from "@/app/api/client/training/current/route";
import { POST as clerkWebhook } from "@/app/api/webhooks/clerk/route";
import { purgeUserAccount } from "@/lib/account-deletion/purge";
import { POST as importPlanRoute } from "@/app/api/mealplans/import-plan/route";
import { publishMealPlan } from "@/app/actions/meal-plans";
import { endCoachClientRelationship } from "@/lib/coach-client/end-relationship";
import { getMealPlanPublishTarget, publishMealPlanTarget } from "@/lib/meal-plans/publish";
import { publishTrainingProgramTarget } from "@/lib/training-programs/publish";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { visibilityFor } from "../helpers/plan-visibility";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const WEEK = new Date("2026-05-04T00:00:00Z");

type U = { id: string; email: string; clerkId: string };

async function mk(kind: "coach" | "client"): Promise<U> {
  const id = randomUUID();
  return db.user.create({
    data: {
      clerkId: id,
      email: `${kind}-${id}@example.test`,
      isCoach: kind === "coach",
      isClient: kind === "client",
      activeRole: kind === "coach" ? "COACH" : "CLIENT",
      firstName: kind,
    },
  });
}

async function invite(coachId: string, email: string, createdAt?: Date) {
  return db.clientInvite.create({
    data: { coachId, email, name: "c", expiresAt: new Date(Date.now() + 7 * DAY), ...(createdAt ? { createdAt } : {}) },
  });
}

/** Real consent path: the client accepts the coach's invite. */
async function link(coach: U, client: U, inviteCreatedAt?: Date) {
  const inv = await invite(coach.id, client.email, inviteCreatedAt);
  const r = await acceptClientInviteForUser(inv, client);
  expect(r.success).toBe(true);
  return inv;
}

/** Real web Server Action, signed in as the coach. */
async function coachRemoves(coach: U, client: U) {
  auth.user = { ...coach, activeRole: "COACH", isCoach: true };
  await removeClient({ clientId: client.id });
}

async function publish(clientId: string, publishedAt: Date, version = 1) {
  // One PUBLISHED row per client/week (meal) and per client (training): a
  // later publication supersedes, as lib/meal-plans/publish.ts does.
  await db.mealPlan.updateMany({ where: { clientId, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
  await db.trainingProgram.updateMany({ where: { clientId, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
  const meal = await db.mealPlan.create({
    data: {
      clientId, weekOf: WEEK, version, status: "PUBLISHED", publishedAt,
      items: { create: [{ mealName: "Breakfast", foodName: "Oats", quantity: "1", unit: "cup" }] },
    },
  });
  const program = await db.trainingProgram.create({ data: { clientId, weekOf: WEEK, status: "PUBLISHED", publishedAt } });
  return { meal, program };
}

/**
 * T-2060: publishes one meal plan and one training program for `client`
 * through the real services, authored by `coach` (as every web action, iOS
 * route and OCR import now does). Supersedes like the services do.
 */
async function publishAs(coach: U, client: U, at?: Date) {
  const last = await db.mealPlan.findFirst({ where: { clientId: client.id, weekOf: WEEK }, orderBy: { version: "desc" }, select: { version: true } });
  const mealDraft = await db.mealPlan.create({
    data: {
      clientId: client.id, weekOf: WEEK, version: (last?.version ?? 0) + 1, status: "DRAFT",
      items: { create: [{ mealName: "Breakfast", foodName: "Oats", quantity: "1", unit: "cup" }] },
    },
  });
  const mealTarget = await getMealPlanPublishTarget(mealDraft.id);
  const m = await publishMealPlanTarget(mealTarget!, { publishedByCoachId: coach.id, now: at });
  expect(m.ok).toBe(true);
  const programDraft = await db.trainingProgram.create({ data: { clientId: client.id, weekOf: WEEK, status: "DRAFT" } });
  const t = await publishTrainingProgramTarget({ id: programDraft.id, clientId: client.id, status: "DRAFT" }, { publishedByCoachId: coach.id, now: at });
  expect(t.ok).toBe(true);
  return { meal: { id: mealDraft.id }, program: { id: programDraft.id } };
}

async function message(clientId: string, senderId: string, coachId: string | null, createdAt: Date) {
  return db.message.create({ data: { clientId, senderId, coachId, weekOf: WEEK, body: "hi", createdAt } });
}

/** Everything the client can see on web and iOS: none of it may be `exclude`'s. */
async function clientSees(client: U) {
  auth.user = { ...client, isClient: true };
  const provider = await getClientProvider(client.id);
  // HUMAN origin: currentPlan is the { mealPlan, trainingProgram } pair.
  const plan = (await getCurrentClientPlan(client.id)).currentPlan as
    | { mealPlan: { id: string } | null; trainingProgram: { id: string } | null }
    | null;
  const meal = (await (await mealRoute()).json()) as { mealPlan: { id: string } | null };
  const training = (await (await trainingRoute()).json()) as { trainingProgram: { id: string } | null };
  const mealNames = (await getActiveMealNames(client.id, await visibilityFor(client.id))).map((m) => m.mealName);
  return {
    provider,
    webMealId: plan?.mealPlan?.id ?? null,
    webProgramId: plan?.trainingProgram?.id ?? null,
    iosMealId: meal.mealPlan?.id ?? null,
    iosProgramId: training.trainingProgram?.id ?? null,
    mealNames,
  };
}

async function expectSeesNothing(client: U) {
  const seen = await clientSees(client);
  expect(seen.provider.origin).toBe("HUMAN");
  expect({
    webMealId: seen.webMealId, webProgramId: seen.webProgramId,
    iosMealId: seen.iosMealId, iosProgramId: seen.iosProgramId, mealNames: seen.mealNames,
  }).toEqual({ webMealId: null, webProgramId: null, iosMealId: null, iosProgramId: null, mealNames: [] });
  return seen;
}

suite("T-2058 relationship rules", () => {
  beforeEach(() => {
    auth.user = null;
    clerk.userId = null;
    fail.reconcile = false;
  });
  afterAll(() => db.$disconnect());

  // ── relationshipStartedAt: the strict CoachClient.createdAt bound ────────
  // T-2058 withdrew Rule R (evidence-based widening) after review r2: it can be
  // defeated by ordinary coach actions. The exact fix (relationship episode
  // history + plan authorship) is T-2060. Until then the bound is the current
  // CoachClient.createdAt, and these tests pin both sides of that rule.

  describe("unknown-author (legacy) plan stays hidden after re-link", () => {
    it("S2: same coach removes then re-adds the client -> pre-relink unknown-author plans stay hidden; republishing makes the plan visible", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await link(coach, client, ago(3));
      await publish(client.id, ago(2));
      await coachRemoves(coach, client);
      await link(coach, client);

      const seen = await expectSeesNothing(client);
      const row = await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: coach.id, clientId: client.id } } });
      expect(seen.provider).toMatchObject({ coachId: coach.id, resolutionRequired: false });
      expect(seen.provider.relationshipStartedAt?.getTime()).toBe(row.createdAt.getTime());

      const { meal, program } = await publish(client.id, new Date(), 2);
      expect(await clientSees(client)).toMatchObject({
        webMealId: meal.id, webProgramId: program.id, iosMealId: meal.id, iosProgramId: program.id, mealNames: ["Breakfast"],
      });
    });

    it("S10/C4 shape: legacy re-link (no context row) after a main-era coach message -> earlier unknown-author plan hidden; republishing makes it visible", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await message(client.id, coach.id, null, ago(10));
      await publish(client.id, ago(5));
      const row = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });

      const seen = await expectSeesNothing(client);
      expect(seen.provider.relationshipStartedAt?.getTime()).toBe(row.createdAt.getTime());
      const { meal, program } = await publish(client.id, new Date(), 2);
      expect(await clientSees(client)).toMatchObject({ webMealId: meal.id, webProgramId: program.id, iosMealId: meal.id, iosProgramId: program.id });
    });

    it("single coach, never re-linked: an unknown-author publication from before the relationship stays hidden", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await publish(client.id, ago(5));
      await link(coach, client);
      await expectSeesNothing(client);
    });
  });

  // ── T-2060: recorded episodes + authorship ───────────────────────────────

  describe("T-2060: a plan authored by the current coach survives a same-coach re-link", () => {
    async function expectSees(client: U, plan: { meal: { id: string }; program: { id: string } }) {
      expect(await clientSees(client)).toMatchObject({
        webMealId: plan.meal.id, webProgramId: plan.program.id,
        iosMealId: plan.meal.id, iosProgramId: plan.program.id, mealNames: ["Breakfast"],
      });
    }

    it("S2 authored (regression): A publishes via the service, removeClient, re-link -> web, iOS and the checklist all return A's plan", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      const plan = await publishAs(a, client);
      await coachRemoves(a, client);
      await link(a, client);
      await expectSees(client, plan);
    });

    it("S2 authored via iOS DELETE /api/coach/clients/[clientId]", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      const plan = await publishAs(a, client);
      auth.user = { ...a, activeRole: "COACH", isCoach: true };
      const res = await deleteClientRoute(new NextRequest("http://localhost/api/coach/clients/x", { method: "DELETE" }), { params: Promise.resolve({ clientId: client.id }) });
      expect(res.status).toBe(200);
      await link(a, client);
      await expectSees(client, plan);
    });

    it("S2 authored via leaveCoach + re-accept", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      const row = await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: a.id, clientId: client.id } } });
      const plan = await publishAs(a, client);
      auth.user = { ...client, activeRole: "CLIENT", isClient: true };
      await leaveCoach({ coachClientId: row.id });
      await link(a, client);
      await expectSees(client, plan);
    });

    it("the coach review workspace still shows the published plan after the re-link", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      const plan = await publishAs(a, client);
      await coachRemoves(a, client);
      await link(a, client);
      const review = await getEffectiveMealPlanForReview({ coachId: a.id, clientId: client.id, weekOf: WEEK });
      expect(review).toMatchObject({ source: "published", publishedId: plan.meal.id });
      expect((await getTrainingProgramForReview(client.id, WEEK))?.program?.id).toBe(plan.program.id);
    });

    it("single coach, never re-linked, authored -> visible", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      await expectSees(client, await publishAs(a, client));
    });
  });

  describe("T-2060: authored plans stay strict across another provider", () => {
    async function purgeUser(u: U) {
      await db.user.update({ where: { id: u.id }, data: { isDeactivated: true } });
      await db.accountDeletionRequest.create({ data: { userId: u.id, roleAtRequest: "COACH", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) } });
      await purgeUserAccount(u.id);
    }

    it("A -> B -> A authored (B publishes too): neither A1's nor B's plan is visible; A republishes -> visible", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client);
      await publishAs(a, client);
      await coachRemoves(a, client);
      await link(b, client);
      await publishAs(b, client);
      await coachRemoves(b, client);
      await link(a, client);
      expect((await expectSeesNothing(client)).provider.coachId).toBe(a.id);
      const fresh = await publishAs(a, client);
      expect(await clientSees(client)).toMatchObject({ webMealId: fresh.meal.id, iosMealId: fresh.meal.id, webProgramId: fresh.program.id, iosProgramId: fresh.program.id });
    });

    it("A -> B (purged) -> A authored: nothing visible", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client);
      await publishAs(a, client);
      await coachRemoves(a, client);
      await link(b, client);
      await publishAs(b, client);
      await coachRemoves(b, client);
      await purgeUser(b);
      await link(a, client);
      await expectSeesNothing(client);
    });

    it("A -> AI -> A authored: nothing visible", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      await publishAs(a, client);
      await coachRemoves(a, client);
      await db.aiCoachProviderTransitionReceipt.create({
        data: {
          clientId: client.id, fromMode: "NONE", fromContextRevision: 1, toMode: "AI", toContextRevision: 2,
          releaseId: "t2060", runtimeConfigurationDigest: "a".repeat(64), discoveryConfigurationId: "c",
          discoveryConfigurationVersion: 1, privacyNoticeVersion: "v", consentTextDigest: "b".repeat(64),
        },
      });
      await link(a, client);
      await expectSeesNothing(client);
    });

    it("B, not assigned, cannot publish for A's client through either service (NOT_ASSIGNED, nothing written)", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client);
      const mealDraft = await db.mealPlan.create({
        data: { clientId: client.id, weekOf: WEEK, status: "DRAFT", items: { create: [{ mealName: "B", foodName: "B food", quantity: "1", unit: "cup" }] } },
      });
      expect(await publishMealPlanTarget((await getMealPlanPublishTarget(mealDraft.id))!, { publishedByCoachId: b.id })).toEqual({ ok: false, code: "NOT_ASSIGNED" });
      const programDraft = await db.trainingProgram.create({ data: { clientId: client.id, weekOf: WEEK, status: "DRAFT" } });
      expect(await publishTrainingProgramTarget({ id: programDraft.id, clientId: client.id, status: "DRAFT" }, { publishedByCoachId: b.id })).toEqual({ ok: false, code: "NOT_ASSIGNED" });
      expect(await db.mealPlan.findUniqueOrThrow({ where: { id: mealDraft.id } })).toMatchObject({ status: "DRAFT", publishedByCoachId: null });
      expect(await db.trainingProgram.findUniqueOrThrow({ where: { id: programDraft.id } })).toMatchObject({ status: "DRAFT", publishedByCoachId: null });
      expect((await expectSeesNothing(client)).provider.coachId).toBe(a.id);
    });

    it("legacy overlap (P8): rows A and B both backfilled, B's unknown-author plan during the overlap, B removed, context HUMAN on A -> hidden", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      // Main-era two-row shape, with the facts-only backfill the migration writes.
      const rowA = await db.coachClient.create({ data: { coachId: a.id, clientId: client.id } });
      const rowB = await db.coachClient.create({ data: { coachId: b.id, clientId: client.id } });
      for (const row of [rowA, rowB]) {
        await db.coachClientEpisode.create({ data: { coachId: row.coachId, clientId: client.id, coachClientId: row.id, startedAt: row.createdAt, source: "BACKFILL" } });
      }
      await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: rowB.id, revision: 1 } });
      await publish(client.id, new Date());
      await coachRemoves(b, client);
      const seen = await expectSeesNothing(client);
      expect(seen.provider.coachId).toBe(a.id);
    });
  });

  describe("privacy: a previous coach's plan never surfaces (audit and review r1/r2 probes)", () => {
    async function purgeCoach(coach: U) {
      await db.user.update({ where: { id: coach.id }, data: { isDeactivated: true } });
      const req = await db.accountDeletionRequest.create({ data: { userId: coach.id, roleAtRequest: "COACH", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) } });
      await purgeUserAccount(coach.id);
      expect(await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: "COMPLETED" });
    }
    async function leadFor(b: U, email: string, prospectId: string | null) {
      const profile = await db.coachProfile.create({ data: { userId: b.id, slug: `t2058-${randomUUID()}` } });
      return db.coachingRequest.create({ data: { coachProfileId: profile.id, prospectName: "P", prospectEmail: email, prospectEmailAddr: email, intakeAnswers: {}, status: "PENDING", consultationStage: "FORMS_SIGNED", prospectId } });
    }
    async function eraOneWithA(a: U, c: U) {
      await link(a, c, ago(60));
      await message(c.id, a.id, a.id, ago(59));
      await coachRemoves(a, c);
    }
    const asCoach = (u: U) => { auth.user = { ...u, activeRole: "COACH", isCoach: true }; };

    it("S3: client moves from A to B", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client, ago(10));
      await message(client.id, a.id, a.id, ago(9));
      await publish(client.id, ago(5));
      await coachRemoves(a, client);
      await link(b, client);
      expect((await expectSeesNothing(client)).provider.coachId).toBe(b.id);
    });

    it("S3: B invited while the client was still with A, A published after that invite", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client, ago(10));
      const bInvite = await invite(b.id, client.email, ago(6));
      await publish(client.id, ago(3));
      await coachRemoves(a, client);
      expect((await acceptClientInviteForUser(bInvite, client)).success).toBe(true);
      expect((await expectSeesNothing(client)).provider.coachId).toBe(b.id);
    });

    it("A -> B -> A, B linked by invite", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client, ago(20));
      await message(client.id, a.id, a.id, ago(19));
      await publish(client.id, ago(18), 1);
      await coachRemoves(a, client);
      await link(b, client, ago(15));
      await publish(client.id, ago(12), 2);
      await coachRemoves(b, client);
      await link(a, client);
      expect((await expectSeesNothing(client)).provider.coachId).toBe(a.id);
    });

    it("A -> B -> A, B known only from a main-era message (coachId NULL)", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await message(client.id, a.id, null, ago(20));
      await publish(client.id, ago(18), 1);
      await message(client.id, b.id, null, ago(14));
      await publish(client.id, ago(12), 2);
      await db.coachClient.create({ data: { coachId: a.id, clientId: client.id } });
      await expectSeesNothing(client);
    });

    it("A -> AI -> A", async () => {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client, ago(20));
      await message(client.id, a.id, a.id, ago(19));
      await publish(client.id, ago(18));
      await coachRemoves(a, client);
      await db.aiCoachProviderTransitionReceipt.create({
        data: {
          clientId: client.id, fromMode: "NONE", fromContextRevision: 1, toMode: "AI", toContextRevision: 2,
          releaseId: "t2058", runtimeConfigurationDigest: "a".repeat(64), discoveryConfigurationId: "c",
          discoveryConfigurationVersion: 1, privacyNoticeVersion: "v", consentTextDigest: "b".repeat(64), createdAt: ago(10),
        },
      });
      await link(a, client);
      await expectSeesNothing(client);
    });

    it("P1: A -> B -> A, B purges their account", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await link(a, c, ago(40));
      await message(c.id, a.id, a.id, ago(39));
      await coachRemoves(a, c);
      await link(b, c);
      await publish(c.id, new Date(Date.now() - 1000));
      await message(c.id, c.id, b.id, new Date(Date.now() - 900));
      await coachRemoves(b, c);
      await purgeCoach(b);
      await link(a, c);
      await expectSeesNothing(c);
    });

    it("P2: B -> A, A's invite issued while the client was with B, B purges", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await link(b, c, ago(30));
      await message(c.id, b.id, b.id, ago(29));
      const early = await invite(a.id, c.email, ago(20));
      await publish(c.id, ago(10));
      await coachRemoves(b, c);
      await purgeCoach(b);
      expect((await acceptClientInviteForUser(early, c)).success).toBe(true);
      await expectSeesNothing(c);
    });

    it("P3: T-2056 re-homed intake (coachId = A, sentAt from B's era), B purged", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await link(b, c, ago(30));
      await publish(c.id, ago(10));
      await coachRemoves(b, c);
      await link(a, c);
      await db.clientIntake.create({ data: { clientId: c.id, coachId: a.id, sentAt: ago(25) } });
      await purgeCoach(b);
      await expectSeesNothing(c);
    });

    it("P3b: the same re-homed intake, no purge", async () => {
      const a = await mk("coach"); const c = await mk("client");
      await publish(c.id, ago(10));
      await link(a, c);
      await db.clientIntake.create({ data: { clientId: c.id, coachId: a.id, sentAt: ago(25) } });
      await expectSeesNothing(c);
    });

    it("P4: B's only footprint is an old ACCEPTED lead and its in-place reissued invite", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      const profile = await db.coachProfile.create({ data: { userId: b.id, slug: `t2058-${randomUUID()}` } });
      const lead = await db.coachingRequest.create({ data: { coachProfileId: profile.id, prospectName: "P", prospectEmail: c.email, prospectEmailAddr: c.email, intakeAnswers: {}, status: "ACCEPTED", consultationStage: "ACTIVE", prospectId: c.id, createdAt: ago(90) } });
      await eraOneWithA(a, c);
      const binv = await db.clientInvite.create({ data: { coachId: b.id, email: c.email, name: "c", requestId: lead.id, expiresAt: new Date(Date.now() + 7 * DAY), createdAt: ago(90) } });
      expect((await acceptClientInviteForUser(binv, c)).success).toBe(true);
      await publish(c.id, new Date(Date.now() - 1000));
      await coachRemoves(b, c);
      await link(a, c);
      await expectSeesNothing(c);
    });

    it("P4 variant: lead-linked invite, lead later declined, client changed email", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      const lead = await leadFor(b, c.email, c.id);
      await eraOneWithA(a, c);
      const binv = await db.clientInvite.create({ data: { coachId: b.id, email: c.email, name: "c", requestId: lead.id, expiresAt: new Date(Date.now() + 7 * DAY), createdAt: ago(90) } });
      expect((await acceptClientInviteForUser(binv, c)).success).toBe(true);
      await db.coachingRequest.update({ where: { id: lead.id }, data: { status: "DECLINED" } });
      await publish(c.id, new Date(Date.now() - 1000));
      await coachRemoves(b, c);
      const moved = await db.user.update({ where: { id: c.id }, data: { email: `moved-${randomUUID()}@example.test` } });
      await link(a, moved);
      await expectSeesNothing(moved);
    });

    it("P5: B re-activates its lead (invite reissued PENDING) then declines it", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await eraOneWithA(a, c);
      const lead = await leadFor(b, c.email, null);
      expect((await activateLead({ requestId: lead.id, coachUserId: b.id, mode: "PIPELINE" })).ok).toBe(true);
      const inv = await db.clientInvite.findUniqueOrThrow({ where: { requestId: lead.id } });
      expect((await acceptClientInviteForUser(inv, c)).success).toBe(true);
      await publish(c.id, new Date(Date.now() - 1000));
      await coachRemoves(b, c);
      expect((await activateLead({ requestId: lead.id, coachUserId: b.id, mode: "BYPASS" })).ok).toBe(true);
      asCoach(b); await declineRequest(lead.id);
      await link(a, c);
      await expectSeesNothing(c);
    });

    it("P5b: same as P5 with markContacted instead of declineRequest", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await eraOneWithA(a, c);
      const lead = await leadFor(b, c.email, c.id);
      expect((await activateLead({ requestId: lead.id, coachUserId: b.id, mode: "PIPELINE" })).ok).toBe(true);
      const inv = await db.clientInvite.findUniqueOrThrow({ where: { requestId: lead.id } });
      expect((await acceptClientInviteForUser(inv, c)).success).toBe(true);
      await publish(c.id, new Date(Date.now() - 1000));
      await coachRemoves(b, c);
      expect((await activateLead({ requestId: lead.id, coachUserId: b.id, mode: "BYPASS" })).ok).toBe(true);
      asCoach(b); await markContacted(lead.id);
      await link(a, c);
      await expectSeesNothing(c);
    });

    it("P6: mismatch-accepted lead invite, B reissues it (mismatchEmail cleared)", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await eraOneWithA(a, c);
      const lead = await leadFor(b, `work-${randomUUID()}@example.test`, null);
      expect((await activateLead({ requestId: lead.id, coachUserId: b.id, mode: "PIPELINE" })).ok).toBe(true);
      const inv = await db.clientInvite.findUniqueOrThrow({ where: { requestId: lead.id } });
      expect((await acceptClientInviteForUser(inv, c, { confirmDifferentEmail: true })).success).toBe(true);
      await publish(c.id, new Date(Date.now() - 1000));
      await coachRemoves(b, c);
      asCoach(b); await markContacted(lead.id);
      expect((await activateLead({ requestId: lead.id, coachUserId: b.id, mode: "BYPASS" })).ok).toBe(true);
      await link(a, c);
      await expectSeesNothing(c);
    });

    it("P7: direct invite, then the client changes email", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const c = await mk("client");
      await eraOneWithA(a, c);
      await link(b, c);
      await publish(c.id, new Date(Date.now() - 1000));
      await coachRemoves(b, c);
      const moved = await db.user.update({ where: { id: c.id }, data: { email: `changed-${randomUUID()}@example.test` } });
      await link(a, moved);
      await expectSeesNothing(moved);
    });
  });

  // ── T-2060 review r1 BLOCKER: a removed (and then purged) coach's plan ────

  describe("T-2060 r1: a removed coach can never publish for, or after purge expose a plan to, the client", () => {
    async function purgeCoach(u: U) {
      await db.user.update({ where: { id: u.id }, data: { isDeactivated: true } });
      await db.accountDeletionRequest.create({ data: { userId: u.id, roleAtRequest: "COACH", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) } });
      await purgeUserAccount(u.id);
      expect(await db.user.findUnique({ where: { id: u.id } })).toBeNull();
    }
    async function expectSeesOnly(client: U, plan: { meal: { id: string }; program: { id: string } }) {
      expect(await clientSees(client)).toMatchObject({
        webMealId: plan.meal.id, webProgramId: plan.program.id,
        iosMealId: plan.meal.id, iosProgramId: plan.program.id, mealNames: ["Breakfast"],
      });
    }
    const status = async (id: string) => (await db.mealPlan.findUniqueOrThrow({ where: { id } })).status;

    it("import after removal: B's OCR import-and-publish for K is refused (403), A's plan stays PUBLISHED and visible, before and after B is purged", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const k = await mk("client");
      await link(b, k);
      // B uploads K's plan while assigned; the parse leaves a draft.
      const upload = await db.mealPlanUpload.create({ data: { coachId: b.id, clientId: k.id, storagePath: `meal-plan-uploads/${randomUUID()}.pdf`, status: "NEEDS_REVIEW" } });
      const importDraft = await db.mealPlanDraft.create({ data: { uploadId: upload.id, parsedJson: { title: "B plan", meals: [{ name: "B meal", items: [{ food: "B food", portion: "1 cup" }] }] } } });
      await coachRemoves(b, k);
      await link(a, k);
      const pa = await publishAs(a, k);

      clerk.userId = b.clerkId;
      const res = await importPlanRoute(new NextRequest("https://example.test/api/mealplans/import-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: importDraft.id, publish: true }),
      }));
      expect(res.status).toBe(403);
      expect(await db.mealPlan.count({ where: { clientId: k.id, status: "PUBLISHED", publishedByCoachId: b.id } })).toBe(0);
      expect(await status(pa.meal.id)).toBe("PUBLISHED");
      await expectSeesOnly(k, pa);

      await purgeCoach(b);
      expect(await status(pa.meal.id)).toBe("PUBLISHED");
      await expectSeesOnly(k, pa);
    });

    it("publish after removal, then purge: B's service publish is refused; a B-authored row published after K's re-link (legacy/raced shape) stays hidden after B's purge (author 'purged', never NULL)", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const k = await mk("client");
      await link(b, k);
      await coachRemoves(b, k);
      await link(a, k);
      const pa = await publishAs(a, k);
      // B publishes after removal through the service: refused, nothing written.
      const bDraft = await db.mealPlan.create({
        data: { clientId: k.id, weekOf: new Date("2026-05-11T00:00:00Z"), status: "DRAFT", items: { create: [{ mealName: "B meal", foodName: "B food", quantity: "1", unit: "cup" }] } },
      });
      expect(await publishMealPlanTarget((await getMealPlanPublishTarget(bDraft.id))!, { publishedByCoachId: b.id })).toEqual({ ok: false, code: "NOT_ASSIGNED" });
      // The shape the purge used to expose: a B-authored PUBLISHED row newer than
      // K's link to A (written before this fix, or by a raced pre-lock publish).
      const legacyB = await db.mealPlan.create({
        data: {
          clientId: k.id, weekOf: new Date("2026-05-18T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date(), publishedByCoachId: b.id,
          items: { create: [{ mealName: "B meal", foodName: "B food", quantity: "1", unit: "cup" }] },
        },
      });
      await expectSeesOnly(k, pa);

      await purgeCoach(b);
      expect(await db.mealPlan.findUniqueOrThrow({ where: { id: legacyB.id } })).toMatchObject({ status: "PUBLISHED", publishedByCoachId: "purged" });
      expect(await status(pa.meal.id)).toBe("PUBLISHED");
      await expectSeesOnly(k, pa);
    });

    it("race: B's web publish authorizes, then B is removed, K links A and A publishes before B's write -> B refused, A's plan stays PUBLISHED and visible", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const k = await mk("client");
      await link(b, k);
      const bDraft = await db.mealPlan.create({
        data: { clientId: k.id, weekOf: WEEK, version: 1, status: "DRAFT", items: { create: [{ mealName: "B meal", foodName: "B food", quantity: "1", unit: "cup" }] } },
      });
      let pa: Awaited<ReturnType<typeof publishAs>> | null = null;
      // The service's content read runs after the action's access check and
      // before the transaction: the exact window between check and write.
      const realFindUnique = db.mealPlan.findUnique.bind(db.mealPlan);
      const spy = vi.spyOn(db.mealPlan, "findUnique");
      spy.mockImplementationOnce(((args: Parameters<typeof realFindUnique>[0]) =>
        (async () => {
          const content = await realFindUnique(args);
          const row = await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: b.id, clientId: k.id } }, select: { id: true } });
          await endCoachClientRelationship({ coachClientId: row.id, coachId: b.id, clientId: k.id, endedBy: "COACH" });
          await link(a, k);
          pa = await publishAs(a, k);
          return content;
        })()) as unknown as typeof db.mealPlan.findUnique);
      try {
        auth.user = { ...b, activeRole: "COACH", isCoach: true };
        await expect(publishMealPlan({ mealPlanId: bDraft.id, notifyClient: false })).rejects.toThrow("Not assigned to this client");
      } finally {
        spy.mockRestore();
      }
      expect(pa).not.toBeNull();
      expect(await status(pa!.meal.id)).toBe("PUBLISHED");
      expect(await db.mealPlan.count({ where: { clientId: k.id, publishedByCoachId: b.id } })).toBe(0);
      await expectSeesOnly(k, pa!);
    });
  });

  // ── D5: drafts die with the relationship ─────────────────────────────────

  describe("D5: removal deletes the client's unpublished drafts", () => {
    async function withDrafts() {
      const a = await mk("coach"); const client = await mk("client");
      await link(a, client);
      const draftWeek = new Date("2026-10-12T00:00:00Z");
      const mealDraft = await db.mealPlan.create({ data: { clientId: client.id, weekOf: draftWeek, status: "DRAFT", supportContent: "A private notes" } });
      const programDraft = await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: draftWeek, status: "DRAFT", days: { create: [{ dayName: "A day" }] } },
      });
      const published = await publish(client.id, new Date());
      return { a, client, draftWeek, mealDraft, programDraft, published };
    }

    async function expectDraftsGoneHistoryKept(s: Awaited<ReturnType<typeof withDrafts>>) {
      expect(await db.mealPlan.count({ where: { clientId: s.client.id, status: "DRAFT" } })).toBe(0);
      expect(await db.trainingProgram.count({ where: { clientId: s.client.id, status: "DRAFT" } })).toBe(0);
      expect(await db.mealPlan.findUnique({ where: { id: s.published.meal.id } })).toMatchObject({ status: "PUBLISHED" });
      expect(await db.trainingProgram.findUnique({ where: { id: s.published.program.id } })).toMatchObject({ status: "PUBLISHED" });
      // The next coach's workspaces open nothing of A's unpublished work.
      const b = await mk("coach");
      await link(b, s.client);
      const meal = await getEffectiveMealPlanForReview({ coachId: b.id, clientId: s.client.id, weekOf: s.draftWeek });
      expect(meal.source).not.toBe("draft");
      expect(meal).not.toMatchObject({ supportContent: "A private notes" });
      expect((await getTrainingProgramForReview(s.client.id, s.draftWeek))?.source).not.toBe("draft");
    }

    it("web removeClient (coach)", async () => {
      const s = await withDrafts();
      await coachRemoves(s.a, s.client);
      await expectDraftsGoneHistoryKept(s);
    });

    it("iOS DELETE /api/coach/clients/[clientId] (coach)", async () => {
      const s = await withDrafts();
      auth.user = { ...s.a, activeRole: "COACH", isCoach: true };
      const res = await deleteClientRoute(new NextRequest("http://localhost/api/coach/clients/x", { method: "DELETE" }), { params: Promise.resolve({ clientId: s.client.id }) });
      expect(res.status).toBe(200);
      await expectDraftsGoneHistoryKept(s);
    });

    it("web leaveCoach (client)", async () => {
      const s = await withDrafts();
      const row = await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: s.a.id, clientId: s.client.id } } });
      auth.user = { ...s.client, activeRole: "CLIENT", isClient: true };
      await leaveCoach({ coachClientId: row.id });
      await expectDraftsGoneHistoryKept(s);
    });

    it("rolls back with the removal: a failure later in the same transaction leaves the row and both drafts in place", async () => {
      const s = await withDrafts();
      fail.reconcile = true;
      auth.user = { ...s.a, activeRole: "COACH", isCoach: true };
      const res = await deleteClientRoute(new NextRequest("http://localhost/api/coach/clients/x", { method: "DELETE" }), { params: Promise.resolve({ clientId: s.client.id }) });
      expect(res.status).toBe(500);
      fail.reconcile = false;
      expect(await db.coachClient.count({ where: { coachId: s.a.id, clientId: s.client.id } })).toBe(1);
      expect(await db.mealPlan.findUnique({ where: { id: s.mealDraft.id } })).not.toBeNull();
      expect(await db.trainingProgram.findUnique({ where: { id: s.programDraft.id } })).not.toBeNull();
    });

    it("a client still holding another relationship keeps their drafts (no authorship to tell whose they are)", async () => {
      const s = await withDrafts();
      const b = await mk("coach");
      await db.coachClient.create({ data: { coachId: b.id, clientId: s.client.id } }); // legacy two-row shape
      await coachRemoves(s.a, s.client);
      expect(await db.mealPlan.findUnique({ where: { id: s.mealDraft.id } })).not.toBeNull();
      expect(await db.trainingProgram.findUnique({ where: { id: s.programDraft.id } })).not.toBeNull();
    });
  });

  // ── D7: lead stage parity, unread scope ──────────────────────────────────

  describe("D7", () => {
    async function activeLead() {
      const coach = await mk("coach"); const client = await mk("client");
      const profile = await db.coachProfile.create({ data: { userId: coach.id, slug: `t2058-${randomUUID()}` } });
      await link(coach, client);
      const lead = await db.coachingRequest.create({
        data: {
          coachProfileId: profile.id, prospectName: "P", prospectEmail: client.email, prospectEmailAddr: client.email,
          intakeAnswers: {}, status: "ACCEPTED", consultationStage: "ACTIVE", prospectId: client.id,
        },
      });
      return { coach, client, lead };
    }
    const leadRow = (id: string) => db.coachingRequest.findUniqueOrThrow({ where: { id }, select: { consultationStage: true, status: true } });

    it("web removeClient and iOS DELETE leave the lead in the same state, and the coach can activate it again", async () => {
      const web = await activeLead();
      await coachRemoves(web.coach, web.client);
      const ios = await activeLead();
      auth.user = { ...ios.coach, activeRole: "COACH", isCoach: true };
      const res = await deleteClientRoute(new NextRequest("http://localhost/api/coach/clients/x", { method: "DELETE" }), { params: Promise.resolve({ clientId: ios.client.id }) });
      expect(res.status).toBe(200);

      expect(await leadRow(web.lead.id)).toEqual({ consultationStage: "CONSULTATION_DONE", status: "ACCEPTED" });
      expect(await leadRow(ios.lead.id)).toEqual(await leadRow(web.lead.id));
      // "same coach again": the lead is not terminal, so the coach can re-activate it.
      const again = await activateLead({ requestId: web.lead.id, coachUserId: web.coach.id, mode: "BYPASS" });
      expect(again.ok).toBe(true);
    });

    it("client-initiated leaveCoach still declines the lead (unchanged)", async () => {
      const s = await activeLead();
      const row = await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: s.coach.id, clientId: s.client.id } } });
      auth.user = { ...s.client, activeRole: "CLIENT", isClient: true };
      await leaveCoach({ coachClientId: row.id });
      expect(await leadRow(s.lead.id)).toEqual({ consultationStage: "DECLINED", status: "DECLINED" });
    });

    it("hasUnreadMessages counts only the asking coach's conversation", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await message(client.id, client.id, a.id, ago(1)); // client -> A
      expect(await hasUnreadMessages(client.id, WEEK, b.id)).toBe(false);
      expect(await hasUnreadMessages(client.id, WEEK, a.id)).toBe(true);
    });
  });

  // ── D8: webhook placeholder claim honours isDeactivated ──────────────────

  describe("D8: Clerk webhook pending_ claim", () => {
    async function placeholder(isDeactivated: boolean) {
      const email = `placeholder-${randomUUID()}@example.test`;
      return db.user.create({ data: { clerkId: `pending_${randomUUID()}`, email, isDeactivated } });
    }
    function created(clerkId: string, email: string) {
      hook.evt = {
        type: "user.created",
        data: {
          id: clerkId, first_name: "New", last_name: "Owner", public_metadata: {},
          primary_email_address_id: "e1",
          email_addresses: [{ id: "e1", email_address: email, verification: { status: "verified" } }],
        },
      };
      return clerkWebhook(new NextRequest("http://localhost/api/webhooks/clerk", { method: "POST", body: "{}" }));
    }

    it("does not rebind a deactivated placeholder to the new Clerk identity", async () => {
      const p = await placeholder(true);
      const clerkId = `user_${randomUUID()}`;
      await created(clerkId, p.email);
      expect((await db.user.findUniqueOrThrow({ where: { id: p.id } })).clerkId).toBe(p.clerkId);
      expect(await db.user.findUnique({ where: { clerkId } })).toBeNull();
    });

    it("still claims an active placeholder (regression)", async () => {
      const p = await placeholder(false);
      const clerkId = `user_${randomUUID()}`;
      const res = await created(clerkId, p.email);
      expect(res.status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: p.id } })).clerkId).toBe(clerkId);
    });
  });
});
