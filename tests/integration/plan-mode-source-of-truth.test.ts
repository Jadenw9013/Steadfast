import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-102a — the coach-facing editor mode is resolved server-side, once, by
 * `lib/meal-plans/plan-mode.ts` (`draft?.planMode ?? clientPlanMode`), and both
 * coach surfaces report the same value.
 *
 * The three defects this pins down:
 *  1. A client with no plans at all was hardcoded to `MEAL_PLAN` on both
 *     platforms, so a MACROS client opened straight into the foods editor.
 *  2. Toggling on a week that has only a PUBLISHED plan did nothing visible and
 *     a reload reverted the toggle, because both editors read the effective
 *     plan ROW's `planMode`.
 *  3. The foods editor created drafts with no explicit `planMode`, so after a
 *     toggle it could create a MACROS draft full of foods.
 *
 * The last block is the T-101 regression surface: `CoachClient.planMode` is the
 * coach's intent for new work and must NEVER reach a client-facing reader. The
 * PDF export, the adherence meal checklist, the client dashboard nutrition card
 * and `/api/client/meal-plan/current` all pick by the PUBLISHED row's own
 * `planMode`, and each one of those was found broken in a separate T-101 review
 * round.
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

// Delegates to the real renderer while capturing exactly what was handed to it.
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
import { setClientPlanMode } from "@/app/actions/plan-mode";
import { GET as coachMealPlanGet } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { POST as planModeRest } from "@/app/api/coach/clients/[clientId]/plan-mode/route";
import { GET as clientCurrentMealPlan } from "@/app/api/client/meal-plan/current/route";
import { GET as exportMealPlan } from "@/app/api/mealplans/[mealPlanId]/export/route";
import { resolveMealPlanPdfContent } from "@/lib/pdf/meal-plan-pdf";
import { getActiveMealNames } from "@/lib/meal-plans/active-plan";
import {
  getEffectiveMealPlanForReview,
  getCurrentPublishedMealPlan,
} from "@/lib/queries/meal-plans";
import { PUBLISHED_MEAL_PLAN_INDEX } from "@/lib/meal-plans/publish";
import { parseWeekStartDate } from "@/lib/utils/date";
import { buildFoodsDraftInput, buildMacroDraftInput } from "@/lib/meal-plans/editor-state";
import { groupItemsToMeals, macroTargetsToEditable } from "@/types/meal-plan";

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

type PlanMode = "MEAL_PLAN" | "MACROS";

