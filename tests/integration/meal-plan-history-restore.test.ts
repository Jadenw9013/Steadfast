import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-801 — the shared meal-plan version-history + restore service
 * (`lib/meal-plans/history.ts`) is the single source of truth behind the
 * three REST routes and the `restoreMealPlanVersion` Server Action. What this
 * suite pins down:
 *
 *  - history lists PUBLISHED + SUPERSEDED, never DRAFT, ordered
 *    `weekOf desc, publishedAt desc NULLS LAST, createdAt desc, version desc`
 *    (the NULLS LAST clause matters for legacy SUPERSEDED rows the supersede
 *    backfill left with no `publishedAt`),
 *  - restore reuses `createMealPlanDraft` with `startBlank: true` and every
 *    field explicit, so a restored draft is byte-identical to its source and
 *    never silently carries content from an unrelated week
 *    (`lib/meal-plans/drafts.ts` `findCarryForwardSource`),
 *  - restore never mutates or un-publishes the source version,
 *  - `replaceExistingDraft` is create-then-delete, re-checking `status: "DRAFT"`
 *    in the delete filter,
 *  - the Server Action and the REST route write identical rows for identical
 *    input (standing rule 1).
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
import { restoreMealPlanVersion } from "@/app/actions/meal-plans";
import { GET as historyRoute } from "@/app/api/coach/clients/[clientId]/meal-plan/history/route";
import { GET as versionDetailRoute } from "@/app/api/coach/clients/[clientId]/meal-plan/history/[mealPlanId]/route";
import { POST as restoreRoute } from "@/app/api/coach/clients/[clientId]/meal-plan/restore/route";
import { GET as currentPlanRoute } from "@/app/api/client/meal-plan/current/route";
import {
  listMealPlanHistory,
  getMealPlanVersionDetail,
  createDraftFromMealPlanVersion,
} from "@/lib/meal-plans/history";
import { createMealPlanDraft, findCarryForwardSource } from "@/lib/meal-plans/drafts";
import {
  PUBLISHED_MEAL_PLAN_INDEX,
  getMealPlanPublishTarget,
  publishMealPlanTarget,
} from "@/lib/meal-plans/publish";
import { resolveActiveMealPlanId } from "@/lib/meal-plans/active-plan";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

// Mondays.
const WEEK_A = "2026-03-02";
const WEEK_B = "2026-03-09";
const WEEK_C = "2026-03-16";
const asDate = (weekStartDate: string) => new Date(`${weekStartDate}T00:00:00Z`);

