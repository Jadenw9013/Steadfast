import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-660 — the web Server Action and the iOS-facing REST route must publish a
 * meal plan identically: supersede the week's previous PUBLISHED plan, keep at
 * most one PUBLISHED row per (clientId, weekOf), and return a 409 (never a
 * 500) to whoever loses a concurrent publish race.
 *
 * T-102b adds the empty-plan guard to the same contract (the section marked
 * below): a plan with no content for its OWN `planMode` is rejected by the
 * shared service, so all three transports — action, REST route and the OCR
 * import route — reject identically. Every fixture in this file therefore
 * carries one item; see `FIXTURE_ITEM`.
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
// T-102b — the third publish transport, which inherits the same guard.
import { POST as importPlanRoute } from "@/app/api/mealplans/import-plan/route";
import {
  PUBLISHED_MEAL_PLAN_INDEX,
  isDuplicatePublishedPlanError,
  publishMealPlanTarget,
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

  /** T-102b — fixture content only. Every plan this file publishes needs at
   *  least one item now that `publishMealPlanTarget` rejects a MEAL_PLAN plan
   *  with zero items; this file's assertions are about supersede, races and the
   *  auth ladder, never about plan content, so the food itself means nothing. */
  const FIXTURE_ITEM = {
    mealName: "Meal 1",
    sortOrder: 0,
    foodName: "Fixture food",
    quantity: "1",
    unit: "serving",
    calories: 100,
    protein: 10,
    carbs: 10,
    fats: 1,
  };

  async function draft(clientId: string, weekStartDate: string) {
    const created = await createDraftMealPlan({ clientId, weekStartDate, items: [FIXTURE_ITEM] });
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

  // ── The lost-race rollback (T-745) ────────────────────────────────────────
  //
  // The supersede and the flip must share one fate. When the target stops being
  // a live DRAFT between the T-102b content read and the transaction, a
  // post-commit `flipped === 0` check reports RACE_LOST while the
  // already-committed supersede has demoted the week's live plan — the client
  // ends the request with ZERO published plans for that week and no surface
  // reports a fault. Both cases below fail against the pre-T-745 service.

  it("a publish target that vanishes after the empty-plan read rolls the supersede back instead of leaving zero PUBLISHED plans", async () => {
    const { client } = await fixture();
    const week = "2026-03-02";

    const v1 = await draft(client.id, week);
    expect((await publishViaRest(client.id, { mealPlanId: v1 })).status).toBe(200);
    expect(await statusOf(v1)).toBe("PUBLISHED");

    const vanishing = await draft(client.id, week);
    const weekOf = await weekOfPlan(v1);

    // The exact production interleaving: the service's own content read sees a
    // live, non-empty DRAFT (so it does not short-circuit at the `!content`
    // guard), and the row is deleted — children cascade — before the
    // transaction opens. One-shot, so only that read is intercepted.
    const realFindUnique = db.mealPlan.findUnique.bind(db.mealPlan);
    const spy = vi.spyOn(db.mealPlan, "findUnique");
    let result: Awaited<ReturnType<typeof publishMealPlanTarget>>;
    try {
      spy.mockImplementationOnce(((args: Parameters<typeof realFindUnique>[0]) =>
        (async () => {
          const content = await realFindUnique(args);
          await db.mealPlan.delete({ where: { id: vanishing } });
          return content;
        })()) as unknown as typeof db.mealPlan.findUnique);

      result = await publishMealPlanTarget({
        id: vanishing,
        clientId: client.id,
        weekOf,
        status: "DRAFT",
      });
    } finally {
      spy.mockRestore();
    }

    expect(result).toEqual({ ok: false, code: "RACE_LOST" });
    expect(await statusOf(v1)).toBe("PUBLISHED");
    expect(await publishedCount(client.id, weekOf)).toBe(1);
  });

  it("a stale DRAFT target whose row is no longer DRAFT rolls the supersede back", async () => {
    const { client } = await fixture();
    const week = "2026-03-09";

    const v1 = await draft(client.id, week);
    expect((await publishViaRest(client.id, { mealPlanId: v1 })).status).toBe(200);

    // Mock-free companion, and the guarantee the import route needs: it hands
    // the service a hand-constructed `status: "DRAFT"` literal it never read
    // back, so the service must be safe for ANY stale target.
    const stale = await draft(client.id, week);
    await db.mealPlan.update({ where: { id: stale }, data: { status: "SUPERSEDED" } });

    const weekOf = await weekOfPlan(v1);
    const result = await publishMealPlanTarget({
      id: stale,
      clientId: client.id,
      weekOf,
      status: "DRAFT",
    });

    expect(result).toEqual({ ok: false, code: "RACE_LOST" });
    expect(await statusOf(v1)).toBe("PUBLISHED");
    expect(await statusOf(stale)).toBe("SUPERSEDED");
    expect(await publishedCount(client.id, weekOf)).toBe(1);
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

  // ── T-102b — a plan with no content for its own planMode cannot be published ─

  const MEAL_PLAN_EMPTY_MESSAGE = "Add at least one food before publishing.";
  const MACROS_EMPTY_MESSAGE = "Add at least one meal with macro targets before publishing.";

  const MACRO_TARGET = { mealName: "Meal 1", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 };

  /** A MEAL_PLAN draft with zero items. `items: []` is explicit so carry-forward
   *  cannot resurrect a previous week's foods. */
  async function emptyFoodsDraft(clientId: string, weekStartDate: string) {
    const created = await createDraftMealPlan({ clientId, weekStartDate, items: [] });
    return created.mealPlanId;
  }

  it("the action rejects an empty MEAL_PLAN plan and leaves the row DRAFT", async () => {
    const { client } = await fixture();
    const planId = await emptyFoodsDraft(client.id, "2026-06-01");

    await expect(publishMealPlan({ mealPlanId: planId })).rejects.toThrow(MEAL_PLAN_EMPTY_MESSAGE);

    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("DRAFT");
    expect(plan.publishedAt).toBeNull();
    // No other row of this client's moved either.
    expect(await db.mealPlan.count({ where: { clientId: client.id, status: { not: "DRAFT" } } })).toBe(0);
  });

  it("the REST route rejects an empty MEAL_PLAN plan with 409 PLAN_EMPTY", async () => {
    const { client } = await fixture();
    const planId = await emptyFoodsDraft(client.id, "2026-06-08");

    const response = await publishViaRest(client.id, { mealPlanId: planId });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: MEAL_PLAN_EMPTY_MESSAGE, code: "PLAN_EMPTY" });

    expect(await statusOf(planId)).toBe("DRAFT");
  });

  it("rejects a MACROS plan with zero targets even when it carries foods forward", async () => {
    // The exact state the parent ticket found publishable: after T-101 a MACROS
    // draft carries the previous published week's `items`, so "some array is
    // non-empty" would let this through.
    const { client } = await fixture();
    const foodsWeek = await draft(client.id, "2026-06-15");
    expect((await publishViaRest(client.id, { mealPlanId: foodsWeek })).status).toBe(200);

    const macrosWeek = (
      await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: "2026-06-22",
        planMode: "MACROS",
      })
    ).mealPlanId;

    // Precondition: the carry-forward really did populate `items`.
    const carried = await db.mealPlan.findUniqueOrThrow({
      where: { id: macrosWeek },
      select: { planMode: true, _count: { select: { items: true, macroTargets: true } } },
    });
    expect(carried.planMode).toBe("MACROS");
    expect(carried._count.items).toBeGreaterThan(0);
    expect(carried._count.macroTargets).toBe(0);

    await expect(publishMealPlan({ mealPlanId: macrosWeek })).rejects.toThrow(MACROS_EMPTY_MESSAGE);

    const response = await publishViaRest(client.id, { mealPlanId: macrosWeek });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: MACROS_EMPTY_MESSAGE, code: "PLAN_EMPTY" });

    expect(await statusOf(macrosWeek)).toBe("DRAFT");
    // The previous week stays exactly as it was.
    expect(await statusOf(foodsWeek)).toBe("PUBLISHED");
  });

  it("accepts a MACROS plan with targets on both surfaces", async () => {
    const { client } = await fixture();

    const viaAction = (
      await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: "2026-06-29",
        planMode: "MACROS",
        macroTargets: [MACRO_TARGET],
      })
    ).mealPlanId;
    expect(await publishMealPlan({ mealPlanId: viaAction })).toEqual({ success: true });
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: viaAction } })).publishedAt).not.toBeNull();
    expect(await statusOf(viaAction)).toBe("PUBLISHED");

    const viaRest = (
      await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: "2026-07-06",
        planMode: "MACROS",
        macroTargets: [MACRO_TARGET],
      })
    ).mealPlanId;
    const response = await publishViaRest(client.id, { mealPlanId: viaRest });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await statusOf(viaRest)).toBe("PUBLISHED");
  });

  it("accepts a MEAL_PLAN plan with items on both surfaces", async () => {
    const { client } = await fixture();

    const viaAction = await draft(client.id, "2026-07-13");
    expect(await publishMealPlan({ mealPlanId: viaAction })).toEqual({ success: true });
    expect(await statusOf(viaAction)).toBe("PUBLISHED");

    const viaRest = await draft(client.id, "2026-07-20");
    const response = await publishViaRest(client.id, { mealPlanId: viaRest });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: viaRest } });
    expect(plan.status).toBe("PUBLISHED");
    expect(plan.publishedAt).not.toBeNull();
  });

  it("NOT_DRAFT wins over EMPTY_PLAN — re-publishing still reports PLAN_NOT_DRAFT", async () => {
    // Check order is load-bearing: NOT_DRAFT is decided off the passed target
    // before the content read runs.
    const { client } = await fixture();
    const planId = await draft(client.id, "2026-07-27");
    expect((await publishViaRest(client.id, { mealPlanId: planId })).status).toBe(200);

    // Empty the published row's content so the only thing keeping this from
    // being an EMPTY_PLAN is the check order.
    await db.mealPlanItem.deleteMany({ where: { mealPlanId: planId } });

    const response = await publishViaRest(client.id, { mealPlanId: planId });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" });

    await expect(publishMealPlan({ mealPlanId: planId })).rejects.toThrow("Can only publish drafts");
  });

  it("the action and the REST route reject the same input identically and write nothing", async () => {
    const { client } = await fixture();
    const planId = await emptyFoodsDraft(client.id, "2026-08-03");

    const before = await db.mealPlan.findUniqueOrThrow({
      where: { id: planId },
      select: { status: true, publishedAt: true, updatedAt: true, version: true },
    });

    let actionMessage = "";
    try {
      await publishMealPlan({ mealPlanId: planId });
    } catch (err) {
      actionMessage = (err as Error).message;
    }

    const response = await publishViaRest(client.id, { mealPlanId: planId });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(actionMessage).toBe(MEAL_PLAN_EMPTY_MESSAGE);
    expect(body.error).toBe(actionMessage);
    expect(body.code).toBe("PLAN_EMPTY");

    expect(
      await db.mealPlan.findUniqueOrThrow({
        where: { id: planId },
        select: { status: true, publishedAt: true, updatedAt: true, version: true },
      })
    ).toEqual(before);
    expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(1);
  });

  it("the import route maps EMPTY_PLAN and leaves the upload retryable (T-730)", async () => {
    const { coach, client } = await fixture();

    // A parsed document with no meals: the import builds a MEAL_PLAN draft with
    // zero items, which the shared guard now rejects.
    const upload = await db.mealPlanUpload.create({
      data: {
        coachId: coach.id,
        clientId: client.id,
        storagePath: `meal-plan-uploads/${randomUUID()}.pdf`,
        status: "NEEDS_REVIEW",
      },
    });
    const importDraft = await db.mealPlanDraft.create({
      data: {
        uploadId: upload.id,
        parsedJson: { title: "Guidance only", meals: [], supportContent: "Hydration: 3L/day" },
      },
    });

    const response = await importPlanRoute(
      new NextRequest("https://example.test/api/mealplans/import-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: importDraft.id, publish: true }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: MEAL_PLAN_EMPTY_MESSAGE, code: "PLAN_EMPTY" });

    // "Return BEFORE the bookkeeping writes" — a rejected publish must not
    // strand the import behind the "Already imported" 400.
    expect((await db.mealPlanUpload.findUniqueOrThrow({ where: { id: upload.id } })).status).toBe(
      "NEEDS_REVIEW"
    );
    expect(await db.mealPlan.count({ where: { clientId: client.id, status: "PUBLISHED" } })).toBe(0);

    // By design the just-created DRAFT stays (deleting it would add a
    // compensating write with its own failure mode) — the same accepted T-730
    // behavior asserted in meal-plan-import-race-mapping.test.ts. T-102b only
    // makes this path reachable deterministically (any zero-meal OCR result)
    // instead of only through a genuine publish race. Nothing is published.
    const plans = await db.mealPlan.findMany({ where: { clientId: client.id } });
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe("DRAFT");
    expect(plans[0].publishedAt).toBeNull();
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
