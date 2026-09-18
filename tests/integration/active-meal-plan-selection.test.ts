import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-105 — one active-plan selection rule.
 *
 * The rule used to be written out four times, every copy ordering by
 * `publishedAt desc` with no `weekOf` bound. A coach who published a correction
 * to LAST week after THIS week's plan was already live silently demoted this
 * week's plan for every client-facing reader — including the daily checkoff
 * list, which then started persisting last week's `mealNameSnapshot` rows. And
 * because the copies could drift, two screens could pick two different plans on
 * the same day and write two disjoint sets of `DailyMealCheckoff` rows (the
 * table is unique on `(dailyAdherenceId, mealNameSnapshot)`).
 *
 * `lib/meal-plans/active-plan.ts` now owns the rule: the PUBLISHED plan with the
 * highest `weekOf`, ordered `weekOf desc, publishedAt desc, version desc`. One
 * query, no `weekOf` bound, no fallback, no clock — so no row can ever be
 * excluded by week and a newly published future week is visible immediately.
 *
 * Everything here runs against real rows produced by the real create/publish
 * path, and asserts through the real routes wherever a route is the consumer.
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
  clerkClient: async () => ({ users: { getUser: async () => ({ imageUrl: null }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: mocks.notifySms }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/push", () => ({ pushMealPlanUpdated: mocks.pushMealPlanUpdated }));

import { db } from "@/lib/db";
import { createDraftMealPlan, publishMealPlan, saveDraftMealPlan } from "@/app/actions/meal-plans";
import { toggleMealCheckoff } from "@/app/actions/adherence";
import { GET as clientHome } from "@/app/api/client/home/route";
import { GET as clientAdherenceToday } from "@/app/api/client/adherence/today/route";
import { GET as clientCurrentMealPlan } from "@/app/api/client/meal-plan/current/route";
import {
  getActiveMealNames,
  resolveActiveMealPlanId,
} from "@/lib/meal-plans/active-plan";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { PUBLISHED_MEAL_PLAN_INDEX } from "@/lib/meal-plans/publish";
import { formatDateUTC, getCurrentWeekMonday } from "@/lib/utils/date";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Weeks relative to the real current week. Selection reads no clock, so these
 *  only have to be distinct and correctly ordered — no fake timers needed. */
const weekOffset = (weeks: number) =>
  formatDateUTC(new Date(getCurrentWeekMonday().getTime() + weeks * 7 * DAY_MS));
const WEEK_PREV = weekOffset(-1);
const WEEK_CURRENT = weekOffset(0);
const WEEK_NEXT = weekOffset(1);
const WEEK_AFTER_NEXT = weekOffset(2);

const PREV_ITEMS = [
  { mealName: "Breakfast", sortOrder: 0, foodName: "Oats", quantity: "80", unit: "g", calories: 300, protein: 10, carbs: 54, fats: 6 },
  { mealName: "Lunch", sortOrder: 1, foodName: "Chicken breast", quantity: "200", unit: "g", calories: 330, protein: 62, carbs: 0, fats: 7 },
];

const CURRENT_ITEMS = [
  { mealName: "AM Meal", sortOrder: 0, foodName: "Eggs", quantity: "3", unit: "whole", calories: 210, protein: 18, carbs: 1, fats: 15 },
  { mealName: "PM Meal", sortOrder: 1, foodName: "Salmon", quantity: "180", unit: "g", calories: 370, protein: 40, carbs: 0, fats: 22 },
];

const MACRO_TARGETS = [
  { mealName: "Meal 1", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
  { mealName: "Meal 2", sortOrder: 1, calories: 700, protein: 50, carbs: 70, fats: 20 },
];

suite("active meal plan selection (T-105)", () => {
  // Same self-heal as the other publishing suites: the partial unique index is
  // raw SQL in a migration that `db push` neither creates nor preserves.
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

  /** Returns the `CoachClient` row too: `link.createdAt` is the `publishedAfter`
   *  provider gate that `getActiveMealNames` now requires. */
  async function fixture() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isClient: true, activeRole: "CLIENT" } });
    const link = await db.coachClient.create({
      data: { coachId: coach.id, clientId: client.id, adherenceEnabled: true },
    });
    mocks.authUserId = coach.clerkId;
    return { coach, client, link };
  }

  /** Publish a foods plan for `weekStartDate`, return its id. */
  async function publishFoods(clientId: string, weekStartDate: string, items: typeof PREV_ITEMS) {
    const draft = await createDraftMealPlan({ clientId, weekStartDate, items, startBlank: true });
    await publishMealPlan({ mealPlanId: draft.mealPlanId, notifyClient: false });
    return draft.mealPlanId;
  }

  /** Coach corrects an already-PUBLISHED plan through the real CB04 fork path,
   *  then publishes the fork — so that week's `publishedAt` becomes the newest
   *  row in the table. */
  async function publishCorrection(publishedPlanId: string, items: typeof PREV_ITEMS) {
    const saved = await saveDraftMealPlan({ mealPlanId: publishedPlanId, items });
    const forkedId = (saved as { forkedNewDraftId?: string }).forkedNewDraftId;
    expect(forkedId).toBeTruthy();
    await publishMealPlan({ mealPlanId: forkedId!, notifyClient: false });
    return forkedId!;
  }

  const asClient = (clerkId: string) => { mocks.authUserId = clerkId; };

  // ── 1. The bug ──────────────────────────────────────────────────────────────

  describe("the ordering bug", () => {
    it("keeps this week's plan active after a correction is published to last week", async () => {
      const { client, link } = await fixture();

      const prevId = await publishFoods(client.id, WEEK_PREV, PREV_ITEMS);
      const currentId = await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);
      // The correction: last week's plan is re-published, so its `publishedAt`
      // is now the NEWEST in the table.
      const correctedPrevId = await publishCorrection(prevId, [
        ...PREV_ITEMS,
        { mealName: "Snack", sortOrder: 2, foodName: "Almonds", quantity: "30", unit: "g", calories: 174, protein: 6, carbs: 6, fats: 15 },
      ]);

      const corrected = await db.mealPlan.findUniqueOrThrow({ where: { id: correctedPrevId }, select: { publishedAt: true, weekOf: true } });
      const current = await db.mealPlan.findUniqueOrThrow({ where: { id: currentId }, select: { publishedAt: true } });
      // Precondition — this is exactly the state the old `publishedAt desc`
      // rule mis-ordered.
      expect(corrected.publishedAt!.getTime()).toBeGreaterThan(current.publishedAt!.getTime());

      // Pre-fix, EVERY ONE of the four assertions below returned week W-1.
      expect(await resolveActiveMealPlanId(client.id, link.createdAt)).toBe(currentId);
      expect((await getCurrentPublishedMealPlan(client.id, link.createdAt))!.id).toBe(currentId);
      expect((await getActiveMealNames(client.id, link.createdAt)).map((m) => m.mealName)).toEqual([
        "AM Meal",
        "PM Meal",
      ]);

      asClient(client.clerkId);
      const body = await (await clientCurrentMealPlan()).json();
      expect(body.mealPlan.id).toBe(currentId);
    });
  });

  // ── 2. Anti-drift ───────────────────────────────────────────────────────────

  describe("all client-facing readers agree on one plan id", () => {
    it("resolves the same plan and the same meal names across every reader", async () => {
      const { client, link } = await fixture();
      await publishFoods(client.id, WEEK_PREV, PREV_ITEMS);
      const currentId = await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);
      await publishCorrection(currentId, CURRENT_ITEMS);

      const activeId = await resolveActiveMealPlanId(client.id, link.createdAt);
      const names = (await getActiveMealNames(client.id, link.createdAt)).map((m) => m.mealName);

      expect((await getCurrentPublishedMealPlan(client.id, link.createdAt))!.id).toBe(activeId);

      asClient(client.clerkId);
      const home = await (await clientHome()).json();
      expect(home.adherence.mealNames).toEqual(names);
      expect(home.mealPlan.id).toBe(activeId);

      const today = await (await clientAdherenceToday()).json();
      expect(today.mealNames).toEqual(names);

      const currentRoute = await (await clientCurrentMealPlan()).json();
      expect(currentRoute.mealPlan.id).toBe(activeId);
    });
  });

  // ── 3/4. Week ordering ──────────────────────────────────────────────────────

  describe("week ordering", () => {
    it("shows a newly published future week immediately", async () => {
      // Jaden's 2026-09-16 product answer: a client sees a newly published
      // future week's plan right away, the same as the pre-T-105 behavior — it
      // is NOT held back until that week starts. Under a pure `weekOf desc`
      // sort that falls out for free: the new week carries the highest `weekOf`.
      const { client, link } = await fixture();
      const currentId = await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);
      const nextId = await publishFoods(client.id, WEEK_NEXT, PREV_ITEMS);

      expect(await resolveActiveMealPlanId(client.id, link.createdAt)).toBe(nextId);
      expect((await getActiveMealNames(client.id, link.createdAt)).map((m) => m.mealName)).toEqual([
        "Breakfast",
        "Lunch",
      ]);

      // ...and it KEEPS the top spot once it is there. This is the accepted
      // consequence of an absolute `weekOf desc`: a later correction to the
      // current week (published through the real CB04 fork path, so its
      // `publishedAt` is the newest row in the table) does not demote the
      // future week. Pinned deliberately so nobody "fixes" the rule back into a
      // clock-dependent ceiling without reopening the product decision.
      await publishCorrection(currentId, CURRENT_ITEMS);

      expect(await resolveActiveMealPlanId(client.id, link.createdAt)).toBe(nextId);
      expect((await getActiveMealNames(client.id, link.createdAt)).map((m) => m.mealName)).toEqual([
        "Breakfast",
        "Lunch",
      ]);
    });

    it("still shows a future-only plan", async () => {
      // No client is ever left planless: a coach who has only built next month's
      // week must not leave the client staring at "No meal plan yet".
      const { client, link } = await fixture();
      const futureId = await publishFoods(client.id, WEEK_AFTER_NEXT, PREV_ITEMS);

      expect(await resolveActiveMealPlanId(client.id, link.createdAt)).toBe(futureId);
      expect((await getActiveMealNames(client.id, link.createdAt)).map((m) => m.mealName)).toEqual([
        "Breakfast",
        "Lunch",
      ]);
    });

    it("selects a mid-week (non-normalized) weekOf row", async () => {
      // `weekOf` is not reliably normalized — rows predating
      // `parseWeekStartDate` (and `tests/integration/client-provider-plan.test.ts:35`)
      // carry a mid-week timestamp. There is no `weekOf` bound in the query at
      // all, so no row can ever be excluded by week: strictly safer than any
      // bound, which is why the ceiling this case used to guard is gone.
      const { client, link } = await fixture();
      const midWeek = await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: new Date(), // mid-week instant, NOT a normalized Monday
          version: 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
          items: { create: CURRENT_ITEMS },
        },
      });

      expect(await resolveActiveMealPlanId(client.id, link.createdAt)).toBe(midWeek.id);
      expect((await getActiveMealNames(client.id, link.createdAt)).map((m) => m.mealName)).toEqual([
        "AM Meal",
        "PM Meal",
      ]);
    });
  });

  // ── 5. Provider gate ────────────────────────────────────────────────────────

  describe("provider gate", () => {
    it("hides plans published before the current relationship started", async () => {
      const { client, link } = await fixture();
      const planId = await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);
      const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: planId }, select: { publishedAt: true } });

      // Simulate a coach switch: the relationship now starts AFTER the plan was
      // published, so that plan belongs to the previous coach.
      const movedLink = await db.coachClient.update({
        where: { id: link.id },
        data: { createdAt: new Date(plan.publishedAt!.getTime() + 60_000) },
        select: { createdAt: true },
      });

      expect(await getActiveMealNames(client.id, movedLink.createdAt)).toEqual([]);
      expect(
        (await getActiveMealNames(client.id, new Date(plan.publishedAt!.getTime() - 60_000))).map((m) => m.mealName)
      ).toEqual(["AM Meal", "PM Meal"]);
    });

    it("returns [] for `publishedAfter: null` without falling back to an unfiltered read", async () => {
      const { client } = await fixture();
      await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);

      // The client HAS a published plan. `null` means "no active human
      // provider", and must short-circuit before any query. T-665 deleted the
      // legacy `undefined` (unfiltered) arm of `PublishedAfter` entirely, so
      // there is no longer an `undefined` state to degrade into.
      expect(await resolveActiveMealPlanId(client.id, null)).toBeNull();
      expect(await getActiveMealNames(client.id, null)).toEqual([]);
      // T-665 removed the legacy `undefined` arm of `PublishedAfter`. This line
      // now carries the case's precondition: the client really does have a
      // published plan, so the `null` short-circuit above is what produced the
      // empty result, not an absence of data.
      expect(await resolveActiveMealPlanId(client.id, new Date(0))).not.toBeNull();
    });
  });

  describe("/api/client/adherence/today is provider-aware", () => {
    it("returns 200 with no meal names when the plan predates the relationship", async () => {
      const { client, link } = await fixture();
      const planId = await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);
      const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: planId }, select: { publishedAt: true } });
      await db.coachClient.update({
        where: { id: link.id },
        data: { createdAt: new Date(plan.publishedAt!.getTime() + 60_000) },
      });

      asClient(client.clerkId);
      const res = await clientAdherenceToday();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.mealNames).toEqual([]);
      // `enabled` still comes from the UNFILTERED `coachClient.findFirst` — that
      // shape is T-202's finding and was deliberately not fixed in T-105, so it
      // can read `true` while `mealNames` is `[]`.
      expect(body.enabled).toBe(true);
    });

    it("returns 200 with no meal names when the provider needs resolution", async () => {
      const { client } = await fixture();
      await publishFoods(client.id, WEEK_CURRENT, CURRENT_ITEMS);

      // A second CoachClient row with no ClientCoachingContext →
      // `resolutionRequired` (lib/queries/client-provider.ts:14).
      const otherClerkId = randomUUID();
      const otherCoach = await db.user.create({ data: { clerkId: otherClerkId, email: `coach-${otherClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
      await db.coachClient.create({ data: { coachId: otherCoach.id, clientId: client.id } });

      asClient(client.clerkId);
      const res = await clientAdherenceToday();
      const body = await res.json();

      // No new status code: an unresolved provider is an empty list, not a 409.
      expect(res.status).toBe(200);
      expect(body.mealNames).toEqual([]);
      expect(body.enabled).toBe(true);
    });
  });

  // ── 6. Checkoff safety ──────────────────────────────────────────────────────

  describe("de-dup survives the move", () => {
    it("returns each meal name once and writes exactly one checkoff row per name", async () => {
      const { client, link } = await fixture();
      await publishFoods(client.id, WEEK_CURRENT, [
        ...CURRENT_ITEMS,
        { mealName: "AM Meal", sortOrder: 2, foodName: "Berries", quantity: "100", unit: "g", calories: 57, protein: 1, carbs: 14, fats: 0 },
      ]);

      const names = await getActiveMealNames(client.id, link.createdAt);
      expect(names.map((n) => n.mealName)).toEqual(["AM Meal", "PM Meal"]);
      expect(new Set(names.map((n) => n.mealName)).size).toBe(names.length);

      // `DailyMealCheckoff` is unique on `(dailyAdherenceId, mealNameSnapshot)`:
      // a duplicated name in this list would trip P2002 or silently collapse two
      // meals into one row.
      const date = new Date().toISOString().split("T")[0];
      asClient(client.clerkId);
      for (const n of names) {
        await toggleMealCheckoff({ date, mealNameSnapshot: n.mealName, displayOrder: n.order, completed: true });
        await toggleMealCheckoff({ date, mealNameSnapshot: n.mealName, displayOrder: n.order, completed: false });
      }

      const adherence = await db.dailyAdherence.findUniqueOrThrow({
        where: { clientId_date: { clientId: client.id, date } },
        include: { meals: true },
      });
      expect(adherence.meals).toHaveLength(names.length);
      expect(adherence.meals.map((m) => m.mealNameSnapshot).sort()).toEqual(["AM Meal", "PM Meal"]);
    });
  });

  // ── 7. MACROS through the real routes ───────────────────────────────────────

  describe("MACROS end to end", () => {
    it("serves the macro targets' names to /api/client/home and /api/client/meal-plan/current", async () => {
      const { client } = await fixture();
      // The T-101 carry-forward shape: foods week first, then a macro-only
      // draft that inherits the foods week's `items`.
      await publishFoods(client.id, WEEK_PREV, PREV_ITEMS);
      const macros = await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: WEEK_CURRENT,
        planMode: "MACROS",
        macroTargets: MACRO_TARGETS,
      });
      await publishMealPlan({ mealPlanId: macros.mealPlanId, notifyClient: false });

      // Precondition: the macro plan really does carry the foods forward.
      const stored = await db.mealPlan.findUniqueOrThrow({ where: { id: macros.mealPlanId }, include: { items: true } });
      expect(stored.items.length).toBe(PREV_ITEMS.length);

      asClient(client.clerkId);
      const home = await (await clientHome()).json();
      expect(home.adherence.mealNames).toEqual(["Meal 1", "Meal 2"]);

      const body = await (await clientCurrentMealPlan()).json();
      expect(body.mealPlan.planMode).toBe("MACROS");
      expect(body.mealPlan.macroTargets.map((t: { mealName: string }) => t.mealName)).toEqual(["Meal 1", "Meal 2"]);
    });
  });

  // ── 8. Empty states ─────────────────────────────────────────────────────────

  describe("empty states", () => {
    it("returns nothing everywhere when the client has no published plan", async () => {
      const { client, link } = await fixture();

      expect(await resolveActiveMealPlanId(client.id, link.createdAt)).toBeNull();
      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([]);
      expect(await getCurrentPublishedMealPlan(client.id, link.createdAt)).toBeNull();

      asClient(client.clerkId);
      const body = await (await clientCurrentMealPlan()).json();
      expect(body).toEqual({ mealPlan: null });
    });
  });
});