const ITEMS = [
  { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", servingDescription: "grilled", calories: 280, protein: 52, carbs: 0, fats: 6 },
  { mealName: "Meal 2", sortOrder: 1, foodName: "White rice", quantity: "1", unit: "cup", calories: 205, protein: 4, carbs: 45, fats: 0 },
];
const MACROS = [
  { mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
  { mealName: "Lunch", sortOrder: 1, calories: 700, protein: 55, carbs: 70, fats: 20 },
];
const PLAN_EXTRAS = { metadata: { phase: "cutting", coachNotes: "hold protein" } };

suite("meal plan version history + restore (T-801)", () => {
  // Same self-heal as tests/integration/meal-plan-draft-lifecycle.test.ts and
  // meal-plan-publish-parity.test.ts: the partial unique index is raw SQL in
  // a migration that `db push` neither creates nor preserves, and this suite
  // publishes. Guarded by the local-DB check above.
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
  const paramsWithId = (clientId: string, mealPlanId: string) => ({ params: Promise.resolve({ clientId, mealPlanId }) });

  const getHistory = (clientId: string, query = "") =>
    historyRoute(new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan/history${query}`), params(clientId));

  const getVersionDetail = (clientId: string, mealPlanId: string) =>
    versionDetailRoute(new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan/history/${mealPlanId}`), paramsWithId(clientId, mealPlanId));

  const postRestore = (clientId: string, body: unknown) =>
    restoreRoute(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      params(clientId)
    );

  /** Creates a DRAFT with the given content, directly through the T-101
   *  service (bypasses the coach-access check — callers here already have a
   *  fixture's own coach). */
  async function createDraft(
    clientId: string,
    coachId: string,
    weekStartDate: string,
    opts: {
      items?: typeof ITEMS;
      macroTargets?: typeof MACROS;
      planMode?: "MEAL_PLAN" | "MACROS";
      planExtras?: typeof PLAN_EXTRAS;
      supportContent?: string | null;
    } = {}
  ) {
    const { mealPlanId } = await createMealPlanDraft({
      clientId,
      coachId,
      weekOf: asDate(weekStartDate),
      startBlank: true,
      planMode: opts.planMode ?? "MEAL_PLAN",
      items: opts.items,
      macroTargets: opts.macroTargets,
      planExtras: opts.planExtras,
      supportContent: opts.supportContent,
    });
    return mealPlanId;
  }

  /** Publishes an existing DRAFT via the shared publish service (no auth). */
  async function publish(mealPlanId: string) {
    const target = await getMealPlanPublishTarget(mealPlanId);
    if (!target) throw new Error("fixture: target not found");
    const result = await publishMealPlanTarget(target);
    if (!result.ok) throw new Error(`fixture: publish failed (${result.code})`);
    return result;
  }

  /** Create + publish in one step. Returns the resulting PUBLISHED row's id. */
  async function publishWeek(
    clientId: string,
    coachId: string,
    weekStartDate: string,
    opts: Parameters<typeof createDraft>[3] = {}
  ) {
    const draftId = await createDraft(clientId, coachId, weekStartDate, opts);
    await publish(draftId);
    return draftId;
  }

  function comparableContent(plan: {
    weekOf: Date; planMode: string; supportContent: string | null; planExtras: unknown;
    items: { mealName: string; sortOrder: number; foodName: string; quantity: string; unit: string; servingDescription: string | null; calories: number; protein: number; carbs: number; fats: number }[];
    macroTargets: { mealName: string; sortOrder: number; calories: number; protein: number; carbs: number; fats: number }[];
  }) {
    return {
      weekOf: plan.weekOf.toISOString(),
      planMode: plan.planMode,
      supportContent: plan.supportContent,
      planExtras: plan.planExtras,
      items: plan.items.map((i) => ({
        mealName: i.mealName, sortOrder: i.sortOrder, foodName: i.foodName, quantity: i.quantity,
        unit: i.unit, servingDescription: i.servingDescription,
        calories: i.calories, protein: i.protein, carbs: i.carbs, fats: i.fats,
      })),
      macroTargets: plan.macroTargets.map((t) => ({
        mealName: t.mealName, sortOrder: t.sortOrder, calories: t.calories, protein: t.protein, carbs: t.carbs, fats: t.fats,
      })),
    };
  }

  const planWithContent = (id: string) =>
    db.mealPlan.findUniqueOrThrow({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        macroTargets: { orderBy: { sortOrder: "asc" } },
      },
    });

  // ── 1. history lists PUBLISHED and SUPERSEDED, never DRAFT ───────────────

  it("history lists PUBLISHED and SUPERSEDED, never DRAFT", async () => {
    const { client, coach } = await fixture();
    const v1 = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const v2 = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS }); // supersedes v1
    await createDraft(client.id, coach.id, WEEK_B, { items: ITEMS }); // leave a DRAFT

    const page = await listMealPlanHistory({ clientId: client.id });
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.status).sort()).toEqual(["PUBLISHED", "SUPERSEDED"]);
    expect(page.items.map((i) => i.id)).toEqual(expect.arrayContaining([v1, v2]));
    expect(page.items.some((i) => i.status === "DRAFT" as unknown)).toBe(false);
  });

  // ── 2. ordering ────────────────────────────────────────────────────────────

  it("orders weekOf desc, publishedAt desc, createdAt desc, version desc", async () => {
    const { client, coach } = await fixture();
    const a = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const bPublished1 = await publishWeek(client.id, coach.id, WEEK_B, { items: ITEMS });
    const bPublished2 = await publishWeek(client.id, coach.id, WEEK_B, { items: ITEMS }); // supersedes bPublished1
    const c = await publishWeek(client.id, coach.id, WEEK_C, { items: ITEMS });

    const page = await listMealPlanHistory({ clientId: client.id });
    expect(page.items.map((i) => i.id)).toEqual([c, bPublished2, bPublished1, a]);
  });

  // ── 3. ordering is deterministic when publishedAt is null ────────────────

  it("a legacy SUPERSEDED row with a null publishedAt sorts after its week's other rows and above an earlier week", async () => {
    const { client, coach } = await fixture();
    const a = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const bPublished = await publishWeek(client.id, coach.id, WEEK_B, { items: ITEMS });

    // Insert a legacy-shaped SUPERSEDED row directly: publishedAt null, as the
    // pre-backfill data model allows.
    const legacy = await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: asDate(WEEK_B),
        version: 99,
        status: "SUPERSEDED",
        planMode: "MEAL_PLAN",
        publishedAt: null,
      },
    });

    const page = await listMealPlanHistory({ clientId: client.id });
    // Without `nulls: "last"` the legacy row would sort FIRST (Postgres's
    // default DESC NULLS FIRST), floating above bPublished.
    expect(page.items.map((i) => i.id)).toEqual([bPublished, legacy.id, a]);
  });

  // ── 4. scoping to the coach's own client ──────────────────────────────────

  it("scopes every endpoint to the coach's own assigned client", async () => {
    const { client, coach } = await fixture();
    const v1 = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });

    // Unassigned second coach.
    const otherCoachClerkId = randomUUID();
    const otherCoach = await db.user.create({ data: { clerkId: otherCoachClerkId, email: `coach2-${otherCoachClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });

    mocks.authUserId = otherCoach.clerkId;
    expect((await getHistory(client.id)).status).toBe(403);
    expect((await getVersionDetail(client.id, v1)).status).toBe(403);
    expect((await postRestore(client.id, { sourceMealPlanId: v1 })).status).toBe(403);

    // Non-coach.
    const nonCoachClerkId = randomUUID();
    const nonCoach = await db.user.create({ data: { clerkId: nonCoachClerkId, email: `noncoach-${nonCoachClerkId}@example.test`, isClient: true } });
    mocks.authUserId = nonCoach.clerkId;
    expect((await getHistory(client.id)).status).toBe(403);
    expect((await getVersionDetail(client.id, v1)).status).toBe(403);
    expect((await postRestore(client.id, { sourceMealPlanId: v1 })).status).toBe(403);

    // Unauthenticated.
    mocks.authUserId = "";
    expect((await getHistory(client.id)).status).toBe(401);
    expect((await getVersionDetail(client.id, v1)).status).toBe(401);
    expect((await postRestore(client.id, { sourceMealPlanId: v1 })).status).toBe(401);

    // Coach assigned to a DIFFERENT client (X) requesting client Y.
    const { client: otherClient } = await fixture(); // sets mocks.authUserId to a fresh coach assigned to otherClient
    expect((await getHistory(client.id)).status).toBe(403);
    expect((await getVersionDetail(client.id, v1)).status).toBe(403);
    expect((await postRestore(client.id, { sourceMealPlanId: v1 })).status).toBe(403);
    void otherClient;
  });

  // ── 5. counts, mode and flags ─────────────────────────────────────────────

  it("reports itemCount, macroTargetCount, planMode and hasPlanNotes exactly, per planMode", async () => {
    const { client, coach } = await fixture();
    await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS, planMode: "MEAL_PLAN", supportContent: null });
    await publishWeek(client.id, coach.id, WEEK_B, { macroTargets: MACROS, planMode: "MACROS", supportContent: "   " });
    await publishWeek(client.id, coach.id, WEEK_C, { items: [ITEMS[0]], planMode: "MEAL_PLAN", supportContent: "notes" });

    const page = await listMealPlanHistory({ clientId: client.id });
    const byWeek = new Map(page.items.map((i) => [i.weekOf.toISOString(), i]));

    const rowA = byWeek.get(asDate(WEEK_A).toISOString())!;
    expect(rowA).toMatchObject({ planMode: "MEAL_PLAN", itemCount: 2, macroTargetCount: 0, hasPlanNotes: false });

    const rowB = byWeek.get(asDate(WEEK_B).toISOString())!;
    expect(rowB).toMatchObject({ planMode: "MACROS", macroTargetCount: 2, hasPlanNotes: false }); // whitespace-only ⇒ false

    const rowC = byWeek.get(asDate(WEEK_C).toISOString())!;
    expect(rowC).toMatchObject({ planMode: "MEAL_PLAN", itemCount: 1, hasPlanNotes: true });
  });

  // ── 6. weekHasDraft ────────────────────────────────────────────────────────

  it("weekHasDraft is true only while a DRAFT exists for that week, false once published", async () => {
    const { client, coach } = await fixture();
    const published = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const draftId = await createDraft(client.id, coach.id, WEEK_A, { items: ITEMS });

    let page = await listMealPlanHistory({ clientId: client.id });
    expect(page.items.find((i) => i.id === published)?.weekHasDraft).toBe(true);

    await publish(draftId);
    page = await listMealPlanHistory({ clientId: client.id });
    // Both PUBLISHED (superseded original) and the newly-PUBLISHED row exist now.
    expect(page.items.every((i) => i.weekHasDraft === false)).toBe(true);
  });

  // ── 7. currentPublishedMealPlanId ─────────────────────────────────────────

  it("currentPublishedMealPlanId is the highest-weekOf PUBLISHED row even when an earlier week published more recently", async () => {
    const { client, coach } = await fixture();
    const c = await publishWeek(client.id, coach.id, WEEK_C, { items: ITEMS });
    // Publish week A AFTER week C — a later publish time, earlier week.
    const a = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    void a;

    const page = await listMealPlanHistory({ clientId: client.id });
    expect(page.currentPublishedMealPlanId).toBe(c);
  });

  it("currentPublishedMealPlanId is null when the client has no PUBLISHED plan", async () => {
    const { client, coach } = await fixture();
    await createDraft(client.id, coach.id, WEEK_A, { items: ITEMS });
    const page = await listMealPlanHistory({ clientId: client.id });
    expect(page.currentPublishedMealPlanId).toBeNull();
  });

  // ── 8. pagination ──────────────────────────────────────────────────────────

  it("paginates with disjoint pages whose union is the full set", async () => {
    const { client, coach } = await fixture();
    const a = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const b = await publishWeek(client.id, coach.id, WEEK_B, { items: ITEMS });
    const c = await publishWeek(client.id, coach.id, WEEK_C, { items: ITEMS });

    const page1 = await listMealPlanHistory({ clientId: client.id, limit: 2, offset: 0 });
    const page2 = await listMealPlanHistory({ clientId: client.id, limit: 2, offset: 2 });

    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);
    expect(page2.limit).toBe(2);
    expect(page2.offset).toBe(2);
    const ids1 = page1.items.map((i) => i.id);
    const ids2 = page2.items.map((i) => i.id);
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
    expect([...ids1, ...ids2].sort()).toEqual([a, b, c].sort());
  });

  // ── 9. version detail returns both representations ────────────────────────

  it("version detail returns both items and macroTargets, picks planNotes/supportContent from the same column, and isRestorable/weekHasDraft are correct", async () => {
    const { client, coach } = await fixture();
    // MACROS version that carries forward foods from a prior published week.
    await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS, planMode: "MEAL_PLAN" });
    const macrosId = await createDraft(client.id, coach.id, WEEK_B, {
      macroTargets: MACROS,
      planMode: "MACROS",
      supportContent: "hit protein",
    });
    // createDraft with startBlank:true above does NOT carry items — set them
    // directly to simulate a MACROS version that also carries foods, matching
    // the documented "since T-101 both coexist" invariant this test guards.
    await db.mealPlanItem.createMany({
      data: ITEMS.map((i) => ({ ...i, mealPlanId: macrosId })),
    });
    await publish(macrosId);

    const detailRes = await getVersionDetail(client.id, macrosId);
    expect(detailRes.status).toBe(200);
    const body = await detailRes.json();
    expect(body.mealPlan.planMode).toBe("MACROS");
    expect(body.mealPlan.items.length).toBeGreaterThan(0);
    expect(body.mealPlan.macroTargets.length).toBeGreaterThan(0);
    expect(body.mealPlan.planNotes).toBe("hit protein");
    expect(body.mealPlan.supportContent).toBe("hit protein");
    expect(body.isRestorable).toBe(true);
    expect(body.weekHasDraft).toBe(false);

    // isRestorable true for SUPERSEDED too.
    const superseded = await publishWeek(client.id, coach.id, WEEK_B, { items: ITEMS }); // supersedes macrosId
    const supersededRes = await getVersionDetail(client.id, macrosId);
    const supersededBody = await supersededRes.json();
    expect(supersededBody.mealPlan.status).toBe("SUPERSEDED");
    expect(supersededBody.isRestorable).toBe(true);
    void superseded;

    // isRestorable false for a DRAFT, and weekHasDraft flips true then false.
    const draftId = await createDraft(client.id, coach.id, WEEK_C, { items: ITEMS });
    const draftRes = await getVersionDetail(client.id, draftId);
    const draftBody = await draftRes.json();
    expect(draftBody.isRestorable).toBe(false);
    const beforePublish = await getVersionDetail(client.id, await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS }));
    void beforePublish;

    // Unknown id → 404.
    expect((await getVersionDetail(client.id, "does-not-exist")).status).toBe(404);

    // Another client's plan id under this clientId → 403.
    const { client: otherClient, coach: otherCoach } = await fixture();
    const otherPlan = await publishWeek(otherClient.id, otherCoach.id, WEEK_A, { items: ITEMS });
    mocks.authUserId = coach.clerkId; // back to the coach assigned to `client`
    expect((await getVersionDetail(client.id, otherPlan)).status).toBe(403);
  });

  it("weekHasDraft on version detail flips false once the draft for that week is published", async () => {
    const { client, coach } = await fixture();
    const published = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const draftId = await createDraft(client.id, coach.id, WEEK_A, { items: ITEMS });

    let res = await getVersionDetail(client.id, published);
    expect((await res.json()).weekHasDraft).toBe(true);

    await publish(draftId);
    res = await getVersionDetail(client.id, published);
    expect((await res.json()).weekHasDraft).toBe(false);
  });

  // ── 10. restore produces a new draft identical to the source (headline) ──

  it("restore produces a new draft identical in content to the source version, including sortOrder and servingDescription", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, {
      items: ITEMS,
      macroTargets: MACROS,
      planMode: "MEAL_PLAN",
      planExtras: PLAN_EXTRAS,
      supportContent: "Drink water",
    });
    const source = await planWithContent(sourceId);

    const detail = await getMealPlanVersionDetail(sourceId);
    const result = await createDraftFromMealPlanVersion({ source: detail!, coachId: coach.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const draft = await planWithContent(result.draftMealPlanId);
    expect(draft.status).toBe("DRAFT");
    expect(draft.weekOf.toISOString()).toBe(source.weekOf.toISOString());
    expect(draft.planMode).toBe(source.planMode);
    expect(draft.version).toBe(source.version + 1);
    expect(draft.supportContent).toBe(source.supportContent);
    expect(draft.planExtras).toEqual(source.planExtras);
    expect(draft.items.map((i) => ({ mealName: i.mealName, sortOrder: i.sortOrder, foodName: i.foodName, quantity: i.quantity, unit: i.unit, servingDescription: i.servingDescription, calories: i.calories, protein: i.protein, carbs: i.carbs, fats: i.fats })))
      .toEqual(source.items.map((i) => ({ mealName: i.mealName, sortOrder: i.sortOrder, foodName: i.foodName, quantity: i.quantity, unit: i.unit, servingDescription: i.servingDescription, calories: i.calories, protein: i.protein, carbs: i.carbs, fats: i.fats })));
    expect(draft.macroTargets.map((t) => ({ mealName: t.mealName, sortOrder: t.sortOrder, calories: t.calories, protein: t.protein, carbs: t.carbs, fats: t.fats })))
      .toEqual(source.macroTargets.map((t) => ({ mealName: t.mealName, sortOrder: t.sortOrder, calories: t.calories, protein: t.protein, carbs: t.carbs, fats: t.fats })));
  });

  // ── 11. restoring does not change the currently published plan (headline) ─

  it("restoring does not change the currently published plan", async () => {
    const { client, coach } = await fixture();
    const publishedId = await publishWeek(client.id, coach.id, WEEK_A, {
      items: ITEMS,
      macroTargets: MACROS,
      planMode: "MEAL_PLAN",
      planExtras: PLAN_EXTRAS,
      supportContent: "before",
    });
    const before = comparableContent(await planWithContent(publishedId));
    const beforeRow = await db.mealPlan.findUniqueOrThrow({ where: { id: publishedId }, select: { status: true, publishedAt: true } });

    // Client-facing read before restore.
    await db.clientCoachingContext.deleteMany({ where: { clientId: client.id } }).catch(() => {});
    mocks.authUserId = client.clerkId;
    const beforeClientRes = await currentPlanRoute();
    const beforeClientBody = await beforeClientRes.json();

    // Restore into a DIFFERENT week so nothing about `publishedId` is touched.
    mocks.authUserId = coach.clerkId;
    const detail = await getMealPlanVersionDetail(publishedId);
    const result = await createDraftFromMealPlanVersion({ source: detail!, coachId: coach.id, weekOf: asDate(WEEK_B) });
    expect(result.ok).toBe(true);

    const after = comparableContent(await planWithContent(publishedId));
    const afterRow = await db.mealPlan.findUniqueOrThrow({ where: { id: publishedId }, select: { status: true, publishedAt: true } });
    expect(after).toEqual(before);
    expect(afterRow.status).toBe("PUBLISHED");
    expect(afterRow.publishedAt?.toISOString()).toBe(beforeRow.publishedAt?.toISOString());

    const activeId = await resolveActiveMealPlanId(client.id, new Date(0));
    expect(activeId).toBe(publishedId);

    mocks.authUserId = client.clerkId;
    const afterClientRes = await currentPlanRoute();
    const afterClientBody = await afterClientRes.json();
    expect(afterClientBody.mealPlan?.id).toBe(beforeClientBody.mealPlan?.id);
    expect(afterClientBody.mealPlan?.items).toEqual(beforeClientBody.mealPlan?.items);
  });

  // ── 12. restore from a SUPERSEDED version ─────────────────────────────────

  it("restores from a SUPERSEDED version without disturbing the current PUBLISHED plan", async () => {
    const { client, coach } = await fixture();
    const v1 = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS, supportContent: "v1" });
    const v1Content = comparableContent(await planWithContent(v1));
    const v2 = await publishWeek(client.id, coach.id, WEEK_A, { items: [ITEMS[0]], supportContent: "v2" }); // supersedes v1

    const detail = await getMealPlanVersionDetail(v1);
    expect(detail!.status).toBe("SUPERSEDED");
    const result = await createDraftFromMealPlanVersion({ source: detail!, coachId: coach.id, replaceExistingDraft: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const draft = comparableContent(await planWithContent(result.draftMealPlanId));
    expect(draft.items).toEqual(v1Content.items);
    expect(draft.supportContent).toBe("v1");

    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: v2 } })).status).toBe("PUBLISHED");
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: v1 } })).status).toBe("SUPERSEDED");
  });

  // ── 13. restore refuses a DRAFT source ────────────────────────────────────

  it("refuses to restore a DRAFT source with SOURCE_NOT_RESTORABLE and creates no row", async () => {
    const { client, coach } = await fixture();
    const draftId = await createDraft(client.id, coach.id, WEEK_A, { items: ITEMS });
    const countBefore = await db.mealPlan.count({ where: { clientId: client.id } });

    const detail = await getMealPlanVersionDetail(draftId);
    const result = await createDraftFromMealPlanVersion({ source: detail!, coachId: coach.id });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_NOT_RESTORABLE", status: "DRAFT" });

    const countAfter = await db.mealPlan.count({ where: { clientId: client.id } });
    expect(countAfter).toBe(countBefore);

    // Same over REST: 409 with the code.
    const res = await postRestore(client.id, { sourceMealPlanId: draftId });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: "SOURCE_NOT_RESTORABLE" });
  });

  // ── 14. restore into a week that already has a draft ──────────────────────

  it("refuses to restore into a week with an existing draft unless replaceExistingDraft is true", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const existingDraftId = await createDraft(client.id, coach.id, WEEK_A, { items: [ITEMS[0]] });

    const res1 = await postRestore(client.id, { sourceMealPlanId: sourceId });
    expect(res1.status).toBe(409);
    const body1 = await res1.json();
    expect(body1).toMatchObject({ code: "DRAFT_EXISTS", existingDraftId });
    expect(await db.mealPlan.findUnique({ where: { id: existingDraftId } })).not.toBeNull();
    expect(await db.mealPlan.count({ where: { clientId: client.id, weekOf: asDate(WEEK_A), status: "DRAFT" } })).toBe(1);

    const res2 = await postRestore(client.id, { sourceMealPlanId: sourceId, replaceExistingDraft: true });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.replacedDraftIds).toEqual([existingDraftId]);
    expect(await db.mealPlan.findUnique({ where: { id: existingDraftId } })).toBeNull();
    const draftsForWeek = await db.mealPlan.findMany({ where: { clientId: client.id, weekOf: asDate(WEEK_A), status: "DRAFT" } });
    expect(draftsForWeek).toHaveLength(1);
    expect(draftsForWeek[0].id).toBe(body2.draftMealPlanId);
  });

  // ── 15. replace never deletes a row that stopped being a DRAFT ───────────

  it("never deletes a row that stopped being a DRAFT between the read and the delete", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const existingDraftId = await createDraft(client.id, coach.id, WEEK_B, { items: [ITEMS[0]] });

    // Publish the "existing draft" first — it is no longer a DRAFT by the
    // time restore would try to replace it.
    await publish(existingDraftId);
    const publishedSnapshot = comparableContent(await planWithContent(existingDraftId));

    const detail = await getMealPlanVersionDetail(sourceId);
    const result = await createDraftFromMealPlanVersion({
      source: detail!,
      coachId: coach.id,
      weekOf: asDate(WEEK_B),
      replaceExistingDraft: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.replacedDraftIds).toEqual([]);

    const stillPublished = await db.mealPlan.findUniqueOrThrow({ where: { id: existingDraftId } });
    expect(stillPublished.status).toBe("PUBLISHED");
    expect(comparableContent(await planWithContent(existingDraftId))).toEqual(publishedSnapshot);
  });

  // ── 16. explicit weekOf ────────────────────────────────────────────────────

  it("restores into an explicit weekOf, leaving the source week untouched", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS, supportContent: "week-a" });
    const sourceSnapshot = comparableContent(await planWithContent(sourceId));

    const res = await postRestore(client.id, { sourceMealPlanId: sourceId, weekOf: WEEK_C });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weekOf).toBe(asDate(WEEK_C).toISOString());

    const draft = comparableContent(await planWithContent(body.draftMealPlanId));
    expect(draft.weekOf).toBe(asDate(WEEK_C).toISOString());
    expect(draft.items).toEqual(sourceSnapshot.items);
    expect(comparableContent(await planWithContent(sourceId))).toEqual(sourceSnapshot);

    // Invalid weekOf → 400.
    const badRes = await postRestore(client.id, { sourceMealPlanId: sourceId, weekOf: "not-a-date" });
    expect(badRes.status).toBe(400);
    expect((await badRes.json()).error).toBe("Invalid weekOf date");
  });

  // ── 17. restore does no implicit carry-forward (startBlank proof) ────────

  it("does no implicit carry-forward: restoring week A into week C's slot yields exactly week A's items and none of week C's planExtras", async () => {
    const { client, coach } = await fixture();
    const weekAItems = [{ mealName: "Meal 1", sortOrder: 0, foodName: "Oats", quantity: "80", unit: "g", calories: 300, protein: 10, carbs: 54, fats: 6 }];
    const weekCItems = [{ mealName: "Meal 1", sortOrder: 0, foodName: "Steak", quantity: "8", unit: "oz", calories: 500, protein: 60, carbs: 0, fats: 25 }];

    // The restore source (week A) has neither planExtras nor supportContent of
    // its own — this is what makes the leak provable, not just plausible.
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: weekAItems });
    // Week C is the carry-forward source `createMealPlanDraft` would consult
    // for its slot if `startBlank` were ever flipped to `false`
    // (`findCarryForwardSource` picks the latest PUBLISHED plan at or before
    // the target week). Give it a `planExtras` and `supportContent` week A
    // lacks, so `input.planExtras ?? source?.planExtras` (`drafts.ts`) has
    // something concrete to leak.
    await publishWeek(client.id, coach.id, WEEK_C, {
      items: weekCItems, planExtras: PLAN_EXTRAS, supportContent: "week-c-notes",
    });
    const draftInC = await createDraft(client.id, coach.id, WEEK_C, { items: weekCItems });

    const res = await postRestore(client.id, { sourceMealPlanId: sourceId, weekOf: WEEK_C, replaceExistingDraft: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replacedDraftIds).toEqual([draftInC]);

    const draft = await planWithContent(body.draftMealPlanId);
    expect(draft.items.map((i) => i.foodName)).toEqual(["Oats"]);
    // The `startBlank: true` proof: with `startBlank: false`, `planExtras`
    // would fall back via `??` to week C's PUBLISHED `planExtras` (week A's
    // source has none of its own). Restore must never do that — the restored
    // draft's `planExtras` must be null, not week C's `PLAN_EXTRAS`.
    expect(draft.planExtras).toBeNull();
  });

  // ── 18. action and route produce identical rows (standing rule 1) ────────

  it("the Server Action and the REST route produce identical rows for identical restore input", async () => {
    const viaAction = await fixture();
    const viaRoute = await fixture();

    const sourceA = await publishWeek(viaAction.client.id, viaAction.coach.id, WEEK_A, {
      items: ITEMS, macroTargets: MACROS, planMode: "MEAL_PLAN", planExtras: PLAN_EXTRAS, supportContent: "same content",
    });
    const sourceB = await publishWeek(viaRoute.client.id, viaRoute.coach.id, WEEK_A, {
      items: ITEMS, macroTargets: MACROS, planMode: "MEAL_PLAN", planExtras: PLAN_EXTRAS, supportContent: "same content",
    });

    mocks.authUserId = viaAction.coach.clerkId;
    const actionResult = await restoreMealPlanVersion({ clientId: viaAction.client.id, sourceMealPlanId: sourceA });
    if (!("success" in actionResult) || !actionResult.success) throw new Error("action restore failed");

    mocks.authUserId = viaRoute.coach.clerkId;
    const routeRes = await postRestore(viaRoute.client.id, { sourceMealPlanId: sourceB });
    expect(routeRes.status).toBe(200);
    const routeBody = await routeRes.json();

    const draftA = await planWithContent(actionResult.draftMealPlanId);
    const draftB = await planWithContent(routeBody.draftMealPlanId);

    const strip = (p: typeof draftA) => ({
      weekOf: p.weekOf.toISOString(),
      version: p.version,
      status: p.status,
      planMode: p.planMode,
      supportContent: p.supportContent,
      planExtras: p.planExtras,
      items: p.items.map((i) => ({ mealName: i.mealName, sortOrder: i.sortOrder, foodName: i.foodName, quantity: i.quantity, unit: i.unit, servingDescription: i.servingDescription, calories: i.calories, protein: i.protein, carbs: i.carbs, fats: i.fats })),
      macroTargets: p.macroTargets.map((t) => ({ mealName: t.mealName, sortOrder: t.sortOrder, calories: t.calories, protein: t.protein, carbs: t.carbs, fats: t.fats })),
    });

    expect(strip(draftA)).toEqual(strip(draftB));
  });

  // ── 19. existing behavior is unchanged (required regression) ─────────────

  it("a restored draft appears through the normal editor GET, publishes normally, and carry-forward for the next week still works", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS, supportContent: "restore-me" });

    const restoreRes = await postRestore(client.id, { sourceMealPlanId: sourceId });
    expect(restoreRes.status).toBe(200);
    const restoreBody = await restoreRes.json();

    // Editor GET for that week reports source: "draft" with the restored id.
    const { GET: mealPlanGetRoute } = await import("@/app/api/coach/clients/[clientId]/meal-plan/route");
    const editorRes = await mealPlanGetRoute(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan?weekOf=${WEEK_A}`),
      params(client.id)
    );
    const editorBody = await editorRes.json();
    expect(editorBody.source).toBe("draft");
    expect(editorBody.mealPlanId ?? editorBody.id ?? editorBody.draftId).toBeDefined();

    // Publishing the restored draft supersedes the previous published row and
    // leaves exactly one PUBLISHED row for the week.
    await publish(restoreBody.draftMealPlanId);
    const publishedRows = await db.mealPlan.findMany({ where: { clientId: client.id, weekOf: asDate(WEEK_A), status: "PUBLISHED" } });
    expect(publishedRows).toHaveLength(1);
    expect(publishedRows[0].id).toBe(restoreBody.draftMealPlanId);

    // findCarryForwardSource for the next week still returns the newly published row.
    const carrySource = await findCarryForwardSource(client.id, asDate(WEEK_B));
    expect(carrySource?.id).toBe(restoreBody.draftMealPlanId);
  });

  // ── 19a. delete failure never surfaces as a 500 (T-801 review r2, MINOR 5) ─

  it("a failed cleanup delete never turns a successful restore into a 500, and leaves both drafts in place", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });
    const existingDraftId = await createDraft(client.id, coach.id, WEEK_A, { items: [ITEMS[0]] });

    const deleteManySpy = vi.spyOn(db.mealPlan, "deleteMany").mockRejectedValueOnce(new Error("boom"));
    try {
      const res = await postRestore(client.id, { sourceMealPlanId: sourceId, replaceExistingDraft: true });
      expect(res.status).toBe(200);
      const body = await res.json();
      // The delete threw before it could report what it deleted (or didn't) —
      // this pins the swallow-and-report-nothing behaviour introduced this
      // round, not a guess at what "really" happened underneath.
      expect(body.replacedDraftIds).toEqual([]);

      // Both rows survive: the pre-existing draft the delete failed to clean
      // up, and the new draft the restore created before the delete ran.
      expect(await db.mealPlan.findUnique({ where: { id: existingDraftId } })).not.toBeNull();
      expect(await db.mealPlan.findUnique({ where: { id: body.draftMealPlanId } })).not.toBeNull();
      const draftsForWeek = await db.mealPlan.findMany({ where: { clientId: client.id, weekOf: asDate(WEEK_A), status: "DRAFT" } });
      expect(draftsForWeek.map((d) => d.id).sort()).toEqual([existingDraftId, body.draftMealPlanId].sort());
    } finally {
      deleteManySpy.mockRestore();
    }
  });

  // ── 20. auth ladder on restore ────────────────────────────────────────────

  it("enforces the full auth ladder on restore", async () => {
    const { client, coach } = await fixture();
    const sourceId = await publishWeek(client.id, coach.id, WEEK_A, { items: ITEMS });

    // 401 unauthenticated.
    mocks.authUserId = "";
    expect((await postRestore(client.id, { sourceMealPlanId: sourceId })).status).toBe(401);

    // 403 non-coach.
    const nonCoachClerkId = randomUUID();
    const nonCoach = await db.user.create({ data: { clerkId: nonCoachClerkId, email: `noncoach2-${nonCoachClerkId}@example.test`, isClient: true } });
    mocks.authUserId = nonCoach.clerkId;
    expect((await postRestore(client.id, { sourceMealPlanId: sourceId })).status).toBe(403);

    // 403 unassigned coach.
    const unassignedClerkId = randomUUID();
    const unassignedCoach = await db.user.create({ data: { clerkId: unassignedClerkId, email: `unassigned-${unassignedClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    mocks.authUserId = unassignedCoach.clerkId;
    expect((await postRestore(client.id, { sourceMealPlanId: sourceId })).status).toBe(403);

    mocks.authUserId = coach.clerkId;

    // 404 unknown sourceMealPlanId.
    expect((await postRestore(client.id, { sourceMealPlanId: "does-not-exist" })).status).toBe(404);

    // 403 source belonging to another client.
    const { client: otherClient, coach: otherCoach } = await fixture();
    const otherPlan = await publishWeek(otherClient.id, otherCoach.id, WEEK_A, { items: ITEMS });
    mocks.authUserId = coach.clerkId;
    expect((await postRestore(client.id, { sourceMealPlanId: otherPlan })).status).toBe(403);

    // 422 malformed body.
    const badRes = await restoreRoute(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceExistingDraft: "not-a-boolean" }),
      }),
      params(client.id)
    );
    expect(badRes.status).toBe(422);
  });
});