suite("plan mode single source of truth (coach editorMode / clientPlanMode)", () => {
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
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isClient: true, activeRole: "CLIENT" } });
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;
    // T-105: `link` is returned so tests can pass `link.createdAt` as the
    // provider gate (`publishedAfter`), which `getActiveMealNames` requires.
    return { coach, client, link };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  /** REST GET for a specific week. */
  function restGet(clientId: string, weekOf: string) {
    return coachMealPlanGet(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan?weekOf=${weekOf}`),
      params(clientId)
    );
  }

  async function restBody(clientId: string, weekOf: string) {
    const res = await restGet(clientId, weekOf);
    expect(res.status).toBe(200);
    return res.json();
  }

  function webRead(coachId: string, clientId: string, weekOf: string) {
    return getEffectiveMealPlanForReview({ coachId, clientId, weekOf: parseWeekStartDate(weekOf) });
  }

  /** Writes `CoachClient.planMode` directly, bypassing the toggle — the only way
   *  to construct drift between a draft's mode and the client default, because
   *  `setClientPlanModeForCoach` deliberately rewrites every DRAFT row too. */
  function forceClientPlanMode(coachId: string, clientId: string, planMode: PlanMode) {
    return db.coachClient.update({
      where: { coachId_clientId: { coachId, clientId } },
      data: { planMode },
    });
  }

  // ── 1. The "client with no plans" case ─────────────────────────────────────

  describe("no plan at all", () => {
    it("reports the client's MACROS default on both surfaces instead of hardcoding MEAL_PLAN", async () => {
      const { coach, client } = await fixture();
      await forceClientPlanMode(coach.id, client.id, "MACROS");

      expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(0);

      const web = await webRead(coach.id, client.id, WEEK_A);
      expect(web.source).toBe("empty");
      expect(web.editorMode).toBe("MACROS");
      expect(web.clientPlanMode).toBe("MACROS");

      const body = await restBody(client.id, WEEK_A);
      expect(body.mealPlan).toBeNull();
      expect(body.source).toBe("empty");
      expect(body.editorMode).toBe("MACROS");
      expect(body.clientPlanMode).toBe("MACROS");
    });

    it("still reports MEAL_PLAN for a client who never toggled (regression)", async () => {
      const { coach, client } = await fixture();

      const web = await webRead(coach.id, client.id, WEEK_A);
      expect(web.editorMode).toBe("MEAL_PLAN");
      expect(web.clientPlanMode).toBe("MEAL_PLAN");

      const body = await restBody(client.id, WEEK_A);
      expect(body.editorMode).toBe("MEAL_PLAN");
      expect(body.clientPlanMode).toBe("MEAL_PLAN");
    });
  });

  // ── 2. Toggling on a published-only week ───────────────────────────────────

  describe("toggle with a published-only week", () => {
    async function publishedFoodsWeek(clientId: string) {
      const { mealPlanId } = await createDraftMealPlan({
        clientId,
        weekStartDate: WEEK_A,
        planMode: "MEAL_PLAN",
        items: FOOD_ITEMS,
      });
      await publishMealPlan({ mealPlanId, notifyClient: false });
      // Publishing consumes the draft, so week A really is published-only.
      expect(await db.mealPlan.count({ where: { clientId, weekOf: parseWeekStartDate(WEEK_A), status: "DRAFT" } })).toBe(0);
      return db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId }, include: { items: true } });
    }

    it("takes effect immediately, survives a reload, and never touches the published plan", async () => {
      const { coach, client } = await fixture();
      const before = await publishedFoodsWeek(client.id);

      expect((await webRead(coach.id, client.id, WEEK_A)).editorMode).toBe("MEAL_PLAN");
      expect((await restBody(client.id, WEEK_A)).editorMode).toBe("MEAL_PLAN");

      expect(await setClientPlanMode({ clientId: client.id, mode: "MACROS" })).toEqual({ success: true });

      // A fresh read IS the reload assertion.
      const web = await webRead(coach.id, client.id, WEEK_A);
      expect(web.source).toBe("published");
      expect(web.editorMode).toBe("MACROS");
      expect(web.clientPlanMode).toBe("MACROS");

      const body = await restBody(client.id, WEEK_A);
      expect(body.source).toBe("published");
      expect(body.editorMode).toBe("MACROS");
      expect(body.clientPlanMode).toBe("MACROS");
      // The row's own snapshot is untouched and still what the client sees.
      expect(body.mealPlan.planMode).toBe("MEAL_PLAN");

      const after = await db.mealPlan.findUniqueOrThrow({ where: { id: before.id }, include: { items: true } });
      expect(after.planMode).toBe("MEAL_PLAN");
      expect(after.status).toBe("PUBLISHED");
      expect(after.publishedAt?.toISOString()).toBe(before.publishedAt?.toISOString());
      expect(after.version).toBe(before.version);
      expect(after.items.map((i) => i.foodName)).toEqual(["Oats", "Chicken breast"]);

      // And back again.
      await setClientPlanMode({ clientId: client.id, mode: "MEAL_PLAN" });
      expect((await webRead(coach.id, client.id, WEEK_A)).editorMode).toBe("MEAL_PLAN");
      expect((await restBody(client.id, WEEK_A)).editorMode).toBe("MEAL_PLAN");
    });

    it("behaves identically when toggled through the iOS REST route", async () => {
      const { coach, client } = await fixture();
      const before = await publishedFoodsWeek(client.id);

      const res = await planModeRest(
        new NextRequest(`https://example.test/api/coach/clients/${client.id}/plan-mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "MACROS" }),
        }),
        params(client.id)
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, planMode: "MACROS" });

      const web = await webRead(coach.id, client.id, WEEK_A);
      const body = await restBody(client.id, WEEK_A);
      expect(web.editorMode).toBe("MACROS");
      expect(body.editorMode).toBe("MACROS");
      expect(web.clientPlanMode).toBe("MACROS");
      expect(body.clientPlanMode).toBe("MACROS");
      expect((await db.mealPlan.findUniqueOrThrow({ where: { id: before.id } })).planMode).toBe("MEAL_PLAN");
    });
  });

  // ── 3. The frozen precedence: the draft wins ───────────────────────────────

  describe("draft's mode wins over the client default", () => {
    it("reports the draft's MACROS mode while the client default says MEAL_PLAN", async () => {
      const { coach, client } = await fixture();
      await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, planMode: "MACROS", macroTargets: MACRO_TARGETS });
      await forceClientPlanMode(coach.id, client.id, "MEAL_PLAN");

      const web = await webRead(coach.id, client.id, WEEK_A);
      expect(web.source).toBe("draft");
      expect(web.editorMode).toBe("MACROS");
      expect(web.clientPlanMode).toBe("MEAL_PLAN");

      const body = await restBody(client.id, WEEK_A);
      expect(body.source).toBe("draft");
      expect(body.editorMode).toBe("MACROS");
      expect(body.clientPlanMode).toBe("MEAL_PLAN");
    });

    it("reports the draft's MEAL_PLAN mode while the client default says MACROS (inverse)", async () => {
      const { coach, client } = await fixture();
      await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, planMode: "MEAL_PLAN", items: FOOD_ITEMS });
      await forceClientPlanMode(coach.id, client.id, "MACROS");

      const web = await webRead(coach.id, client.id, WEEK_A);
      expect(web.editorMode).toBe("MEAL_PLAN");
      expect(web.clientPlanMode).toBe("MACROS");

      const body = await restBody(client.id, WEEK_A);
      expect(body.editorMode).toBe("MEAL_PLAN");
      expect(body.clientPlanMode).toBe("MACROS");
    });

    it("scopes editorMode to the requested week", async () => {
      const { coach, client } = await fixture();
      await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, planMode: "MACROS", macroTargets: MACRO_TARGETS });
      await forceClientPlanMode(coach.id, client.id, "MEAL_PLAN");

      // Week A has the MACROS draft...
      expect((await restBody(client.id, WEEK_A)).editorMode).toBe("MACROS");

      // ...week B has none, so it falls back to the client default.
      const webB = await webRead(coach.id, client.id, WEEK_B);
      expect(webB.editorMode).toBe("MEAL_PLAN");
      expect(webB.editorMode).toBe(webB.clientPlanMode);

      const bodyB = await restBody(client.id, WEEK_B);
      expect(bodyB.editorMode).toBe("MEAL_PLAN");
      expect(bodyB.editorMode).toBe(bodyB.clientPlanMode);
    });
  });

  // ── 4. Web / REST parity across every state ────────────────────────────────

  describe("web query and REST GET agree", () => {
    type StateName = "empty" | "published-only" | "draft" | "draft-disagrees-with-client";

    const STATES: { name: StateName; editorMode: PlanMode; clientPlanMode: PlanMode; mealPlanNull: boolean }[] = [
      { name: "empty", editorMode: "MACROS", clientPlanMode: "MACROS", mealPlanNull: true },
      { name: "published-only", editorMode: "MACROS", clientPlanMode: "MACROS", mealPlanNull: false },
      { name: "draft", editorMode: "MACROS", clientPlanMode: "MACROS", mealPlanNull: false },
      { name: "draft-disagrees-with-client", editorMode: "MACROS", clientPlanMode: "MEAL_PLAN", mealPlanNull: false },
    ];

    async function buildState(name: StateName) {
      const { coach, client } = await fixture();
      switch (name) {
        case "empty":
          await forceClientPlanMode(coach.id, client.id, "MACROS");
          break;
        case "published-only": {
          // A published FOODS week the coach has since toggled away from.
          const { mealPlanId } = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, planMode: "MEAL_PLAN", items: FOOD_ITEMS });
          await publishMealPlan({ mealPlanId, notifyClient: false });
          await setClientPlanMode({ clientId: client.id, mode: "MACROS" });
          break;
        }
        case "draft":
          await setClientPlanMode({ clientId: client.id, mode: "MACROS" });
          await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, planMode: "MACROS", macroTargets: MACRO_TARGETS });
          break;
        case "draft-disagrees-with-client":
          await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, planMode: "MACROS", macroTargets: MACRO_TARGETS });
          await forceClientPlanMode(coach.id, client.id, "MEAL_PLAN");
          break;
      }
      return { coach, client };
    }

    for (const state of STATES) {
      it(`resolves the same mode on both surfaces — ${state.name}`, async () => {
        const { coach, client } = await buildState(state.name);

        const web = await webRead(coach.id, client.id, WEEK_A);
        const body = await restBody(client.id, WEEK_A);

        expect(web.editorMode).toBe(body.editorMode);
        expect(web.clientPlanMode).toBe(body.clientPlanMode);
        expect(web.editorMode).toBe(state.editorMode);
        expect(web.clientPlanMode).toBe(state.clientPlanMode);
      });

      it(`always sends both fields, never null — ${state.name}`, async () => {
        const { client } = await buildState(state.name);
        const body = await restBody(client.id, WEEK_A);

        expect(body.mealPlan === null).toBe(state.mealPlanNull);
        expect(Object.hasOwn(body, "editorMode")).toBe(true);
        expect(Object.hasOwn(body, "clientPlanMode")).toBe(true);
        expect(body.editorMode).not.toBeNull();
        expect(body.editorMode).not.toBeUndefined();
        expect(body.clientPlanMode).not.toBeNull();
        expect(body.clientPlanMode).not.toBeUndefined();
        // Additive only: nothing the current iOS build decodes was removed.
        for (const key of ["mealPlan", "source", "draftId", "publishedId", "currentWeekOf"]) {
          expect(Object.hasOwn(body, key)).toBe(true);
        }
      });
    }
  });

  // ── 5. Publishing after a toggle, from each editor ─────────────────────────

  describe("publish after a toggle", () => {
    it("cannot publish a MACROS plan out of the foods editor", async () => {
      const { client } = await fixture();
      await setClientPlanMode({ clientId: client.id, mode: "MACROS" });

      // NOT a hand-written payload: this is the exact object
      // meal-plan-editor-v2.tsx `ensureDraft()` passes to `createDraftMealPlan`,
      // produced by the same builder from the same editor state
      // (`MealGroup[]` + extras + notes). If `planMode: "MEAL_PLAN"` is ever
      // dropped from `buildFoodsDraftInput`, this test fails here — the gap the
      // review flagged (finding 2) was that the payload was restated inline, so
      // the service was covered but the editor's own payload was not.
      // Remaining, deliberately uncovered link: that the component calls the
      // builder at all. This repo has no DOM/React test environment (no jsdom,
      // no testing-library) and adding one is its own ticket; the call is a
      // single type-checked line and the component constructs no other payload.
      const payload = buildFoodsDraftInput({
        clientId: client.id,
        weekStartDate: WEEK_A,
        meals: groupItemsToMeals(FOOD_ITEMS),
        planExtras: null,
        supportContent: "",
      });
      expect(payload.planMode).toBe("MEAL_PLAN");

      const { mealPlanId } = await createDraftMealPlan(payload);
      expect((await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } })).planMode).toBe("MEAL_PLAN");

      await publishMealPlan({ mealPlanId, notifyClient: false });

      mocks.authUserId = client.clerkId;
      const res = await clientCurrentMealPlan();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mealPlan.planMode).toBe("MEAL_PLAN");
      expect(body.mealPlan.items.map((i: { foodName: string }) => i.foodName)).toEqual(["Oats", "Chicken breast"]);
    });

    it("publishes a MACROS plan out of the macro editor", async () => {
      const { client } = await fixture();
      await setClientPlanMode({ clientId: client.id, mode: "MACROS" });

      // Mirror of the foods case: the exact payload macro-plan-editor.tsx
      // `ensureDraft()` sends, built from the editor's own `EditableMacroMeal[]`
      // state by the same builder the component calls.
      const payload = buildMacroDraftInput({
        clientId: client.id,
        weekStartDate: WEEK_A,
        meals: macroTargetsToEditable(MACRO_TARGETS),
        // T-103 widened the builder: the macro editor now authors plan notes
        // too. An empty box is what this case exercises.
        supportContent: "",
      });
      expect(payload.planMode).toBe("MACROS");

      const { mealPlanId } = await createDraftMealPlan(payload);
      expect((await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } })).planMode).toBe("MACROS");

      await publishMealPlan({ mealPlanId, notifyClient: false });

      mocks.authUserId = client.clerkId;
      const body = await (await clientCurrentMealPlan()).json();
      expect(body.mealPlan.planMode).toBe("MACROS");
      expect(body.mealPlan.macroTargets.map((t: { mealName: string }) => t.mealName)).toEqual(["Meal 1", "Meal 2"]);
    });

    it("flips an existing draft when the coach toggles after creating it", async () => {
      const { coach, client } = await fixture();
      const { mealPlanId } = await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: WEEK_A,
        planMode: "MEAL_PLAN",
        items: FOOD_ITEMS,
      });

      await setClientPlanMode({ clientId: client.id, mode: "MACROS" });

      // setClientPlanModeForCoach's DRAFT update — today's behavior, and what
      // keeps `draft?.planMode` and `clientPlanMode` in agreement after a toggle.
      expect((await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } })).planMode).toBe("MACROS");
      expect((await webRead(coach.id, client.id, WEEK_A)).editorMode).toBe("MACROS");
      expect((await restBody(client.id, WEEK_A)).editorMode).toBe("MACROS");
    });
  });

  // ── 6. T-101 regression: CoachClient.planMode must not leak client-side ─────

  describe("T-101 regression — CoachClient.planMode never reaches a client-facing reader", () => {
    const exportPdf = (mealPlanId: string) =>
      exportMealPlan(
        new NextRequest(`https://example.test/api/mealplans/${mealPlanId}/export`),
        { params: Promise.resolve({ mealPlanId }) }
      );

    it("keeps a published MEAL_PLAN week foods-gated after the coach toggles to MACROS", async () => {
      const { coach, client, link } = await fixture();
      const { mealPlanId } = await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: WEEK_A,
        planMode: "MEAL_PLAN",
        items: FOOD_ITEMS,
        supportContent: "Foods-week guidance.",
      });
      await publishMealPlan({ mealPlanId, notifyClient: false });

      // The coach's current intent now disagrees with the published snapshot.
      await forceClientPlanMode(coach.id, client.id, "MACROS");
      // Sanity: the coach editor really did switch...
      expect((await webRead(coach.id, client.id, WEEK_A)).editorMode).toBe("MACROS");

      // ...and not one client-facing reader moved.
      // (a) PDF export — T-101 review round 1, finding 1.
      mocks.authUserId = client.clerkId;
      const res = await exportPdf(mealPlanId);
      expect(res.status).toBe(200);
      expect(mocks.pdfCalls).toHaveLength(1);
      expect(mocks.pdfCalls[0].planMode).toBe("MEAL_PLAN");
      const rendered = resolveMealPlanPdfContent(mocks.pdfCalls[0]);
      expect(rendered.mode).toBe("MEAL_PLAN");
      expect(rendered.foodItems.map((i) => i.foodName)).toEqual(["Oats", "Chicken breast"]);

      // (b) adherence meal checklist — finding 2.
      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([
        { mealName: "Breakfast", order: 0 },
        { mealName: "Lunch", order: 1 },
      ]);

      // (c) client dashboard nutrition card — review r2 finding 1 (same source).
      const [dashPlan, dashMeals] = await Promise.all([
        getCurrentPublishedMealPlan(client.id),
        getActiveMealNames(client.id, link.createdAt),
      ]);
      expect(dashPlan!.planMode).toBe("MEAL_PLAN");
      expect(dashMeals.length).toBe(2);

      // (d) /api/client/meal-plan/current.
      const currentBody = await (await clientCurrentMealPlan()).json();
      expect(currentBody.mealPlan.planMode).toBe("MEAL_PLAN");
      expect(currentBody.mealPlan.items.map((i: { foodName: string }) => i.foodName)).toEqual(["Oats", "Chicken breast"]);
    });

    it("keeps a published MACROS week macro-gated after the coach toggles to MEAL_PLAN (mirror)", async () => {
      const { coach, client, link } = await fixture();
      const { mealPlanId } = await createDraftMealPlan({
        clientId: client.id,
        weekStartDate: WEEK_A,
        planMode: "MACROS",
        macroTargets: MACRO_TARGETS,
        supportContent: "Macro-week guidance.",
      });
      await publishMealPlan({ mealPlanId, notifyClient: false });

      await forceClientPlanMode(coach.id, client.id, "MEAL_PLAN");
      expect((await webRead(coach.id, client.id, WEEK_A)).editorMode).toBe("MEAL_PLAN");

      mocks.authUserId = client.clerkId;
      const res = await exportPdf(mealPlanId);
      expect(res.status).toBe(200);
      expect(mocks.pdfCalls[0].planMode).toBe("MACROS");
      const rendered = resolveMealPlanPdfContent(mocks.pdfCalls[0]);
      expect(rendered.mode).toBe("MACROS");
      expect(rendered.foodItems).toEqual([]);
      expect(rendered.macroTargets.map((t) => t.mealName)).toEqual(["Meal 1", "Meal 2"]);

      expect(await getActiveMealNames(client.id, link.createdAt)).toEqual([
        { mealName: "Meal 1", order: 0 },
        { mealName: "Meal 2", order: 1 },
      ]);

      const [dashPlan, dashMeals] = await Promise.all([
        getCurrentPublishedMealPlan(client.id),
        getActiveMealNames(client.id, link.createdAt),
      ]);
      expect(dashPlan!.planMode).toBe("MACROS");
      expect(dashMeals.map((m) => m.mealName)).toEqual(["Meal 1", "Meal 2"]);

      const currentBody = await (await clientCurrentMealPlan()).json();
      expect(currentBody.mealPlan.planMode).toBe("MACROS");
      expect(currentBody.mealPlan.macroTargets.map((t: { mealName: string }) => t.mealName)).toEqual(["Meal 1", "Meal 2"]);
    });
  });

  // ── 7. Auth ladder on the REST GET ─────────────────────────────────────────

  describe("auth ladder (REST GET)", () => {
    it("403s a coach with no CoachClient assignment, and leaks neither new field", async () => {
      const { client } = await fixture();
      const strangerClerkId = randomUUID();
      await db.user.create({ data: { clerkId: strangerClerkId, email: `stranger-${strangerClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
      mocks.authUserId = strangerClerkId;

      const res = await restGet(client.id, WEEK_A);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(Object.hasOwn(body, "editorMode")).toBe(false);
      expect(Object.hasOwn(body, "clientPlanMode")).toBe(false);
    });

    it("403s a non-coach", async () => {
      const { client } = await fixture();
      mocks.authUserId = client.clerkId;

      const res = await restGet(client.id, WEEK_A);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(Object.hasOwn(body, "editorMode")).toBe(false);
      expect(Object.hasOwn(body, "clientPlanMode")).toBe(false);
    });

    it("401s an unauthenticated request", async () => {
      const { client } = await fixture();
      mocks.authUserId = "";

      const res = await restGet(client.id, WEEK_A);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(Object.hasOwn(body, "editorMode")).toBe(false);
      expect(Object.hasOwn(body, "clientPlanMode")).toBe(false);
    });

    it("400s an invalid weekOf without resolving a mode", async () => {
      const { client } = await fixture();

      const res = await restGet(client.id, "garbage");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid weekOf date");
      expect(Object.hasOwn(body, "editorMode")).toBe(false);
      expect(Object.hasOwn(body, "clientPlanMode")).toBe(false);
    });
  });
});
