import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-101 review round 1, findings 1 and 2 — the client-facing consumers of a
 * meal plan must pick their representation by `planMode`.
 *
 * T-101 made carry-forward the default and made it carry EVERY part of the
 * previous published plan, so `items` and `macroTargets` now coexist on every
 * version by design. That turned "this plan has no items" from the normal
 * state of a macro plan into the exception: the macro editor's `ensureDraft()`
 * sends only `macroTargets`, and the shared service fills in the missing
 * `items` from the prior published foods plan. Any consumer that reads `items`
 * without a mode check therefore now shows a macro client last week's foods.
 *
 * Covered here, all against real rows produced by the real create/publish path:
 *  - `/api/mealplans/[mealPlanId]/export` (the client's PDF download button),
 *  - `getActiveMealNames` (the client's daily meal checkoff list, which persists
 *    `mealNameSnapshot` rows — a wrong list corrupts data, not just pixels),
 *  - the client dashboard's nutrition card (`app/client/page.tsx`), added in
 *    review round 2 as the third reader of the same data.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  notifySms: vi.fn(),
  sendEmail: vi.fn(),
  pushMealPlanUpdated: vi.fn(),
  pdfCalls: [] as import("@/lib/pdf/meal-plan-pdf").MealPlanPdfData[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: mocks.notifySms }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/push", () => ({ pushMealPlanUpdated: mocks.pushMealPlanUpdated }));

// Delegates to the real renderer (so the route still returns real PDF bytes)
// while capturing exactly what was handed to it.
vi.mock("@/lib/pdf/meal-plan-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf/meal-plan-pdf")>();
  return {
    ...actual,
    renderMealPlanPdf: async (data: import("@/lib/pdf/meal-plan-pdf").MealPlanPdfData) => {
      mocks.pdfCalls.push(data);
      return actual.renderMealPlanPdf(data);
    },
  };
});

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { GET as exportMealPlan } from "@/app/api/mealplans/[mealPlanId]/export/route";
import { resolveMealPlanPdfContent } from "@/lib/pdf/meal-plan-pdf";
import { getActiveMealNames } from "@/lib/meal-plans/active-plan";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { PUBLISHED_MEAL_PLAN_INDEX } from "@/lib/meal-plans/publish";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

// Mondays.
const WEEK_A = "2026-04-06";
const WEEK_B = "2026-04-13";

const FOOD_ITEMS = [
  { mealName: "Breakfast", sortOrder: 0, foodName: "Oats", quantity: "80", unit: "g", calories: 300, protein: 10, carbs: 54, fats: 6 },
  { mealName: "Lunch", sortOrder: 1, foodName: "Chicken breast", quantity: "200", unit: "g", calories: 330, protein: 62, carbs: 0, fats: 7 },
];

