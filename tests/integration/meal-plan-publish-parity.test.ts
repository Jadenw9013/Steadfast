import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-660 — the web Server Action and the iOS-facing REST route must publish a
 * meal plan identically: supersede the week's previous PUBLISHED plan, keep at
 * most one PUBLISHED row per (clientId, weekOf), and return a 409 (never a
 * 500) to whoever loses a concurrent publish race.
 *
 * These assertions are only meaningful with the partial unique index
 * `MealPlan_one_published_per_client_week` present. Reproducibility note, since
 * getting that index onto a fresh machine is a real gap:
 *   - The index is raw SQL inside
 *     `prisma/migrations/20260913220000_plan_supersede_backfill/migration.sql`
 *     and is deliberately NOT mirrored in `schema.prisma`, so `prisma db push`
 *     (how this local test DB is kept in sync) neither creates it nor preserves
 *     it — a later `db push` can drop it.
 *   - `prisma migrate deploy` cannot install it either: the local test DB was
 *     created by `db push` and was never baselined, so `migrate deploy` fails
 *     with P3005 ("database schema is not empty").
 * So `beforeAll` below creates the index itself if it is missing, which makes
 * this suite self-healing and reproducible on a fresh checkout. The first test
 * still asserts (never skips) that the index exists, so a missing index can
 * never let the rest of the file pass vacuously.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  notifySms: vi.fn(),
  sendEmail: vi.fn(),
  pushMealPlanUpdated: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: mocks.notifySms }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/push", () => ({ pushMealPlanUpdated: mocks.pushMealPlanUpdated }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/meal-plan/publish/route";
