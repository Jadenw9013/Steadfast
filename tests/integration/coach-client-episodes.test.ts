import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";

/**
 * T-2060 — CoachClientEpisode is written in the same transaction as every
 * CoachClient create and delete, and the account purge closes, anonymises or
 * deletes it. Also runs the migration's backfill statement and
 * scripts/sql/T-2060-episode-reconcile.sql through psql (against temp-table
 * shadows of the two tables, so the shared test database is never swept).
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
  currentUser: async () => null,
  clerkClient: async () => ({ users: { deleteUser: async () => ({}) } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ storage: { from: () => ({ remove: async () => ({ error: null }) }) } }) }));
vi.mock("@/lib/account-deletion/billing", () => ({ stopAccountBilling: async () => undefined }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
// Same injected-failure pattern as relationship-rules.test.ts: the removal
// transaction fails after the row delete and the episode close.
const fail = vi.hoisted(() => ({ reconcile: false }));
vi.mock("@/lib/activation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activation")>();
  return {
    ...actual,
    reconcileCoachingContextForClient: async (...args: Parameters<typeof actual.reconcileCoachingContextForClient>) => {
      if (fail.reconcile) throw new Error("T-2060 injected failure");
      return actual.reconcileCoachingContextForClient(...args);
    },
  };
});

import { db } from "@/lib/db";
import { acceptClientInviteForUser } from "@/lib/activation";
import { removeClient, leaveCoach } from "@/app/actions/coach-client";
import { DELETE as deleteClientRoute } from "@/app/api/coach/clients/[clientId]/route";
import { POST as connectCoachRoute } from "@/app/api/client/connect-coach/route";
import { purgeUserAccount } from "@/lib/account-deletion/purge";
import { getMealPlanPublishTarget, publishMealPlanTarget } from "@/lib/meal-plans/publish";
import { publishTrainingProgramTarget } from "@/lib/training-programs/publish";
import { requireLocalTestDb } from "../helpers/require-local-test-db";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

const DAY = 86_400_000;
type U = { id: string; email: string; clerkId: string };

async function mk(kind: "coach" | "client" | "both"): Promise<U> {
  const id = randomUUID();
  return db.user.create({
    data: {
      clerkId: id,
      email: `${kind}-${id}@example.test`,
      isCoach: kind !== "client",
      isClient: kind !== "coach",
      activeRole: kind === "client" ? "CLIENT" : "COACH",
    },
  });
}

async function invite(coachId: string, email: string) {
  return db.clientInvite.create({
    data: { coachId, email, name: "c", expiresAt: new Date(Date.now() + 7 * DAY) },
  });
}

async function link(coach: U, client: U) {
  const inv = await invite(coach.id, client.email);
  const r = await acceptClientInviteForUser(inv, client);
  expect(r.success).toBe(true);
  return db.coachClient.findUniqueOrThrow({
    where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
    select: { id: true, createdAt: true },
  });
}

const episodesOf = (clientId: string) =>
  db.coachClientEpisode.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });

async function iosDelete(coach: U, client: U) {
  auth.user = { ...coach, activeRole: "COACH", isCoach: true };
  return deleteClientRoute(new NextRequest("http://localhost/api/coach/clients/x", { method: "DELETE" }), {
    params: Promise.resolve({ clientId: client.id }),
  });
}

async function purge(u: U, role: "COACH" | "CLIENT") {
  await db.user.update({ where: { id: u.id }, data: { isDeactivated: true } });
  await db.accountDeletionRequest.create({
    data: { userId: u.id, roleAtRequest: role, status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) },
  });
  await purgeUserAccount(u.id);
  expect(await db.user.findUnique({ where: { id: u.id } })).toBeNull();
}

/** Publishes one meal plan and one training program through the real services. */
async function publishAs(coach: U, client: U) {
  const meal = await db.mealPlan.create({
    data: {
      clientId: client.id, weekOf: new Date("2026-05-04T00:00:00Z"), status: "DRAFT",
      items: { create: [{ mealName: "Breakfast", foodName: "Oats", quantity: "1", unit: "cup" }] },
    },
  });
  const target = await getMealPlanPublishTarget(meal.id);
  expect((await publishMealPlanTarget(target!, { publishedByCoachId: coach.id })).ok).toBe(true);
  const program = await db.trainingProgram.create({
    data: { clientId: client.id, weekOf: new Date("2026-05-04T00:00:00Z"), status: "DRAFT" },
  });
  expect((await publishTrainingProgramTarget({ id: program.id, clientId: client.id, status: "DRAFT" }, { publishedByCoachId: coach.id })).ok).toBe(true);
  return { mealId: meal.id, programId: program.id };
}