const MACRO_TARGETS = [
  { mealName: "Meal 1", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
  { mealName: "Meal 2", sortOrder: 1, calories: 700, protein: 50, carbs: 70, fats: 20 },
];

suite("planMode-aware client-facing consumers (PDF export, adherence checklist)", () => {
  // Same self-heal as the other publishing suites: the partial unique index is
  // raw SQL in a migration that `db push` neither creates nor preserves.
  beforeAll(async () => {
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${PUBLISHED_MEAL_PLAN_INDEX}" ON "MealPlan"("clientId","weekOf") WHERE (status = 'PUBLISHED')`
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pdfCalls.length = 0;
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
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;
    // T-105: `link` is returned so tests can pass `link.createdAt` as the
    // provider gate (`publishedAfter`), which `getActiveMealNames` requires.
    return { coach, client, link };
  }

  const exportPdf = (mealPlanId: string) =>
    exportMealPlan(
      new NextRequest(`https://example.test/api/mealplans/${mealPlanId}/export`),
      { params: Promise.resolve({ mealPlanId }) }
    );

  /**
   * Publishes a foods plan for week A, then creates a macro plan for week B
   * through the macro editor's ACTUAL payload shape — `planMode: "MACROS"` and
   * `macroTargets` only, never `items` — and publishes that too.
   */
  async function macroPlanCarryingFoodsForward(clientId: string) {
    const foods = await createDraftMealPlan({
      clientId,
      weekStartDate: WEEK_A,
      items: FOOD_ITEMS,
      planExtras: {
        dayOverrides: [
          {
            label: "High Carb Day",
            weekdays: ["Monday"],
            mealAdjustments: [
              { mealName: "Breakfast", changes: [{ type: "add", food: "Rice cakes", newPortion: "2" }] },
            ],
          },
        ],
      },
      supportContent: "Foods-week guidance.",
    });
    await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

    // macro-plan-editor.tsx ensureDraft(), verbatim.
    const macros = await createDraftMealPlan({
      clientId,
      weekStartDate: WEEK_B,
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
    });
    await publishMealPlan({ mealPlanId: macros.mealPlanId, notifyClient: false });

    return { foodsPlanId: foods.mealPlanId, macroPlanId: macros.mealPlanId };
  }

  describe("PDF export (finding 1)", () => {
    it("never renders carried-forward foods for a MACROS plan the client downloads", async () => {
      const { client } = await fixture();
      const { macroPlanId } = await macroPlanCarryingFoodsForward(client.id);

      // Precondition — this is the DEFAULT state after T-101, not a contrivance:
      // the macro plan really does carry the foods week's items and extras.
      const stored = await db.mealPlan.findUniqueOrThrow({
        where: { id: macroPlanId },
        include: { items: true, macroTargets: true },
      });
      expect(stored.planMode).toBe("MACROS");
      expect(stored.items.length).toBe(FOOD_ITEMS.length);
      expect(stored.planExtras).not.toBeNull();

      // The client downloads their own plan.
      mocks.authUserId = client.clerkId;
      const res = await exportPdf(macroPlanId);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

      expect(mocks.pdfCalls).toHaveLength(1);
      const rendered = resolveMealPlanPdfContent(mocks.pdfCalls[0]);
      expect(rendered.mode).toBe("MACROS");
      // No food rows, and no food-level day overrides, reach the document.
      expect(rendered.foodItems).toEqual([]);
      expect(rendered.planExtras).toBeNull();
      expect(rendered.macroTargets).toEqual(
        MACRO_TARGETS.map(({ mealName, calories, protein, carbs, fats }) => ({ mealName, calories, protein, carbs, fats }))
      );
      // The macro document mirrors MacroPlanView: targets + guidance.
      expect(rendered.supportContent).toBe("Foods-week guidance.");
    });

    it("still renders every food row for a MEAL_PLAN plan (regression)", async () => {
      const { client } = await fixture();
      const { foodsPlanId } = await macroPlanCarryingFoodsForward(client.id);

      mocks.authUserId = client.clerkId;
      const res = await exportPdf(foodsPlanId);

      expect(res.status).toBe(200);
      expect(mocks.pdfCalls).toHaveLength(1);
      const rendered = resolveMealPlanPdfContent(mocks.pdfCalls[0]);
      expect(rendered.mode).toBe("MEAL_PLAN");
      expect(rendered.foodItems.map((i) => i.foodName)).toEqual(["Oats", "Chicken breast"]);
      expect(rendered.planExtras?.dayOverrides?.[0]?.label).toBe("High Carb Day");
      expect(rendered.macroTargets).toEqual([]);
      // Review r2 finding 2a: the route hands the resolver every column
      // unconditionally now, so the plan's notes DO arrive here...
      expect(mocks.pdfCalls[0].supportContent).toBe("Foods-week guidance.");
      // ...and the resolver alone decides to drop them in foods mode, keeping
      // the foods PDF byte-identical to pre-T-101 (documented asymmetry).
      expect(rendered.supportContent).toBeNull();
    });

    it("keeps the coach's own export mode-aware too", async () => {
      const { coach, client } = await fixture();
      const { macroPlanId } = await macroPlanCarryingFoodsForward(client.id);

      mocks.authUserId = coach.clerkId;
      const res = await exportPdf(macroPlanId);

      expect(res.status).toBe(200);
      expect(resolveMealPlanPdfContent(mocks.pdfCalls[0]).foodItems).toEqual([]);
    });
  });

  describe("adherence meal checklist (finding 2)", () => {
    it("returns the macro targets' meal names for a MACROS plan, not carried-forward food meals", async () => {
      const { client, link } = await fixture();
      await macroPlanCarryingFoodsForward(client.id);

      const names = await getActiveMealNames(client.id, link.createdAt);

      // These are exactly the names macro-plan-view.tsx checks off, so both
      // surfaces write the same `mealNameSnapshot` rows for the same day.
      expect(names).toEqual([
        { mealName: "Meal 1", order: 0 },
        { mealName: "Meal 2", order: 1 },
      ]);
      expect(names.map((n) => n.mealName)).not.toContain("Breakfast");
      expect(names.map((n) => n.mealName)).not.toContain("Lunch");
    });

    it("returns the items' meal names for a MEAL_PLAN plan (regression)", async () => {
      const { client, link } = await fixture();
      const foods = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: FOOD_ITEMS });
      await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([
        { mealName: "Breakfast", order: 0 },
        { mealName: "Lunch", order: 1 },
      ]);
    });

    it("deduplicates repeated meal names, preserving first-seen order (regression)", async () => {
      const { client, link } = await fixture();
      const foods = await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: WEEK_A,
        items: [
          ...FOOD_ITEMS,
          { mealName: "Breakfast", sortOrder: 2, foodName: "Blueberries", quantity: "100", unit: "g", calories: 57, protein: 1, carbs: 14, fats: 0 },
        ],
      });
      await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([
        { mealName: "Breakfast", order: 0 },
        { mealName: "Lunch", order: 1 },
      ]);
    });

    it("returns an empty list for a pre-T-102b PUBLISHED MACROS plan with no targets set", async () => {
      const { client, link } = await fixture();
      const foods = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: FOOD_ITEMS });
      await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

      // T-102b: this state can no longer be REACHED through the publish path —
      // `publishMealPlanTarget` rejects a MACROS plan with zero macro targets.
      // The row is therefore constructed directly, bypassing the guard, because
      // rows exactly like it exist in production from before the guard shipped
      // and `getActiveMealNames` must stay defensive about them. Do not delete
      // this case and do not "fix" it by giving the plan targets — that would be
      // a different test.
      await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: new Date(`${WEEK_B}T00:00:00Z`),
          version: 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
          planMode: "MACROS",
          // Mode toggled with no targets entered yet: still carries the foods.
          items: { create: FOOD_ITEMS },
        },
      });

      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([]);
    });

    it("returns an empty list when the client has no published plan (regression)", async () => {
      const { client, link } = await fixture();
      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([]);
    });
  });

  /**
   * Review r2 finding 1 — the client dashboard's nutrition card was the third
   * unguarded `mealPlan.items` reader (`app/client/page.tsx`, "TODAY'S PLAN").
   * It derived its "N meals · M logged" count from the raw items of the plan
   * returned by `getCurrentPublishedMealPlan`, so a MACROS client saw the
   * carried-forward foods week's meal count on the card while the adherence
   * rows right underneath (mode-gated since finding 2) showed the macro meals.
   * iOS never had this bug: `/api/client/home` builds `mealNames` from
   * `getActiveMealNames`. The card now uses that same list.
   *
   * These assertions reproduce the page's own data fetch (both queries, same
   * arguments the page passes) and pin the count the card renders.
   */
  describe("client dashboard nutrition card (review r2 finding 1)", () => {
    it("counts meals from the mode-gated list, not the MACROS plan's carried-forward items", async () => {
      const { client, link } = await fixture();
      await macroPlanCarryingFoodsForward(client.id);

      // `app/client/page.tsx` fetches exactly these two in its Promise.all.
      const [mealPlan, planMeals] = await Promise.all([
        getCurrentPublishedMealPlan(client.id),
        getActiveMealNames(client.id, link.createdAt),
      ]);

      // Precondition: the card renders at all (it is gated on `mealPlan`), and
      // the plan really does carry the foods week's items forward.
      expect(mealPlan).not.toBeNull();
      expect(mealPlan!.planMode).toBe("MACROS");
      expect(mealPlan!.items.length).toBe(FOOD_ITEMS.length);

      // The card's count, as the page now computes it.
      const totalMealCount = planMeals.length;
      expect(totalMealCount).toBe(MACRO_TARGETS.length);
      expect(planMeals.map((m) => m.mealName)).toEqual(["Meal 1", "Meal 2"]);

      // And it agrees with the adherence checklist rendered directly below it
      // and with the `mealNames` iOS reads from /api/client/home.
      expect(planMeals).toEqual(await getActiveMealNames(client.id, link.createdAt));
    });

    it("still counts the food meals for a MEAL_PLAN client (regression)", async () => {
      const { client, link } = await fixture();
      const foods = await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: WEEK_A,
        items: [
          ...FOOD_ITEMS,
          // Repeated meal name: the card counts distinct meals, not rows.
          { mealName: "Breakfast", sortOrder: 2, foodName: "Blueberries", quantity: "100", unit: "g", calories: 57, protein: 1, carbs: 14, fats: 0 },
        ],
      });
      await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

      const [mealPlan, planMeals] = await Promise.all([
        getCurrentPublishedMealPlan(client.id),
        getActiveMealNames(client.id, link.createdAt),
      ]);

      expect(mealPlan!.planMode).toBe("MEAL_PLAN");
      // Same number the old `new Set(mealPlan.items.map(i => i.mealName))`
      // produced for a foods plan — this reader's behavior is unchanged here.
      expect(planMeals.length).toBe(2);
      expect(new Set(mealPlan!.items.map((i) => i.mealName)).size).toBe(planMeals.length);
    });
  });
});
