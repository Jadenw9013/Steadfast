import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const mocks = vi.hoisted(() => ({ authUserId: "", remove: vi.fn(), deleteIdentity: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
  clerkClient: async () => ({ users: { deleteUser: mocks.deleteIdentity } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ storage: { from: (bucket: string) => ({ remove: (paths: string[]) => mocks.remove(bucket, paths) }) } }) }));
vi.mock("@/lib/account-deletion/billing", () => ({ stopAccountBilling: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { NextRequest } from "next/server";
import { createDraftMealPlan, saveDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { setClientPlanMode } from "@/app/actions/plan-mode";
import {
  GET as getMealPlanRest,
  POST as createDraftRest,
  PUT as saveDraftRest,
} from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/meal-plan/publish/route";
import { POST as setPlanModeRest } from "@/app/api/coach/clients/[clientId]/plan-mode/route";
import { db } from "@/lib/db";
import { purgeUserAccount } from "@/lib/account-deletion/purge";
import { getEffectiveMealPlanForReview, getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("macro-only plan mode with real PostgreSQL constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.deleteIdentity.mockResolvedValue({});
  });
  afterAll(async () => { await db.$disconnect(); });

  async function fixture() {
    const coachId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachId, email: `${coachId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientId, email: `${clientId}@example.test`, isClient: true } });
    // T-665: `link` is returned so tests can pass `link.createdAt` as the
    // required provider gate to `getCurrentPublishedMealPlan` — the link is
    // created before every publish in this file, so `publishedAt >=
    // link.createdAt` always holds.
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    return { coach, client, link };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  it("saves, publishes, and fetches a macro-only plan identically through the web action and the iOS REST route", async () => {
    const { coach, client, link } = await fixture();
    mocks.authUserId = coach.clerkId;

    const macroTargets = [
      { mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
      { mealName: "Lunch", sortOrder: 1, calories: 700, protein: 55, carbs: 70, fats: 20 },
    ];

    // Created via the web Server Action, explicitly in MACROS mode
    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      macroTargets,
      planMode: "MACROS",
    });

    await publishMealPlan({ mealPlanId });

    // Read back through the web query module (feeds SimpleMealPlan / MealPlanEditorV2)
    const web = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    expect(web?.planMode).toBe("MACROS");
    expect(web?.macroTargets.map((t) => ({ mealName: t.mealName, calories: t.calories }))).toEqual([
      { mealName: "Breakfast", calories: 500 },
      { mealName: "Lunch", calories: 700 },
    ]);
    expect(web?.items).toEqual([]);

    // Read back through the iOS-facing REST route — must see the exact same data
    const restResponse = await getMealPlanRest(new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`), params(client.id));
    const restBody = await restResponse.json();
    expect(restBody.mealPlan.planMode).toBe("MACROS");
    expect(restBody.mealPlan.macroTargets).toHaveLength(2);
    expect(restBody.mealPlan.macroTargets[0]).toMatchObject({ mealName: "Breakfast", calories: 500, protein: 40, carbs: 50, fats: 15 });
  });

  it("does not disturb an existing meal-plan-only save/publish flow when macroTargets is never passed", async () => {
    const { coach, client, link } = await fixture();
    mocks.authUserId = coach.clerkId;

    const items = [
      { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
    ];

    const { mealPlanId } = await createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-09-14", items });
    const saveResult = await saveDraftMealPlan({ mealPlanId, items });
    expect(saveResult).toEqual({ success: true });
    await publishMealPlan({ mealPlanId });

    const web = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    expect(web?.planMode).toBe("MEAL_PLAN");
    expect(web?.items).toHaveLength(1);
    expect(web?.macroTargets).toEqual([]);
  });

  it("saves macro targets identically when created via the iOS REST route instead of the web action", async () => {
    const { coach, client, link } = await fixture();
    mocks.authUserId = coach.clerkId;

    const createResponse = await createDraftRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekOf: "2026-09-14",
          macroTargets: [{ mealName: "Dinner", sortOrder: 0, calories: 600, protein: 45, carbs: 60, fats: 18 }],
          planMode: "MACROS",
        }),
      }),
      params(client.id)
    );
    expect(createResponse.status).toBe(201);
    const { mealPlan } = await createResponse.json();
    expect(mealPlan.planMode).toBe("MACROS");

    // Overwrite via PUT (save) with a different macro target set
    const saveResponse = await saveDraftRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealPlanId: mealPlan.id,
          macroTargets: [{ mealName: "Dinner", sortOrder: 0, calories: 650, protein: 48, carbs: 62, fats: 19 }],
        }),
      }),
      params(client.id)
    );
    expect(saveResponse.status).toBe(200);

    const publishResponse = await publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: mealPlan.id }),
      }),
      params(client.id)
    );
    expect(publishResponse.status).toBe(200);

    // Read back through the web query module — must match what iOS wrote
    const web = await getEffectiveMealPlanForReview({ coachId: coach.id, clientId: client.id, weekOf: new Date("2026-09-14T00:00:00Z") });
    expect(web.source).toBe("published");
    expect(web.macroTargets).toEqual([{ mealName: "Dinner", calories: 650, protein: 48, carbs: 62, fats: 19 }]);
    // T-102a deleted `EffectiveMealPlan.planMode`. The original assertion here
    // was about the PUBLISHED ROW's own mode — the snapshot iOS wrote — so it
    // moves to that row's source of truth, not to `editorMode`.
    expect((await getCurrentPublishedMealPlan(client.id, link.createdAt))?.planMode).toBe("MACROS");
    // `editorMode` is NOT "MACROS" here, and that is the frozen rule working:
    // publishing consumed the draft, and this coach set `planMode` per-draft
    // without ever toggling `CoachClient.planMode`, so the editor falls back to
    // the client default. Accepted cost, same family as spec risk 4 / T-738.
    // Re-adding the published row's mode to the precedence chain to make this
    // read "MACROS" would break the published-only toggle case.
    expect(web.editorMode).toBe("MEAL_PLAN");
    expect(web.clientPlanMode).toBe("MEAL_PLAN");
  });

  it("toggling plan mode updates the CoachClient default and the current draft, but never a published plan", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // T-102b — fixture content only: publishing a MEAL_PLAN plan with zero
    // items is now rejected by the shared service. The assertions below are
    // about planMode propagation, so the food itself is not meaningful.
    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Fixture food", quantity: "1", unit: "serving", calories: 100, protein: 10, carbs: 10, fats: 1 }],
    });
    await publishMealPlan({ mealPlanId });
    // A second draft for a later week — should pick up the toggle immediately since it's still a draft
    const { mealPlanId: nextDraftId } = await createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-09-21", items: [] });

    const result = await setClientPlanMode({ clientId: client.id, mode: "MACROS" });
    expect(result).toEqual({ success: true });

    expect((await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: coach.id, clientId: client.id } } })).planMode).toBe("MACROS");
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: nextDraftId } })).planMode).toBe("MACROS");
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } })).planMode).toBe("MEAL_PLAN"); // published — untouched

    // A brand-new draft created after the toggle should default to the new mode
    const { mealPlanId: thirdDraftId } = await createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-09-28", items: [] });
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: thirdDraftId } })).planMode).toBe("MACROS");
  });

  it("toggles plan mode identically through the iOS REST route", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const response = await setPlanModeRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/plan-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "MACROS" }),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);
    expect((await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: coach.id, clientId: client.id } } })).planMode).toBe("MACROS");
  });

  // ── T-103: the macro editor can now author plan notes ──────────────────────
  // The macro editor's only server-visible change. Each case sends the exact
  // payload `buildMacroDraftInput` / the save handlers produce, so the
  // create-path `null` vs. save-path `undefined` asymmetry is exercised for
  // real rather than asserted in a unit test alone.

  const MACRO_TARGETS = [
    { mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 },
    { mealName: "Lunch", sortOrder: 1, calories: 700, protein: 55, carbs: 70, fats: 20 },
  ];

  it("macro notes typed by the coach reach the client's macro view", async () => {
    const { coach, client, link } = await fixture();
    mocks.authUserId = coach.clerkId;

    // Exactly what buildMacroDraftInput({ ..., supportContent: "SYNTHETIC coach notes" }) produces.
    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
      supportContent: "SYNTHETIC coach notes",
    });
    await publishMealPlan({ mealPlanId });

    // This is the data components/client/simple-meal-plan.tsx hands to
    // MacroPlanView — before T-103 there was no way to produce this row from
    // the macro editor at all.
    const published = await getCurrentPublishedMealPlan(client.id, link.createdAt);
    expect(published?.planMode).toBe("MACROS");
    expect(published?.macroTargets.map((t) => t.mealName)).toEqual(["Breakfast", "Lunch"]);
    expect(published?.supportContent).toBe("SYNTHETIC coach notes");
  });

  it("saving notes on an existing macro draft updates only the notes", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
      supportContent: "SYNTHETIC v1",
    });

    // The macro editor's save payload.
    await saveDraftMealPlan({
      mealPlanId,
      macroTargets: MACRO_TARGETS,
      supportContent: "SYNTHETIC v2",
    });

    const plan = await db.mealPlan.findUniqueOrThrow({
      where: { id: mealPlanId },
      include: { macroTargets: { orderBy: { sortOrder: "asc" } }, items: true },
    });
    expect(plan.supportContent).toBe("SYNTHETIC v2");
    expect(plan.macroTargets.map((t) => [t.mealName, t.calories])).toEqual([
      ["Breakfast", 500],
      ["Lunch", 700],
    ]);
    expect(plan.items).toEqual([]);
  });

  it("an emptied notes box does not clear saved notes (T-732 semantics preserved)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
      supportContent: "SYNTHETIC keep me",
    });

    // `supportContent: supportContent || undefined` with an empty textarea —
    // byte-identical to what the foods editor has always sent.
    await saveDraftMealPlan({ mealPlanId, macroTargets: MACRO_TARGETS, supportContent: undefined });

    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } })).supportContent).toBe(
      "SYNTHETIC keep me"
    );
  });

  it("an empty notes box on CREATE does not resurrect the previous week's notes (T-101)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // A published foods week carrying notes — the carry-forward source.
    const { mealPlanId: foodsWeekId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Oats", quantity: "80", unit: "g", calories: 300, protein: 10, carbs: 54, fats: 5 }],
      supportContent: "SYNTHETIC previous week notes",
    });
    await publishMealPlan({ mealPlanId: foodsWeekId });

    // Next week, macro mode, empty notes box → explicit null, which must beat
    // the carry-forward. `undefined` here would resurrect the notes above.
    const { mealPlanId: macroWeekId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-21",
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
      supportContent: null,
    });

    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: macroWeekId } })).supportContent).toBeNull();
    // The published week is untouched — carry-forward reads, it never writes.
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: foodsWeekId } })).supportContent).toBe(
      "SYNTHETIC previous week notes"
    );
  });

  it("items are still carried forward into the macro draft", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const { mealPlanId: foodsWeekId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Oats", quantity: "80", unit: "g", calories: 300, protein: 10, carbs: 54, fats: 5 }],
    });
    await publishMealPlan({ mealPlanId: foodsWeekId });

    const { mealPlanId: macroWeekId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-21",
      planMode: "MACROS",
      macroTargets: MACRO_TARGETS,
      supportContent: null,
    });

    // T-101 rule 3 — and what makes the autofill panel appear in macro mode.
    const draft = await db.mealPlan.findUniqueOrThrow({
      where: { id: macroWeekId },
      include: { items: true },
    });
    expect(draft.items.map((i) => i.foodName)).toEqual(["Oats"]);
  });

  it("purge removes MealMacroTarget rows along with the plan", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;
    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      macroTargets: [{ mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 }],
      planMode: "MACROS",
    });
    expect(await db.mealMacroTarget.count({ where: { mealPlanId } })).toBe(1);

    await db.accountDeletionRequest.create({
      data: { userId: client.id, roleAtRequest: "CLIENT", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) },
    });
    await db.user.update({ where: { id: client.id }, data: { isDeactivated: true } });
    await purgeUserAccount(client.id);

    expect(await db.mealMacroTarget.count({ where: { mealPlanId } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: client.id } })).toBeNull();
  });
});