suite("T-2060 CoachClientEpisode writers", () => {
  beforeEach(() => {
    auth.user = null;
    fail.reconcile = false;
  });
  afterAll(() => db.$disconnect());

  describe("open", () => {
    it("acceptClientInviteForUser opens one LIVE episode copied from the row", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      const row = await link(coach, client);
      const eps = await episodesOf(client.id);
      expect(eps).toHaveLength(1);
      expect(eps[0]).toMatchObject({
        coachId: coach.id, clientId: client.id, coachClientId: row.id,
        endedAt: null, endReason: null, source: "LIVE",
      });
      expect(eps[0].startedAt.getTime()).toBe(row.createdAt.getTime());
    });

    it("POST /api/client/connect-coach (iOS) opens the same episode", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      const inv = await invite(coach.id, client.email);
      auth.user = { ...client, activeRole: "CLIENT", isClient: true };
      const res = await connectCoachRoute(new NextRequest("https://example.test/api/client/connect-coach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachCode: inv.inviteToken }),
      }));
      expect(res.status).toBe(200);
      const row = await db.coachClient.findUniqueOrThrow({
        where: { coachId_clientId: { coachId: coach.id, clientId: client.id } }, select: { id: true, createdAt: true },
      });
      const eps = await episodesOf(client.id);
      expect(eps).toHaveLength(1);
      expect(eps[0]).toMatchObject({ coachId: coach.id, coachClientId: row.id, endedAt: null, source: "LIVE" });
      expect(eps[0].startedAt.getTime()).toBe(row.createdAt.getTime());
    });

    it("an alreadyConnected accept writes no second episode", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await link(coach, client);
      const again = await acceptClientInviteForUser(await invite(coach.id, client.email), client);
      expect(again).toMatchObject({ success: true, alreadyConnected: true });
      expect(await episodesOf(client.id)).toHaveLength(1);
    });
  });

  describe("close", () => {
    it("web removeClient closes COACH_REMOVED", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      const row = await link(coach, client);
      auth.user = { ...coach, activeRole: "COACH", isCoach: true };
      await removeClient({ clientId: client.id });
      const eps = await episodesOf(client.id);
      expect(eps).toHaveLength(1);
      expect(eps[0]).toMatchObject({ coachClientId: row.id, endReason: "COACH_REMOVED", source: "LIVE" });
      expect(eps[0].endedAt).toBeInstanceOf(Date);
    });

    it("iOS DELETE /api/coach/clients/[clientId] closes COACH_REMOVED", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await link(coach, client);
      expect((await iosDelete(coach, client)).status).toBe(200);
      expect(await episodesOf(client.id)).toMatchObject([{ endReason: "COACH_REMOVED", source: "LIVE" }]);
    });

    it("web leaveCoach closes CLIENT_LEFT", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      const row = await link(coach, client);
      auth.user = { ...client, activeRole: "CLIENT", isClient: true };
      await leaveCoach({ coachClientId: row.id });
      expect(await episodesOf(client.id)).toMatchObject([{ endReason: "CLIENT_LEFT", source: "LIVE" }]);
    });

    it("a failure later in the removal transaction leaves the row and the open episode intact", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await link(coach, client);
      fail.reconcile = true;
      expect((await iosDelete(coach, client)).status).toBe(500);
      fail.reconcile = false;
      expect(await db.coachClient.count({ where: { coachId: coach.id, clientId: client.id } })).toBe(1);
      expect(await episodesOf(client.id)).toMatchObject([{ endedAt: null, endReason: null }]);
    });

    it("removing a row the old code created (no episode) records one closed BACKFILL episode from the row's facts", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      const row = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
      await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: row.id, revision: 1 } });
      expect(await episodesOf(client.id)).toHaveLength(0);
      expect((await iosDelete(coach, client)).status).toBe(200);
      const eps = await episodesOf(client.id);
      expect(eps).toHaveLength(1);
      expect(eps[0]).toMatchObject({ coachId: coach.id, coachClientId: row.id, endReason: "COACH_REMOVED", source: "BACKFILL" });
      expect(eps[0].startedAt.getTime()).toBe(row.createdAt.getTime());
      expect(eps[0].endedAt).toBeInstanceOf(Date);
    });
  });

  describe("account purge", () => {
    it("coach purge closes the client's episode COACH_ACCOUNT_DELETED with coachId NULL, and the client's plans keep a 'purged' author (never NULL)", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await link(coach, client);
      const { mealId, programId } = await publishAs(coach, client);
      expect(await db.mealPlan.findUniqueOrThrow({ where: { id: mealId } })).toMatchObject({ publishedByCoachId: coach.id });

      await purge(coach, "COACH");

      const eps = await episodesOf(client.id);
      expect(eps).toHaveLength(1);
      expect(eps[0]).toMatchObject({ coachId: null, endReason: "COACH_ACCOUNT_DELETED" });
      expect(eps[0].endedAt).toBeInstanceOf(Date);
      expect(await db.mealPlan.findUniqueOrThrow({ where: { id: mealId } })).toMatchObject({ status: "PUBLISHED", publishedByCoachId: "purged" });
      expect(await db.trainingProgram.findUniqueOrThrow({ where: { id: programId } })).toMatchObject({ status: "PUBLISHED", publishedByCoachId: "purged" });
    });

    it("coach purge keeps an already-closed episode's end and reason, only anonymising it", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      await link(coach, client);
      auth.user = { ...coach, activeRole: "COACH", isCoach: true };
      await removeClient({ clientId: client.id });
      const [before] = await episodesOf(client.id);
      await purge(coach, "COACH");
      const [after] = await episodesOf(client.id);
      expect(after).toMatchObject({ id: before.id, coachId: null, endReason: "COACH_REMOVED" });
      expect(after.endedAt?.getTime()).toBe(before.endedAt?.getTime());
    });

    it("coach purge of a row the old code created records a closed, anonymised BACKFILL episode", async () => {
      const coach = await mk("coach"); const client = await mk("client");
      const row = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
      await purge(coach, "COACH");
      const eps = await episodesOf(client.id);
      expect(eps).toHaveLength(1);
      expect(eps[0]).toMatchObject({ coachId: null, coachClientId: row.id, source: "BACKFILL", endReason: "COACH_ACCOUNT_DELETED" });
      expect(eps[0].startedAt.getTime()).toBe(row.createdAt.getTime());
    });

    it("client purge deletes the client's episodes", async () => {
      const a = await mk("coach"); const b = await mk("coach"); const client = await mk("client");
      await link(a, client);
      auth.user = { ...a, activeRole: "COACH", isCoach: true };
      await removeClient({ clientId: client.id });
      await link(b, client);
      expect(await episodesOf(client.id)).toHaveLength(2);
      await purge(client, "CLIENT");
      expect(await db.coachClientEpisode.count({ where: { clientId: client.id } })).toBe(0);
      expect(await db.coachClientEpisode.count({ where: { coachId: { in: [a.id, b.id] } } })).toBe(0);
    });

    it("dual-role purge: own client history deleted, coached clients' episodes anonymised", async () => {
      const dual = await mk("both"); const coachOfDual = await mk("coach"); const client = await mk("client");
      await link(coachOfDual, dual);
      await link(dual, client);
      await purge(dual, "COACH");
      expect(await db.coachClientEpisode.count({ where: { clientId: dual.id } })).toBe(0);
      expect(await episodesOf(client.id)).toMatchObject([{ coachId: null, endReason: "COACH_ACCOUNT_DELETED" }]);
      // The dual's client episode with their own coach went with them.
      expect(await db.coachClientEpisode.count({ where: { coachId: coachOfDual.id } })).toBe(0);
    });
  });

  describe("backfill and reconcile SQL (psql, temp-table shadows)", () => {
    const root = process.cwd();
    const migrationSql = readFileSync(
      join(root, "prisma/migrations/20261016000000_coach_client_episodes_and_plan_authorship/migration.sql"),
      "utf8",
    );
    const backfill = migrationSql.slice(migrationSql.indexOf('INSERT INTO "CoachClientEpisode"'));
    const reconcilePath = join(root, "scripts/sql/T-2060-episode-reconcile.sql");

    /**
     * One psql session. Temp tables shadow public."CoachClient",
     * public."CoachClientEpisode", "MealPlan" and "TrainingProgram" (pg_temp is searched first), copied with
     * their defaults, CHECK constraint and indexes (including the partial
     * unique one), so the scripts' unqualified names hit only these fixtures.
     */
    function psql(fixtureSql: string, steps: { file?: string; sql?: string }[]) {
      const args = [process.env.DATABASE_URL!, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|",
        "-c", `CREATE TEMP TABLE "CoachClient" (LIKE public."CoachClient" INCLUDING ALL);
               CREATE TEMP TABLE "CoachClientEpisode" (LIKE public."CoachClientEpisode" INCLUDING ALL);
               CREATE TEMP TABLE "MealPlan" (LIKE public."MealPlan" INCLUDING ALL);
               CREATE TEMP TABLE "TrainingProgram" (LIKE public."TrainingProgram" INCLUDING ALL);
               ${fixtureSql}`];
      for (const s of steps) {
        if (s.file) args.push("-f", s.file);
        if (s.sql) args.push("-c", s.sql);
      }
      return execFileSync("psql", args, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    }

    const counts = `SELECT 'counts', (SELECT count(*) FROM "CoachClientEpisode"),
      (SELECT count(*) FROM "CoachClientEpisode" WHERE "endedAt" IS NULL),
      (SELECT count(*) FROM "CoachClientEpisode" WHERE "source" = 'BACKFILL' AND "endedAt" IS NULL),
      (SELECT count(*) FROM "CoachClientEpisode" WHERE "endReason" = 'RECONCILED')`;
    const fixtures = `
      INSERT INTO "CoachClient" ("id","coachId","clientId","createdAt") VALUES
        ('row-live', 'coach-1', 'client-1', '2026-01-01T00:00:00Z'),
        ('row-no-episode', 'coach-2', 'client-2', '2026-02-01T00:00:00Z');
      INSERT INTO "CoachClientEpisode" ("id","coachId","clientId","coachClientId","startedAt","source") VALUES
        ('ep-live', 'coach-1', 'client-1', 'row-live', '2026-01-01T00:00:00Z', 'LIVE'),
        ('ep-zombie', 'coach-3', 'client-3', 'row-deleted', '2025-12-01T00:00:00Z', 'LIVE');`;

    it("the migration backfill opens a BACKFILL episode only for rows without one, and is idempotent", () => {
      const out = psql(fixtures, [{ sql: backfill }, { sql: counts }, { sql: backfill }, { sql: counts },
        { sql: `SELECT "coachClientId", to_char("startedAt", 'YYYY-MM-DD') FROM "CoachClientEpisode" WHERE "source" = 'BACKFILL'` }]);
      // 3 episodes (live, zombie, new backfill), 3 open, 1 open BACKFILL, 0 reconciled; unchanged on the 2nd run.
      expect(out).toEqual(["counts|3|3|1|0", "counts|3|3|1|0", "row-no-episode|2026-02-01"]);
    });

    it("the reconcile opens missing episodes, closes zombies RECONCILED, verifies clean, and a second run changes 0 rows", () => {
      const out = psql(fixtures, [{ file: reconcilePath }, { sql: counts }, { file: reconcilePath }, { sql: counts },
        { sql: `SELECT "id", "endReason" FROM "CoachClientEpisode" WHERE "endedAt" IS NOT NULL` }]);
      // Each reconcile run prints its verification row: rows|open|rows_without_episode|zombie_episodes.
      expect(out).toEqual([
        "2|2|0|0",
        "counts|3|2|1|1",
        "2|2|0|0",
        "counts|3|2|1|1",
        "ep-zombie|RECONCILED",
      ]);
    });

    it("the reconcile's two writes report 0 rows on the second run", () => {
      const out = execFileSync("psql", [process.env.DATABASE_URL!, "-X", "-v", "ON_ERROR_STOP=1",
        "-c", `CREATE TEMP TABLE "CoachClient" (LIKE public."CoachClient" INCLUDING ALL);
               CREATE TEMP TABLE "CoachClientEpisode" (LIKE public."CoachClientEpisode" INCLUDING ALL);
               CREATE TEMP TABLE "MealPlan" (LIKE public."MealPlan" INCLUDING ALL);
               CREATE TEMP TABLE "TrainingProgram" (LIKE public."TrainingProgram" INCLUDING ALL);
               ${fixtures}
               INSERT INTO "MealPlan" ("id","clientId","weekOf","status","publishedByCoachId","updatedAt") VALUES
                 ('mp-dead-author', 'client-1', '2026-01-05', 'PUBLISHED', 'user-that-no-longer-exists', now()),
                 ('mp-null-author', 'client-1', '2026-01-12', 'PUBLISHED', NULL, now());`,
        "-f", reconcilePath, "-f", reconcilePath,
        "-c", `SELECT "id", coalesce("publishedByCoachId", 'NULL') FROM "MealPlan" ORDER BY "id"`], { encoding: "utf8" });
      // The first three tags are the fixture INSERTs; then four per reconcile run:
      // episode backfill, zombie close, MealPlan and TrainingProgram author
      // sentinel (a dead author id becomes 'purged'; NULL stays NULL).
      const tags = out.split("\n").filter((l) => /^(INSERT|UPDATE) /.test(l)).slice(3);
      expect(tags).toEqual(["INSERT 0 1", "UPDATE 1", "UPDATE 1", "UPDATE 0", "INSERT 0 0", "UPDATE 0", "UPDATE 0", "UPDATE 0"]);
      expect(out).toMatch(/mp-dead-author \| purged/);
      expect(out).toMatch(/mp-null-author \| NULL/);
    });
  });
});