import {
  PUBLISHED_MEAL_PLAN_INDEX,
  isDuplicatePublishedPlanError,
} from "@/lib/meal-plans/publish";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("meal-plan publish parity (action vs REST) with real PostgreSQL constraints", () => {
  // Self-heal the raw-SQL partial index (see the file header for why neither
  // `db push` nor `migrate deploy` can be relied on to put it here). Guarded by
  // the local-database check above, so this can only ever run against
  // 127.0.0.1/steadfast_security_test.
  beforeAll(async () => {
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${PUBLISHED_MEAL_PLAN_INDEX}" ON "MealPlan"("clientId","weekOf") WHERE (status = 'PUBLISHED')`
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifySms.mockResolvedValue(undefined);
    mocks.sendEmail.mockResolvedValue({ success: true });
    mocks.pushMealPlanUpdated.mockResolvedValue(undefined);
  });
  afterAll(async () => { await db.$disconnect(); });

  async function fixture() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;
    return { coach, client };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  function publishRequest(clientId: string, body: unknown) {
    return new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const publishViaRest = (clientId: string, body: unknown) => publishRest(publishRequest(clientId, body), params(clientId));

  async function draft(clientId: string, weekStartDate: string) {
    const created = await createDraftMealPlan({ clientId, weekStartDate, items: [] });
    return created.mealPlanId;
  }

  const statusOf = async (id: string) => (await db.mealPlan.findUniqueOrThrow({ where: { id } })).status;
  const publishedCount = (clientId: string, weekOf: Date) =>
    db.mealPlan.count({ where: { clientId, weekOf, status: "PUBLISHED" } });
  const weekOfPlan = async (id: string) => (await db.mealPlan.findUniqueOrThrow({ where: { id } })).weekOf;

  // ── Guard: without the partial index everything below passes vacuously ─────

  it("the partial unique index MealPlan_one_published_per_client_week exists on this database", async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname = ${PUBLISHED_MEAL_PLAN_INDEX}
    `;
    expect(rows).toHaveLength(1);
  });

  // ── The predicate, against the REAL Prisma/adapter error object ────────────
  //
  // The unit test in tests/unit/meal-plan-publish-error.test.ts hand-builds the
  // error shape from a one-off probe, so it is only as good as that probe being
  // right for every future adapter version. These two cases provoke genuine
  // PostgreSQL 23505s through Prisma — deliberately without any concurrency, so
  // they cannot become timing-dependent — and feed the thrown object straight
  // into the predicate. If a Prisma/adapter upgrade ever moves the index name,
  // the positive case here goes red and the mapping is fixed at the source
  // rather than widened to a bare `code === "P2002"`.

  it("classifies a REAL published-index P2002 as a lost publish race", async () => {
    const { client } = await fixture();
    const week = "2026-05-04";
    const v1 = await draft(client.id, week);
    expect((await publishViaRest(client.id, { mealPlanId: v1 })).status).toBe(200);
    const v2 = await draft(client.id, week);

    // Straight Prisma, bypassing the service entirely: a second PUBLISHED row
    // for a week that already has one must trip
    // MealPlan_one_published_per_client_week.
    let thrown: unknown;
    try {
      await db.mealPlan.updateMany({ where: { id: v2 }, data: { status: "PUBLISHED" } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(isDuplicatePublishedPlanError(thrown)).toBe(true);

    // The write really did not land.
    expect(await statusOf(v2)).toBe("DRAFT");
    expect(await publishedCount(client.id, await weekOfPlan(v1))).toBe(1);
  });

  it("does NOT classify a REAL (clientId, weekOf, version) P2002 as a lost publish race", async () => {
    const { client } = await fixture();
    const week = "2026-05-11";
    const existingId = await draft(client.id, week);
    const existing = await db.mealPlan.findUniqueOrThrow({ where: { id: existingId } });

    // Re-using an already-claimed version number trips
    // MealPlan_clientId_weekOf_version_key — the race lib/meal-plans/version.ts
    // retries on, which must never be read as a lost publish race.
    let thrown: unknown;
    try {
      await db.mealPlan.create({
        data: { clientId: client.id, weekOf: existing.weekOf, version: existing.version },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(isDuplicatePublishedPlanError(thrown)).toBe(false);
  });

  // ── The production break ───────────────────────────────────────────────────

  it("REST route supersedes the week's previous published plan when publishing a revision", async () => {
    const { client } = await fixture();
    const v1 = await draft(client.id, "2026-02-02");
    expect((await publishViaRest(client.id, { mealPlanId: v1 })).status).toBe(200);

    const v2 = await draft(client.id, "2026-02-02");
    const response = await publishViaRest(client.id, { mealPlanId: v2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    expect(await statusOf(v1)).toBe("SUPERSEDED");
    expect(await statusOf(v2)).toBe("PUBLISHED");
    expect(await publishedCount(client.id, await weekOfPlan(v2))).toBe(1);
  });

  it("server action supersedes the week's previous published plan identically", async () => {
    const { client } = await fixture();
    const v1 = await draft(client.id, "2026-02-02");
    await publishMealPlan({ mealPlanId: v1 });

    const v2 = await draft(client.id, "2026-02-02");
    expect(await publishMealPlan({ mealPlanId: v2 })).toEqual({ success: true });

    expect(await statusOf(v1)).toBe("SUPERSEDED");
    expect(await statusOf(v2)).toBe("PUBLISHED");
    expect(await publishedCount(client.id, await weekOfPlan(v2))).toBe(1);
  });

  it("supersedes across surfaces — action then route then action leaves exactly one PUBLISHED", async () => {
    const { client } = await fixture();
    const week = "2026-02-09";

    const v1 = await draft(client.id, week);
    await publishMealPlan({ mealPlanId: v1 });

    const v2 = await draft(client.id, week);
    expect((await publishViaRest(client.id, { mealPlanId: v2 })).status).toBe(200);
    expect(await statusOf(v1)).toBe("SUPERSEDED");
    expect(await publishedCount(client.id, await weekOfPlan(v2))).toBe(1);

    const v3 = await draft(client.id, week);
    await publishMealPlan({ mealPlanId: v3 });
    expect(await statusOf(v2)).toBe("SUPERSEDED");
    expect(await statusOf(v3)).toBe("PUBLISHED");
    expect(await publishedCount(client.id, await weekOfPlan(v3))).toBe(1);
  });

  // ── Races ─────────────────────────────────────────────────────────────────

  it("two concurrent REST publishes of the SAME draft yield one 200 and one 409 PUBLISH_RACE_LOST", async () => {
    const { client } = await fixture();
    const planId = await draft(client.id, "2026-02-16");

    const settled = await Promise.allSettled([
      publishViaRest(client.id, { mealPlanId: planId }),
      publishViaRest(client.id, { mealPlanId: planId }),
    ]);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);

    const responses = settled.map((r) => (r as PromiseFulfilledResult<Response>).value);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    const loser = responses.find((r) => r.status === 409)!;
    expect(await loser.json()).toEqual({
      error: "This plan was already published or changed by someone else",
      code: "PUBLISH_RACE_LOST",
    });

    expect(await statusOf(planId)).toBe("PUBLISHED");
    expect(await publishedCount(client.id, await weekOfPlan(planId))).toBe(1);
  });

  it("concurrent publishes of DIFFERENT drafts for the same week across surfaces never 500 and leave exactly one PUBLISHED", async () => {
    const { client } = await fixture();
    const week = "2026-02-23";
    const a = await draft(client.id, week);
    const b = await draft(client.id, week);

    const [actionResult, restResult] = await Promise.allSettled([
      publishMealPlan({ mealPlanId: a }),
      publishViaRest(client.id, { mealPlanId: b }),
    ]);

    // Deliberately NOT asserting that exactly one of the two wins. Whether the
    // two transactions genuinely overlap is up to PostgreSQL's scheduler: if
    // they serialize, the second one's supersede sees the first's committed
    // PUBLISHED row, demotes it, and also succeeds. That is correct product
    // behavior (a coach publishing a revision), so requiring one loser would
    // make this test flaky. The invariants that must hold either way are:
    // nobody gets a 500 or an unhandled P2002, any loser gets the frozen
    // RACE_LOST shape, and the week ends with exactly one PUBLISHED plan.
    expect(restResult.status).toBe("fulfilled");
    const restResponse = (restResult as PromiseFulfilledResult<Response>).value;
    expect([200, 409]).toContain(restResponse.status);

    const restWon = restResponse.status === 200;
    if (!restWon) {
      expect(await restResponse.json()).toEqual({
        error: "This plan was already published or changed by someone else",
        code: "PUBLISH_RACE_LOST",
      });
    }

    if (actionResult.status === "fulfilled") {
      expect(actionResult.value).toEqual({ success: true });
    } else {
      // A rejected action must be the frozen lost-race Error, never a leaked
      // PrismaClientKnownRequestError / P2002.
      const reason = actionResult.reason;
      expect(reason).toBeInstanceOf(Error);
      expect((reason as Error).message).toBe(
        "This plan was already published or changed by someone else — refresh and try again."
      );
    }

    // At least one of the two must have gone through — the race may not eat
    // both publishes.
    expect(actionResult.status === "fulfilled" || restWon).toBe(true);

    // The real invariant, regardless of how the two transactions interleaved.
    const weekOf = await weekOfPlan(a);
    expect(await publishedCount(client.id, weekOf)).toBe(1);
    expect([await statusOf(a), await statusOf(b)].filter((s) => s === "PUBLISHED")).toHaveLength(1);

    // What each surface reported must match what the row actually shows: a
    // surface that reported success either still holds PUBLISHED or was
    // superseded by the other, and a surface that reported RACE_LOST must have
    // left its draft untouched (it must never have half-published).
    const expectedFor = (won: boolean) => (won ? ["PUBLISHED", "SUPERSEDED"] : ["DRAFT"]);
    expect(expectedFor(actionResult.status === "fulfilled")).toContain(await statusOf(a));
    expect(expectedFor(restWon)).toContain(await statusOf(b));
  });

  // ── Unchanged behavior ────────────────────────────────────────────────────

  it("first-ever publish for a week is unchanged — 200, PUBLISHED, publishedAt set, nothing superseded", async () => {
    const { client } = await fixture();
    const planId = await draft(client.id, "2026-03-02");

    const response = await publishViaRest(client.id, { mealPlanId: planId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("PUBLISHED");
    expect(plan.publishedAt).not.toBeNull();
    expect(await db.mealPlan.count({ where: { clientId: client.id, status: "SUPERSEDED" } })).toBe(0);
  });

  it("supersede is scoped to (clientId, weekOf) — publishing week B leaves week A published", async () => {
    const { client } = await fixture();
    const weekA = await draft(client.id, "2026-03-09");
    expect((await publishViaRest(client.id, { mealPlanId: weekA })).status).toBe(200);

    const weekB = await draft(client.id, "2026-03-16");
    expect((await publishViaRest(client.id, { mealPlanId: weekB })).status).toBe(200);

    expect(await statusOf(weekA)).toBe("PUBLISHED");
    expect(await statusOf(weekB)).toBe("PUBLISHED");
  });

  // ── Auth ladder / error ladder regression (REST) ──────────────────────────

  it("REST auth and validation ladder is unchanged", async () => {
    const { coach, client } = await fixture();

    // Unknown meal plan id → 404
    const unknown = await publishViaRest(client.id, { mealPlanId: randomUUID() });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Meal plan not found" });

    // Plan belonging to another client of the same coach → 403
    const otherClerkId = randomUUID();
    const otherClient = await db.user.create({ data: { clerkId: otherClerkId, email: `other-${otherClerkId}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: otherClient.id } });
    const othersPlan = await draft(otherClient.id, "2026-03-23");
    const mismatch = await publishViaRest(client.id, { mealPlanId: othersPlan });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ error: "Forbidden" });
    expect(await statusOf(othersPlan)).toBe("DRAFT");

    // Malformed body → 422
    const malformed = await publishViaRest(client.id, { mealPlanId: "" });
    expect(malformed.status).toBe(422);
    expect((await malformed.json()).error).toBe("Validation failed");

    // Already-PUBLISHED plan → 409 PLAN_NOT_DRAFT
    const planId = await draft(client.id, "2026-03-23");
    expect((await publishViaRest(client.id, { mealPlanId: planId })).status).toBe(200);
    const notDraft = await publishViaRest(client.id, { mealPlanId: planId });
    expect(notDraft.status).toBe(409);
    expect(await notDraft.json()).toEqual({ error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" });

    // A coach with no CoachClient row for this client → 403, no publish
    const strangerClerkId = randomUUID();
    const stranger = await db.user.create({ data: { clerkId: strangerClerkId, email: `stranger-${strangerClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const victimDraft = await draft(client.id, "2026-03-30");
    mocks.authUserId = stranger.clerkId;
    const forbidden = await publishViaRest(client.id, { mealPlanId: victimDraft });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });
    expect(await statusOf(victimDraft)).toBe("DRAFT");
  });

  // ── Notifications stay exactly where they are (T-666 owns changing them) ───

  it("REST notification behavior is unchanged — sent only when notifyClient is true", async () => {
    const { client } = await fixture();

    const silent = await draft(client.id, "2026-04-06");
    expect((await publishViaRest(client.id, { mealPlanId: silent })).status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.notifySms).not.toHaveBeenCalled();

    const loud = await draft(client.id, "2026-04-13");
    expect((await publishViaRest(client.id, { mealPlanId: loud, notifyClient: true })).status).toBe(200);
    await vi.waitFor(() => expect(mocks.notifySms).toHaveBeenCalledTimes(1));
    expect(mocks.notifySms.mock.calls[0][0]).toBe(client.id);
  });
});
