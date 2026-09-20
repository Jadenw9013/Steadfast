import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-802a — proves the degraded-state defensive arms of `resolveClientPlanView`
 * against real rows produced by the real create/publish path (and, where the
 * publish guard forbids it, rows constructed directly — legacy data the guard
 * postdates), and proves the checkoff contract and the publish guard are
 * unmoved by this ticket.
 *
 * Harness copied verbatim from `tests/integration/plan-mode-consumers.test.ts`
 * (hoisted Clerk mock, `next/cache` mock, sms/email/push mocks, the
 * `SECURITY_INTEGRATION` + `127.0.0.1`/`steadfast_security_test` fail-closed
 * guard, the `PUBLISHED_MEAL_PLAN_INDEX` self-heal, a `fixture()` returning
 * the `CoachClient` row).
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

import { db } from "@/lib/db";
import { createDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { toggleMealCheckoff } from "@/app/actions/adherence";
import { GET as clientCurrentMealPlan } from "@/app/api/client/meal-plan/current/route";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getActiveMealNames } from "@/lib/meal-plans/active-plan";
import { PUBLISHED_MEAL_PLAN_INDEX, emptyPlanMessage } from "@/lib/meal-plans/publish";
import { resolveClientPlanView, isCheckoffEligible, deriveCheckoffNames } from "@/lib/meal-plans/client-plan-view";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

// Mondays.
const WEEK_A = "2026-05-04";
const WEEK_B = "2026-05-11";

const FOOD_ITEMS = [
  { mealName: "Breakfast", sortOrder: 0, foodName: "Oats", quantity: "80", unit: "g", calories: 300, protein: 10, carbs: 54, fats: 6 },
  { mealName: "Lunch", sortOrder: 1, foodName: "Chicken breast", quantity: "200", unit: "g", calories: 330, protein: 62, carbs: 0, fats: 7 },
];

