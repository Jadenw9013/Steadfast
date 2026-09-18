import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
  clerkClient: async () => ({ users: { deleteUser: vi.fn() } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { NextRequest } from "next/server";
import { createDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/meal-plan/publish/route";
import { GET as getMealPlanRest } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { GET as getMealPlanCurrentRest } from "@/app/api/client/meal-plan/current/route";
import { db } from "@/lib/db";
import { getCurrentPublishedMealPlan, getEffectiveMealPlanForReview } from "@/lib/queries/meal-plans";
import { buildFoodsDraftInput } from "@/lib/meal-plans/editor-state";
import type { MealGroup } from "@/types/meal-plan";

/**
 * T-800 regression suite. Run through the local test DB:
 *   DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
 *   SECURITY_INTEGRATION=1 pnpm exec vitest run tests/integration/plan-mode-publish-regression.test.ts
 *
 * Case 1 ("the report") must FAIL on origin/main — see
 * board/reviews/T-800-web-engineer-r1.md for the negative-control run.
 */

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("T-800: plan-mode-aware publish never blanks a client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function fixture() {
    const coachId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachId, email: `${coachId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientId, email: `${clientId}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    return { coach, client };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  it("case 1 — the report: CoachClient default MACROS + published MEAL_PLAN plan + publish from the foods editor never blanks the client", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // CoachClient default is MACROS (the invisible, irreversible state the
    // ticket's mechanism describes) but the current published plan is a
    // normal foods plan.
    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MACROS" },
    });

    const weekOf = new Date("2026-09-14T00:00:00Z");
    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf,
        version: 1,
        status: "PUBLISHED",
        planMode: "MEAL_PLAN",
        publishedAt: new Date(),
        items: {
          create: [
            { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
            { mealName: "Meal 1", sortOrder: 1, foodName: "Rice", quantity: "1", unit: "cup", calories: 200, protein: 4, carbs: 45, fats: 0 },
          ],
        },
      },
    });

    // The exact payload the origin/main foods editor sent: items, no planMode.
    const { mealPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      items: [
        { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
        { mealName: "Meal 1", sortOrder: 1, foodName: "Rice", quantity: "1", unit: "cup", calories: 200, protein: 4, carbs: 45, fats: 0 },
      ],
    });

    // Assert the failure boundary itself, not just the survivor: on unfixed
    // origin/main this new draft resolved to MACROS with zero macro targets,
    // and publish had no emptiness guard, so this would succeed and become
    // the new current plan — a bare try/catch around the publish call
    // swallows exactly that success on a database that also carries
    // sprint-1's partial unique index (`MealPlan_one_published_per_client_week`),
    // because the unfixed MACROS-mode publish then collides with the
    // still-PUBLISHED MEAL_PLAN row and throws a unique-constraint error the
    // catch also absorbs, leaving the original good row in place by accident
    // — a false pass with or without the fix (T-800 code-review r1, MAJOR-4).
    // Asserting the guard's own message and that the row stays DRAFT fails on
    // origin/main regardless of whether that index exists.
    const draftRow = await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } });
    expect(draftRow.planMode).toBe("MACROS");
    await expect(publishMealPlan({ mealPlanId })).rejects.toThrow(
      "Add at least one meal with macro targets before publishing."
    );
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } })).status).toBe("DRAFT");

    // Assert the invariant too, not just the mechanism, so this still passes
    // after team/sprint-1 merges (where the draft may be stamped MEAL_PLAN
    // instead of being refused).
    const current = await getCurrentPublishedMealPlan(client.id);
    expect(current).not.toBeNull();
    expect(current!.items.length).toBeGreaterThan(0);
    expect(current!.planMode === "MEAL_PLAN" || current!.macroTargets.length > 0).toBe(true);
  });

  it("case 2 — editor payload: buildFoodsDraftInput always stamps MEAL_PLAN, publish succeeds, client reader shows the items", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MACROS" },
    });

    const meals: MealGroup[] = [
      {
        mealName: "Breakfast",
        items: [
          { id: "a", foodName: "Oats", quantity: "1", unit: "cup", servingDescription: "1 cup", calories: 300, protein: 10, carbs: 50, fats: 5 },
        ],
      },
    ];

    const { mealPlanId } = await createDraftMealPlan(
      buildFoodsDraftInput({
        clientId: client.id,
        weekStartDate: "2026-09-14",
        meals,
        planExtras: null,
        supportContent: "",
      })
    );

    const draftRow = await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } });
    expect(draftRow.planMode).toBe("MEAL_PLAN");

    await publishMealPlan({ mealPlanId });

    const current = await getCurrentPublishedMealPlan(client.id);
    expect(current?.planMode).toBe("MEAL_PLAN");
    expect(current?.items.map((i) => i.foodName)).toEqual(["Oats"]);

    mocks.authUserId = client.clerkId;
    const restResponse = await getMealPlanCurrentRest();
    const restBody = await restResponse.json();
    expect(restBody.mealPlan.planMode).toBe("MEAL_PLAN");
    expect(restBody.mealPlan.items).toHaveLength(1);
  });

  it("case 3 — publish guard rejects empty plans identically through the action and the REST route", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // MACROS draft, 0 targets
    const { mealPlanId: macroDraftId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      planMode: "MACROS",
      macroTargets: [],
    });

    await expect(publishMealPlan({ mealPlanId: macroDraftId })).rejects.toThrow(
      "Add at least one meal with macro targets before publishing."
    );
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: macroDraftId } })).status).toBe("DRAFT");

    const macroPublishResponse = await publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: macroDraftId }),
      }),
      params(client.id)
    );
    expect(macroPublishResponse.status).toBe(409);
    const macroBody = await macroPublishResponse.json();
    expect(macroBody.code).toBe("PLAN_EMPTY");
    expect(macroBody.error).toBe("Add at least one meal with macro targets before publishing.");
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: macroDraftId } })).status).toBe("DRAFT");

    // MEAL_PLAN draft, 0 items
    const { mealPlanId: foodsDraftId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-21",
      planMode: "MEAL_PLAN",
      items: [],
    });

    await expect(publishMealPlan({ mealPlanId: foodsDraftId })).rejects.toThrow(
      "Add at least one food before publishing."
    );

    const foodsPublishResponse = await publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: foodsDraftId }),
      }),
      params(client.id)
    );
    expect(foodsPublishResponse.status).toBe(409);
    const foodsBody = await foodsPublishResponse.json();
    expect(foodsBody.code).toBe("PLAN_EMPTY");
    expect(foodsBody.error).toBe("Add at least one food before publishing.");
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: foodsDraftId } })).status).toBe("DRAFT");

    // Both transports return the exact same message string for the same mode.
    expect(macroBody.error).not.toBe(foodsBody.error);
  });

  it("case 4 — regression: normal publishes still succeed both ways; re-publishing an already-PUBLISHED plan still fails as PLAN_NOT_DRAFT, never PLAN_EMPTY", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const { mealPlanId: foodsId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-14",
      planMode: "MEAL_PLAN",
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 }],
    });
    const publishResult = await publishMealPlan({ mealPlanId: foodsId });
    expect(publishResult).toEqual({ success: true });
    const foodsPlan = await db.mealPlan.findUniqueOrThrow({ where: { id: foodsId } });
    expect(foodsPlan.status).toBe("PUBLISHED");
    expect(foodsPlan.publishedAt).not.toBeNull();
    expect((await getCurrentPublishedMealPlan(client.id))?.id).toBe(foodsId);

    await expect(publishMealPlan({ mealPlanId: foodsId })).rejects.toThrow("Can only publish drafts");

    const { mealPlanId: macroId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-09-21",
      planMode: "MACROS",
      macroTargets: [{ mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 }],
    });
    const macroPublishResponse = await publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: macroId }),
      }),
      params(client.id)
    );
    expect(macroPublishResponse.status).toBe(200);
    const macroPlan = await db.mealPlan.findUniqueOrThrow({ where: { id: macroId } });
    expect(macroPlan.status).toBe("PUBLISHED");
    expect(macroPlan.publishedAt).not.toBeNull();
    expect((await getCurrentPublishedMealPlan(client.id))?.id).toBe(macroId);

    const rePublishResponse = await publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: macroId }),
      }),
      params(client.id)
    );
    expect(rePublishResponse.status).toBe(409);
    const rePublishBody = await rePublishResponse.json();
    expect(rePublishBody.code).toBe("PLAN_NOT_DRAFT");
    expect(rePublishBody.error).toBe("Can only publish drafts");
  });

  it("case 5 — editorMode: the client default wins with no draft, full stop, and both coach-facing transports agree (T-800 code-review r1 MAJOR-1; round-3 removes the r1 MAJOR-2 content-based fallback — board/tickets/T-800.md \"## Decision\")", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MACROS" },
    });

    const weekOf = new Date("2026-09-14T00:00:00Z");
    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf,
        version: 1,
        status: "PUBLISHED",
        planMode: "MEAL_PLAN",
        publishedAt: new Date(),
        items: { create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Chicken", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 }] },
      },
    });

    // No draft: editorMode is server-resolved as `draft?.planMode ??
    // clientPlanMode`, never inferred from the published row's content. The
    // CoachClient default (MACROS) wins even though the published row is a
    // real foods plan — this is the frozen spec's "risk 2" behaviour: the
    // toggle is seeded from editorMode, so the pill truthfully reads "Macros
    // Only" and one labelled tap back to "Meal Plan" both mounts the foods
    // editor and clears the stale default. A content-based fallback here
    // would make the toggle a no-op for this exact scenario (round-2
    // BLOCKER-1) — see board/tickets/T-800-code-reviewer-r2.md §2.
    const noDraft = await getEffectiveMealPlanForReview({ coachId: coach.id, clientId: client.id, weekOf });
    expect(noDraft.editorMode).toBe("MACROS");
    expect(noDraft.clientPlanMode).toBe("MACROS");

    // MAJOR-1: the REST GET route must agree with the web query for the
    // identical seed — before this rework it still resolved the coach's
    // editor from `draft ?? published` and would have disagreed.
    const restNoDraft = await getMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan?weekOf=2026-09-14`),
      params(client.id)
    );
    const restNoDraftBody = await restNoDraft.json();
    expect(restNoDraftBody.editorMode).toBe(noDraft.editorMode);
    expect(restNoDraftBody.clientPlanMode).toBe(noDraft.clientPlanMode);
  });

  it("case 5b — editorMode: a draft's own mode wins over both the client default and the published row's content (real discriminator: fails if a content-based fallback ever leaks into the draft path, round-2 finding 2)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // Client default is MEAL_PLAN (never toggled) and the published plan is
    // an ordinary foods plan — the "foods-published seed". A MACROS draft on
    // top of that must still win: draft mode always wins regardless of what
    // the client default or the published row's content imply. A test whose
    // draft branch used a MEAL_PLAN draft here would pass whether the draft
    // wins or a fallback wins (round-2 finding 2) — using MACROS makes the
    // two disagree.
    const weekOf = new Date("2026-09-14T00:00:00Z");
    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf,
        version: 1,
        status: "PUBLISHED",
        planMode: "MEAL_PLAN",
        publishedAt: new Date(),
        items: { create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Chicken", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 }] },
      },
    });
    await db.mealPlan.create({
      data: { clientId: client.id, weekOf, version: 2, status: "DRAFT", planMode: "MACROS" },
    });

    const withDraft = await getEffectiveMealPlanForReview({ coachId: coach.id, clientId: client.id, weekOf });
    expect(withDraft.editorMode).toBe("MACROS");
    expect(withDraft.clientPlanMode).toBe("MEAL_PLAN");

    const restWithDraft = await getMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan?weekOf=2026-09-14`),
      params(client.id)
    );
    const restWithDraftBody = await restWithDraft.json();
    expect(restWithDraftBody.editorMode).toBe(withDraft.editorMode);
    expect(restWithDraftBody.clientPlanMode).toBe(withDraft.clientPlanMode);
  });

  it("case 8 — deliberate toggle: CoachClient default MACROS over a real foods-published plan gives the coach the macro editor on both transports, but the client route still shows the published row's true content, display-mode MEAL_PLAN (never blanked, round-2 finding 2)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MACROS" },
    });

    const weekOf = new Date("2026-09-14T00:00:00Z");
    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf,
        version: 1,
        status: "PUBLISHED",
        planMode: "MEAL_PLAN",
        publishedAt: new Date(),
        items: {
          create: [
            { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
            { mealName: "Meal 1", sortOrder: 1, foodName: "Rice", quantity: "1", unit: "cup", calories: 200, protein: 4, carbs: 45, fats: 0 },
          ],
        },
      },
    });

    const effective = await getEffectiveMealPlanForReview({ coachId: coach.id, clientId: client.id, weekOf });
    expect(effective.editorMode).toBe("MACROS");
    expect(effective.clientPlanMode).toBe("MACROS");

    const restResponse = await getMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan?weekOf=2026-09-14`),
      params(client.id)
    );
    const restBody = await restResponse.json();
    expect(restBody.editorMode).toBe("MACROS");
    expect(restBody.clientPlanMode).toBe("MACROS");

    // The client-facing route is unaffected by the coach's editor mode: the
    // published row's own planMode is MEAL_PLAN with real items (not
    // mislabeled), so the client still sees the foods plan, never a blank
    // macro card, regardless of what the coach's editor currently shows.
    mocks.authUserId = client.clerkId;
    const clientResponse = await getMealPlanCurrentRest();
    const clientBody = await clientResponse.json();
    expect(clientBody.mealPlan.planMode).toBe("MEAL_PLAN");
    expect(clientBody.mealPlan.items).toHaveLength(2);
  });

  it("case 6 — defensive render: a legacy mislabeled PUBLISHED row is served to the client as MEAL_PLAN with its items intact (merge-guard for team/sprint-1)", async () => {
    const { client } = await fixture();

    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date("2026-09-14T00:00:00Z"),
        version: 1,
        status: "PUBLISHED",
        planMode: "MACROS",
        publishedAt: new Date(),
        items: {
          create: [
            { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
            { mealName: "Meal 1", sortOrder: 1, foodName: "Rice", quantity: "1", unit: "cup", calories: 200, protein: 4, carbs: 45, fats: 0 },
          ],
        },
      },
    });

    mocks.authUserId = client.clerkId;
    const response = await getMealPlanCurrentRest();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mealPlan.planMode).toBe("MEAL_PLAN");
    expect(body.mealPlan.items).toHaveLength(2);
    expect(body.mealPlan.macroTargets).toHaveLength(0);
  });
});
