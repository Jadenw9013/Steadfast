import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-101 — the shared meal-plan draft lifecycle service
 * (`lib/meal-plans/drafts.ts`) is the single source of truth behind BOTH the
 * web Server Actions and the iOS-facing REST route. What this suite pins down:
 *
 *  - switching between foods mode and macros mode across weekly versions is
 *    non-destructive (the ticket's headline criterion),
 *  - the action and the route write identical rows for identical input,
 *  - CB04 fork-on-published carries forward every part the payload omits,
 *  - copy-forward is the default and never reaches across to a later week
 *    (audit note 2),
 *  - `supportContent` / `planNotes` is visible and writable over REST
 *    (audit note 1),
 *  - `planMode` is explicit, never inferred from which array was sent.
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
import { createDraftMealPlan, saveDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import {
  GET as getMealPlanRest,
  POST as createDraftRest,
  PUT as saveDraftRest,
} from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { createMealPlanDraft, findCarryForwardSource } from "@/lib/meal-plans/drafts";
import { PUBLISHED_MEAL_PLAN_INDEX } from "@/lib/meal-plans/publish";

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

suite("meal-plan draft lifecycle (shared service, action vs REST)", () => {
  // Same self-heal as tests/integration/meal-plan-publish-parity.test.ts: the
  // partial unique index is raw SQL in a migration that `db push` neither
  // creates nor preserves, and this suite publishes. Guarded by the local-DB
  // check above.
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

  const postRest = (clientId: string, body: unknown) =>
    createDraftRest(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      params(clientId)
    );

  const putRest = (clientId: string, body: unknown) =>
    saveDraftRest(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      params(clientId)
    );

  const getRest = (clientId: string, weekOf?: string) =>
    getMealPlanRest(
      new NextRequest(
        `https://example.test/api/coach/clients/${clientId}/meal-plan${weekOf ? `?weekOf=${weekOf}` : ""}`
      ),
      params(clientId)
    );

  const planWithContent = (id: string) =>
    db.mealPlan.findUniqueOrThrow({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        macroTargets: { orderBy: { sortOrder: "asc" } },
      },
    });

  /** Comparable content shape — drops row identity and timestamps. */
  function comparable(plan: Awaited<ReturnType<typeof planWithContent>>) {
    return {
      weekOf: plan.weekOf.toISOString(),
      version: plan.version,
      status: plan.status,
      planMode: plan.planMode,
      supportContent: plan.supportContent,
      planExtras: plan.planExtras,
      items: plan.items.map((i) => ({
        mealName: i.mealName, sortOrder: i.sortOrder, foodName: i.foodName, quantity: i.quantity,
        unit: i.unit, servingDescription: i.servingDescription,
        calories: i.calories, protein: i.protein, carbs: i.carbs, fats: i.fats,
      })),
      macroTargets: plan.macroTargets.map((t) => ({
        mealName: t.mealName, sortOrder: t.sortOrder,
        calories: t.calories, protein: t.protein, carbs: t.carbs, fats: t.fats,
      })),
    };
  }

  const ITEMS = [
    { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
    { mealName: "Meal 2", sortOrder: 1, foodName: "White rice", quantity: "1", unit: "cup", calories: 205, protein: 4, carbs: 45, fats: 0 },
  ];
  const MACROS = [
    { mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
    { mealName: "Lunch", sortOrder: 1, calories: 700, protein: 55, carbs: 70, fats: 20 },
  ];

  // ── Headline criterion: mode switching is non-destructive across weeks ──────

  it("round trip: foods → macro → publish → foods keeps the original foods", async () => {
    const { client } = await fixture();

    // Week A — a foods plan, published.
    const weekA = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: ITEMS });
    await publishMealPlan({ mealPlanId: weekA.mealPlanId });
    const publishedASnapshot = comparable(await planWithContent(weekA.mealPlanId));

    // Week B — the coach switches to macros. No `items` in the payload, which
    // used to silently drop every food from the new weekly version.
    const weekB = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_B,
      macroTargets: MACROS,
      planMode: "MACROS",
    });
    const draftB = await planWithContent(weekB.mealPlanId);
    expect(draftB.planMode).toBe("MACROS");
    expect(draftB.macroTargets.map((t) => t.mealName)).toEqual(["Breakfast", "Lunch"]);
    expect(draftB.items.map((i) => i.foodName)).toEqual(["Chicken breast", "White rice"]);
    // Week A's published content is untouched.
    expect(comparable(await planWithContent(weekA.mealPlanId))).toEqual(publishedASnapshot);

    await publishMealPlan({ mealPlanId: weekB.mealPlanId });
    const publishedBSnapshot = comparable(await planWithContent(weekB.mealPlanId));

    // Week C — back to foods. The macro targets must survive.
    const newItems = [
      { mealName: "Meal 1", sortOrder: 0, foodName: "Salmon", quantity: "5", unit: "oz", calories: 300, protein: 40, carbs: 0, fats: 15 },
    ];
    const weekC = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_C,
      items: newItems,
      planMode: "MEAL_PLAN",
    });
    const draftC = await planWithContent(weekC.mealPlanId);
    expect(draftC.planMode).toBe("MEAL_PLAN");
    expect(draftC.items.map((i) => i.foodName)).toEqual(["Salmon"]);
    expect(draftC.macroTargets.map((t) => ({ mealName: t.mealName, calories: t.calories, sortOrder: t.sortOrder }))).toEqual([
      { mealName: "Breakfast", calories: 500, sortOrder: 0 },
      { mealName: "Lunch", calories: 700, sortOrder: 1 },
    ]);
    expect(comparable(await planWithContent(weekB.mealPlanId))).toEqual(publishedBSnapshot);
  });

  it("macro targets survive a foods-mode publish", async () => {
    const { client } = await fixture();

    const macroWeek = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      macroTargets: MACROS,
      planMode: "MACROS",
    });
    await publishMealPlan({ mealPlanId: macroWeek.mealPlanId });

    const foodsWeek = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_B,
      items: ITEMS,
      planMode: "MEAL_PLAN",
    });
    const draft = await planWithContent(foodsWeek.mealPlanId);
    expect(draft.macroTargets.map(({ mealName, sortOrder, calories, protein, carbs, fats }) => ({ mealName, sortOrder, calories, protein, carbs, fats }))).toEqual(MACROS);
    expect(draft.items).toHaveLength(2);
  });

  // ── The regression that proves the duplication is gone ──────────────────────

  it("action and route write identical rows for identical input", async () => {
    const viaAction = await fixture();
    const actionClient = viaAction.client;
    const actionCoach = viaAction.coach;
    const viaRoute = await fixture();
    const routeClient = viaRoute.client;

    const planExtras = { metadata: { phase: "cutting", coachNotes: "hold protein" } };

    // Create — action.
    mocks.authUserId = actionCoach.clerkId;
    const created = await createDraftMealPlan({
      clientId: actionClient.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      macroTargets: MACROS,
      planMode: "MACROS",
      planExtras,
      supportContent: "Drink 1 gallon of water",
    });

    // Create — route.
    mocks.authUserId = viaRoute.coach.clerkId;
    const createResponse = await postRest(routeClient.id, {
      weekOf: WEEK_A,
      items: ITEMS,
      macroTargets: MACROS,
      planMode: "MACROS",
      planExtras,
      supportContent: "Drink 1 gallon of water",
    });
    expect(createResponse.status).toBe(201);
    const { mealPlan: routePlan } = await createResponse.json();

    expect(comparable(await planWithContent(routePlan.id))).toEqual(
      comparable(await planWithContent(created.mealPlanId))
    );

    // Save — action uses `supportContent`, route uses the `planNotes` alias.
    const editedItems = [{ ...ITEMS[0], foodName: "Turkey breast", sortOrder: 0 }];
    mocks.authUserId = actionCoach.clerkId;
    const saveResult = await saveDraftMealPlan({
      mealPlanId: created.mealPlanId,
      items: editedItems,
      macroTargets: MACROS,
      supportContent: "Updated notes",
    });
    expect(saveResult).toEqual({ success: true });

    mocks.authUserId = viaRoute.coach.clerkId;
    const saveResponse = await putRest(routeClient.id, {
      mealPlanId: routePlan.id,
      items: editedItems,
      macroTargets: MACROS,
      planNotes: "Updated notes",
    });
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toEqual({ success: true });

    expect(comparable(await planWithContent(routePlan.id))).toEqual(
      comparable(await planWithContent(created.mealPlanId))
    );
  });

  // ── CB04 ────────────────────────────────────────────────────────────────────

  it("fork-on-published carries forward every part not in the payload (route)", async () => {
    const { client } = await fixture();
    const planExtras = { metadata: { phase: "bulking" } };

    const created = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      macroTargets: MACROS,
      planExtras,
      supportContent: "Original notes",
    });
    await publishMealPlan({ mealPlanId: created.mealPlanId });
    const publishedSnapshot = comparable(await planWithContent(created.mealPlanId));

    const newItems = [{ ...ITEMS[0], foodName: "Cod", sortOrder: 0 }];
    const response = await putRest(client.id, { mealPlanId: created.mealPlanId, items: newItems });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.forkedNewDraftId).toBeTruthy();

    // Published row byte-identical.
    expect(comparable(await planWithContent(created.mealPlanId))).toEqual(publishedSnapshot);

    const fork = await planWithContent(body.forkedNewDraftId);
    expect(fork.status).toBe("DRAFT");
    expect(fork.items.map((i) => i.foodName)).toEqual(["Cod"]);
    expect(fork.macroTargets.map((t) => t.mealName)).toEqual(["Breakfast", "Lunch"]);
    expect(fork.planExtras).toEqual(planExtras);
    expect(fork.supportContent).toBe("Original notes");
  });

  it("fork-on-published carries forward every part not in the payload (action)", async () => {
    const { client } = await fixture();
    const planExtras = { metadata: { phase: "bulking" } };

    const created = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      macroTargets: MACROS,
      planExtras,
      supportContent: "Original notes",
    });
    await publishMealPlan({ mealPlanId: created.mealPlanId });
    const publishedSnapshot = comparable(await planWithContent(created.mealPlanId));

    const newItems = [{ ...ITEMS[0], foodName: "Cod", sortOrder: 0 }];
    const result = await saveDraftMealPlan({ mealPlanId: created.mealPlanId, items: newItems });
    if (!("forkedNewDraftId" in result) || !result.forkedNewDraftId) throw new Error("expected a fork");

    expect(comparable(await planWithContent(created.mealPlanId))).toEqual(publishedSnapshot);

    const fork = await planWithContent(result.forkedNewDraftId);
    expect(fork.items.map((i) => i.foodName)).toEqual(["Cod"]);
    expect(fork.macroTargets.map((t) => t.mealName)).toEqual(["Breakfast", "Lunch"]);
    expect(fork.planExtras).toEqual(planExtras);
    expect(fork.supportContent).toBe("Original notes");
  });

  // ── Opting out of copy-forward ──────────────────────────────────────────────

  it("startBlank: true produces an empty draft on both surfaces even with a published plan present", async () => {
    const { client } = await fixture();
    const created = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      macroTargets: MACROS,
      planExtras: { metadata: { phase: "cutting" } },
      supportContent: "Notes",
    });
    await publishMealPlan({ mealPlanId: created.mealPlanId });

    const blankAction = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_B, startBlank: true });
    const actionDraft = await planWithContent(blankAction.mealPlanId);
    expect(actionDraft.items).toEqual([]);
    expect(actionDraft.macroTargets).toEqual([]);
    expect(actionDraft.supportContent).toBeNull();
    expect(actionDraft.planExtras).toBeNull();

    const blankRoute = await postRest(client.id, { weekOf: WEEK_C, startBlank: true });
    expect(blankRoute.status).toBe(201);
    const { mealPlan } = await blankRoute.json();
    const routeDraft = await planWithContent(mealPlan.id);
    expect(routeDraft.items).toEqual([]);
    expect(routeDraft.macroTargets).toEqual([]);
    expect(routeDraft.supportContent).toBeNull();
    expect(routeDraft.planExtras).toBeNull();
  });

  it("the legacy copyFromPublished: false still means 'start blank' on the route", async () => {
    const { client } = await fixture();
    const created = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: ITEMS });
    await publishMealPlan({ mealPlanId: created.mealPlanId });

    const response = await postRest(client.id, { weekOf: WEEK_B, copyFromPublished: false });
    expect(response.status).toBe(201);
    const { mealPlan } = await response.json();
    expect((await planWithContent(mealPlan.id)).items).toEqual([]);
  });

  it("an explicit empty items array is not a fallback to the published plan", async () => {
    const { client } = await fixture();
    const created = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      macroTargets: MACROS,
    });
    await publishMealPlan({ mealPlanId: created.mealPlanId });

    const next = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_B, items: [] });
    const draft = await planWithContent(next.mealPlanId);
    expect(draft.items).toEqual([]);
    // ...but the representation the payload did not carry still comes forward.
    expect(draft.macroTargets.map((t) => t.mealName)).toEqual(["Breakfast", "Lunch"]);
  });

  // ── Audit note 2 — week scoping ─────────────────────────────────────────────

  it("copy-forward never reaches across to a later week", async () => {
    const { client } = await fixture();

    // Only week C is published.
    const weekC = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_C, items: ITEMS });
    await publishMealPlan({ mealPlanId: weekC.mealPlanId });

    expect(await findCarryForwardSource(client.id, asDate(WEEK_A))).toBeNull();

    const earlierAction = await createMealPlanDraft({
      clientId: client.id,
      coachId: (await db.coachClient.findFirstOrThrow({ where: { clientId: client.id }, select: { coachId: true } })).coachId,
      weekOf: asDate(WEEK_A),
    });
    expect(earlierAction.copiedFromMealPlanId).toBeNull();
    const earlierDraft = await planWithContent(earlierAction.mealPlanId);
    expect(earlierDraft.items).toEqual([]);
    expect(earlierDraft.macroTargets).toEqual([]);

    // Same answer through the route.
    const routeResponse = await postRest(client.id, { weekOf: WEEK_A });
    expect(routeResponse.status).toBe(201);
    const { mealPlan: routeEarlier } = await routeResponse.json();
    expect((await planWithContent(routeEarlier.id)).items).toEqual([]);

    // Now publish week A too; a week-B draft must copy from A, not from C.
    const weekAPlan = await db.mealPlan.findFirstOrThrow({
      where: { clientId: client.id, weekOf: asDate(WEEK_A), status: "DRAFT" },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    await saveDraftMealPlan({
      mealPlanId: weekAPlan.id,
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Week A food", quantity: "1", unit: "serving", calories: 100, protein: 10, carbs: 10, fats: 1 }],
    });
    await publishMealPlan({ mealPlanId: weekAPlan.id });

    const source = await findCarryForwardSource(client.id, asDate(WEEK_B));
    expect(source?.id).toBe(weekAPlan.id);

    const weekB = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_B });
    expect((await planWithContent(weekB.mealPlanId)).items.map((i) => i.foodName)).toEqual(["Week A food"]);

    const routeB = await postRest(client.id, { weekOf: WEEK_B });
    const { mealPlan: routeBPlan } = await routeB.json();
    expect((await planWithContent(routeBPlan.id)).items.map((i) => i.foodName)).toEqual(["Week A food"]);
  });

  it("GET's published lookup is scoped to the requested week", async () => {
    const { client } = await fixture();
    const weekA = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items: ITEMS });
    await publishMealPlan({ mealPlanId: weekA.mealPlanId });

    // A week with nothing in it is empty, not "here is some other week's plan".
    const otherWeek = await (await getRest(client.id, WEEK_B)).json();
    expect(otherWeek.source).toBe("empty");
    expect(otherWeek.mealPlan).toBeNull();
    expect(otherWeek.publishedId).toBeNull();

    const ownWeek = await (await getRest(client.id, WEEK_A)).json();
    expect(ownWeek.source).toBe("published");
    expect(ownWeek.mealPlan.weekOf).toBe(asDate(WEEK_A).toISOString());
    expect(ownWeek.publishedId).toBe(weekA.mealPlanId);

    // Regression for the current iOS caller, which passes no weekOf at all.
    const noParam = await (await getRest(client.id)).json();
    expect(noParam.source).toBe("published");
    expect(noParam.mealPlan.id).toBe(weekA.mealPlanId);
    expect(noParam.mealPlan.weekOf).toBe(asDate(WEEK_A).toISOString());
  });

  // ── Audit note 1 — plan notes over REST ─────────────────────────────────────

  it("supportContent is visible and writable over REST", async () => {
    const { client } = await fixture();
    const created = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      supportContent: "Written on web",
    });

    const body = await (await getRest(client.id, WEEK_A)).json();
    expect(body.mealPlan.planNotes).toBe("Written on web");
    expect(body.mealPlan.supportContent).toBe("Written on web");

    const notesOf = async () =>
      (await db.mealPlan.findUniqueOrThrow({ where: { id: created.mealPlanId }, select: { supportContent: true } })).supportContent;

    // iOS sends the `planNotes` alias.
    expect((await putRest(client.id, { mealPlanId: created.mealPlanId, planNotes: "from iOS" })).status).toBe(200);
    expect(await notesOf()).toBe("from iOS");

    // An empty string must leave the column alone — iOS sends "" for a plan it
    // loaded before this field existed, and that must not wipe a coach's notes.
    expect((await putRest(client.id, { mealPlanId: created.mealPlanId, planNotes: "" })).status).toBe(200);
    expect(await notesOf()).toBe("from iOS");

    // Both present: the canonical name wins.
    expect(
      (await putRest(client.id, { mealPlanId: created.mealPlanId, supportContent: "canonical", planNotes: "alias" })).status
    ).toBe(200);
    expect(await notesOf()).toBe("canonical");

    // An explicit null clears.
    expect((await putRest(client.id, { mealPlanId: created.mealPlanId, supportContent: null })).status).toBe(200);
    expect(await notesOf()).toBeNull();
  });

  it("an empty-string note never wipes existing notes through the web action either", async () => {
    const { client } = await fixture();
    const created = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      supportContent: "Keep me",
    });
    await saveDraftMealPlan({ mealPlanId: created.mealPlanId, supportContent: "" });
    expect((await planWithContent(created.mealPlanId)).supportContent).toBe("Keep me");
  });

  // Review round 1, finding 3. `meal-plan-editor-v2.tsx`'s `ensureDraft()` sends
  // an explicit `null` when its notes textarea is empty precisely so a coach who
  // clears the box on a new week does not get last week's notes copied back in
  // by carry-forward (and then re-rendered by `router.refresh()`). This pins the
  // create-path contract that fix depends on, and that omitting the field still
  // means copy-forward.
  it("an explicit null note on create means blank, while omitting it still carries forward", async () => {
    const { client } = await fixture();
    const seed = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      supportContent: "Last week's notes",
    });
    await publishMealPlan({ mealPlanId: seed.mealPlanId, notifyClient: false });

    // ensureDraft() with a cleared textarea.
    const cleared = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_B,
      items: ITEMS,
      supportContent: null,
    });
    expect((await planWithContent(cleared.mealPlanId)).supportContent).toBeNull();

    // Untouched (e.g. the macro editor, which never sends the field) still copies.
    const untouched = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_C,
      items: ITEMS,
    });
    expect((await planWithContent(untouched.mealPlanId)).supportContent).toBe("Last week's notes");
  });

  // ── planMode is explicit ────────────────────────────────────────────────────

  it("planMode is explicit, never inferred from which array was sent", async () => {
    const { coach, client } = await fixture();

    // Only `items` in the payload, but MACROS was asked for explicitly.
    const macrosWithItems = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_A,
      items: ITEMS,
      planMode: "MACROS",
    });
    expect((await planWithContent(macrosWithItems.mealPlanId)).planMode).toBe("MACROS");
    await publishMealPlan({ mealPlanId: macrosWithItems.mealPlanId });

    // The carry-forward source above is MACROS; make the CoachClient default
    // disagree and confirm the column — not the copied plan — decides.
    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MEAL_PLAN" },
    });
    const inherited = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_B });
    expect((await planWithContent(inherited.mealPlanId)).planMode).toBe("MEAL_PLAN");

    // And the other direction: CoachClient MACROS, source MEAL_PLAN.
    await publishMealPlan({ mealPlanId: inherited.mealPlanId });
    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MACROS" },
    });
    const inherited2 = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_C });
    expect((await planWithContent(inherited2.mealPlanId)).planMode).toBe("MACROS");
  });

  // ── Existing behavior ───────────────────────────────────────────────────────

  it("the existing no-macro flow is unchanged (action)", async () => {
    const { client } = await fixture();
    const items = [ITEMS[0]];

    const { mealPlanId } = await createDraftMealPlan({ clientId: client.id, weekStartDate: WEEK_A, items });
    const saveResult = await saveDraftMealPlan({ mealPlanId, items });
    expect(saveResult).toEqual({ success: true });
    await publishMealPlan({ mealPlanId });

    const plan = await planWithContent(mealPlanId);
    expect(plan.planMode).toBe("MEAL_PLAN");
    expect(plan.status).toBe("PUBLISHED");
    expect(plan.items).toHaveLength(1);
    expect(plan.macroTargets).toEqual([]);
  });

  it("the existing no-macro flow is unchanged (route)", async () => {
    const { client } = await fixture();
    const items = [ITEMS[0]];

    const createResponse = await postRest(client.id, { weekOf: WEEK_A, items });
    expect(createResponse.status).toBe(201);
    const { mealPlan } = await createResponse.json();
    expect(mealPlan.planMode).toBe("MEAL_PLAN");

    expect((await putRest(client.id, { mealPlanId: mealPlan.id, items })).status).toBe(200);

    const plan = await planWithContent(mealPlan.id);
    expect(plan.planMode).toBe("MEAL_PLAN");
    expect(plan.items).toHaveLength(1);
    expect(plan.macroTargets).toEqual([]);
  });

  // ── Auth ladder ─────────────────────────────────────────────────────────────

  it("the route's auth ladder is unchanged", async () => {
    const { client } = await fixture();
    const { client: stranger } = await fixture();
    // `stranger`'s coach is now the authenticated user, and has no assignment
    // to `client`.
    expect((await getRest(client.id, WEEK_A)).status).toBe(403);
    expect((await postRest(client.id, { weekOf: WEEK_A })).status).toBe(403);
    expect((await putRest(client.id, { mealPlanId: "whatever" })).status).toBe(403);

    // A plan id belonging to a different client is a 403, not a silent write.
    const strangersPlan = await createDraftMealPlan({ clientId: stranger.id, weekStartDate: WEEK_A, items: ITEMS });
    const { client: third } = await fixture();
    const thirdsPlan = await createDraftMealPlan({ clientId: third.id, weekStartDate: WEEK_A, items: [] });
    expect((await putRest(third.id, { mealPlanId: strangersPlan.mealPlanId, items: [] })).status).toBe(403);

    // Unknown plan id → 404.
    expect((await putRest(third.id, { mealPlanId: "does-not-exist", items: [] })).status).toBe(404);

    // Malformed body → 422; unparseable weekOf → 400.
    expect((await putRest(third.id, { mealPlanId: thirdsPlan.mealPlanId, items: "nope" })).status).toBe(422);
    expect((await postRest(third.id, { items: ITEMS })).status).toBe(422);
    expect((await postRest(third.id, { weekOf: "not-a-date" })).status).toBe(400);
  });
});