const MACRO_TARGETS = [
  { mealName: "Meal 1", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
  { mealName: "Meal 2", sortOrder: 1, calories: 700, protein: 50, carbs: 70, fats: 20 },
];

suite("client plan degraded render (T-802a)", () => {
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

  async function fixture() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isClient: true, activeRole: "CLIENT" } });
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;
    return { coach, client, link };
  }

  const asClient = (clerkId: string) => { mocks.authUserId = clerkId; };

  it("a legacy MACROS row with no targets and items reaches the reader intact", async () => {
    const { client, link } = await fixture();

    // T-102b's publish guard (lib/meal-plans/publish.ts:105-110) refuses to
    // publish a MACROS plan with zero targets, so this row — the T-800
    // production shape — can only exist as legacy data: constructed directly,
    // bypassing the guard, same as `plan-mode-consumers.test.ts`'s equivalent
    // fixture.
    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date(`${WEEK_A}T00:00:00Z`),
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        planMode: "MACROS",
        items: { create: FOOD_ITEMS },
      },
    });

    const plan = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    expect(plan).not.toBeNull();
    expect(plan!.planMode).toBe("MACROS");
    expect(plan!.macroTargets.length).toBe(0);
    expect(plan!.items.length).toBe(2);

    expect(
      resolveClientPlanView({
        planMode: plan!.planMode,
        itemCount: plan!.items.length,
        macroTargetCount: plan!.macroTargets.length,
      })
    ).toEqual({ body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" });
  });

  it("degraded rows are read-only: zero check-off names/writes while getActiveMealNames stays unchanged (T-802a review r2, MAJOR 1)", async () => {
    // The T-800 production shape again — this time proving the lead's
    // 2026-09-18 "degraded states are read-only" decision (board/tickets/
    // T-802.md), not just the render verdict.
    const { client, link } = await fixture();

    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date(`${WEEK_A}T00:00:00Z`),
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        planMode: "MACROS",
        items: { create: FOOD_ITEMS },
      },
    });

    const plan = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    const view = resolveClientPlanView({
      planMode: plan!.planMode,
      itemCount: plan!.items.length,
      macroTargetCount: plan!.macroTargets.length,
    });
    expect(view).toEqual({ body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" });
    expect(isCheckoffEligible(view)).toBe(false);

    // Exercise the SHARED derivation (`deriveCheckoffNames`,
    // lib/meal-plans/client-plan-view.ts) the shell itself calls, rather than
    // re-implementing the eligibility gate inline here (T-802a review r3,
    // MINOR 1) — this is the boundary the shell actually crosses: real
    // row-shaped `itemCount`/`mealName` data from the reader, fed through the
    // exact function the component uses, both bodies covered.
    const foodsNames = plan!.items.map((i) => i.mealName);
    expect(deriveCheckoffNames(view, foodsNames, [])).toEqual([]);
    // Row 5's mirror shape reaches the same verdict through the MACROS branch
    // of the same function — proves the gate, not just the FOODS-body input.
    expect(
      deriveCheckoffNames({ body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" }, [], foodsNames)
    ).toEqual([]);

    // deriveMealNames / getActiveMealNames — the dashboard/coach-facing
    // checklist source — is untouched by this ticket: still keyed strictly on
    // the DECLARED planMode, still [] for this row, exactly as T-105 pinned.
    const activeNames = await getActiveMealNames(client.id, link.createdAt);
    expect(activeNames).toEqual([]);

    // NOTE (T-802a review r3, MINOR 1): a prior version of this test also
    // asserted `DailyAdherence` stayed null for this client, reasoning that
    // "nothing the shell offers can write here." That assertion was vacuous —
    // this test never attempts a write, so it trivially passed regardless of
    // whether the eligibility gate worked. It is not restored as a "real"
    // write-path check because `toggleMealCheckoff` (app/actions/adherence.ts)
    // has no server-side gate against `deriveCheckoffNames`/`getActiveMealNames`
    // at all — it zod-validates and writes whatever `mealNameSnapshot` it's
    // given, by design (T-802's AC forbids changing check-off writing or
    // adherence counting in this ticket). So there is no write path this test
    // could call that the degraded view "cannot reach" — the read-only
    // guarantee is a UI-only gate, and it is what `deriveCheckoffNames`
    // returning `[]` above (and its direct unit tests) actually proves.
  });

  it("the same row over the wire lets iOS reach the same verdict", async () => {
    // The parity-auditor's first-look assertion: the REST payload's own
    // counts, fed into the same resolver, reach the same verdict the web
    // reader does.
    const { client } = await fixture();

    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date(`${WEEK_A}T00:00:00Z`),
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        planMode: "MACROS",
        items: { create: FOOD_ITEMS },
      },
    });

    asClient(client.clerkId);
    const res = await clientCurrentMealPlan();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.mealPlan.planMode).toBe("MACROS");
    expect(body.mealPlan.macroTargets.length).toBe(0);
    expect(body.mealPlan.items.length).toBe(2);

    expect(
      resolveClientPlanView({
        planMode: body.mealPlan.planMode,
        itemCount: body.mealPlan.items.length,
        macroTargetCount: body.mealPlan.macroTargets.length,
      })
    ).toEqual({ body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" });
  });

  it("the mirror row", async () => {
    // MEAL_PLAN, 0 items, 2 targets — T-802's symmetric extension (§4.1) of
    // T-800's one-directional rule. Same legacy-only reachability as above:
    // T-102b's guard blocks it going forward.
    const { client, link } = await fixture();

    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date(`${WEEK_A}T00:00:00Z`),
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        planMode: "MEAL_PLAN",
        macroTargets: { create: MACRO_TARGETS },
      },
    });

    const plan = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    expect(plan).not.toBeNull();
    expect(plan!.planMode).toBe("MEAL_PLAN");
    expect(plan!.items.length).toBe(0);
    expect(plan!.macroTargets.length).toBe(2);

    expect(
      resolveClientPlanView({
        planMode: plan!.planMode,
        itemCount: plan!.items.length,
        macroTargetCount: plan!.macroTargets.length,
      })
    ).toEqual({ body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" });
  });

  it("carry-forward is NOT degraded", async () => {
    // T-101 made items/macroTargets coexist on every version by design — a
    // MACROS plan that also carries foods forward is the NORMAL case, not a
    // defect. The defensive arms must never fire for it: row 1 of the truth
    // table (targets present) wins before any degradation is considered.
    const { client, link } = await fixture();

    const foods = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: FOOD_ITEMS, startBlank: true });
    await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

    // macro-plan-editor.tsx ensureDraft(), verbatim — planMode + macroTargets
    // only, never items. The shared draft service fills in the missing
    // `items` from the prior published foods plan (T-101 carry-forward).
    const macros = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_B,
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
    });
    await publishMealPlan({ mealPlanId: macros.mealPlanId, notifyClient: false });

    const stored = await db.mealPlan.findUniqueOrThrow({
      where: { id: macros.mealPlanId },
      include: { items: true, macroTargets: true },
    });
    // Precondition: the carry-forward really happened.
    expect(stored.planMode).toBe("MACROS");
    expect(stored.items.length).toBe(FOOD_ITEMS.length);
    expect(stored.macroTargets.length).toBe(MACRO_TARGETS.length);

    const plan = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    expect(
      resolveClientPlanView({
        planMode: plan!.planMode,
        itemCount: plan!.items.length,
        macroTargetCount: plan!.macroTargets.length,
      })
    ).toEqual({ body: "MACROS", degradation: "NONE" });
  });

  it("the publish guard is unchanged", async () => {
    // Proves T-802 did not relax T-102b: publishing a MACROS draft with zero
    // targets still fails with EMPTY_PLAN.
    const { client } = await fixture();

    const draft = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      planMode: "MACROS",
      macroTargets: [],
      startBlank: true,
    });

    await expect(publishMealPlan({ mealPlanId: draft.mealPlanId, notifyClient: false })).rejects.toThrow(
      emptyPlanMessage("MACROS")
    );
  });

  it("the checkoff contract is unchanged", async () => {
    // For the carry-forward plan, getActiveMealNames still returns the
    // macro-target names (not the carried-forward foods), and
    // toggleMealCheckoff for each name twice writes exactly names.length
    // DailyMealCheckoff rows with no P2002.
    const { client, link } = await fixture();

    const foods = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: FOOD_ITEMS, startBlank: true });
    await publishMealPlan({ mealPlanId: foods.mealPlanId, notifyClient: false });

    const macros = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_B,
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
    });
    await publishMealPlan({ mealPlanId: macros.mealPlanId, notifyClient: false });

    const names = await getActiveMealNames(client.id, link.createdAt);
    expect(names.map((n) => n.mealName)).toEqual(["Meal 1", "Meal 2"]);

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
    expect(adherence.meals.map((m) => m.mealNameSnapshot).sort()).toEqual(["Meal 1", "Meal 2"]);
  });
});
