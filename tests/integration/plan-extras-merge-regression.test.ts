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
import { saveDraftMealPlan } from "@/app/actions/meal-plans";
import { PUT as putMealPlanRest } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { db } from "@/lib/db";

/**
 * T-841 regression suite. Run through the local test DB:
 *   DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
 *   SECURITY_INTEGRATION=1 pnpm exec vitest run tests/integration/plan-extras-merge-regression.test.ts
 *
 * Case 1 ("THE NEGATIVE CONTROL") must FAIL on unmodified
 * hotfix/T-800-publish-plan-mode (and on origin/main) — see
 * board/reviews/T-841-web-engineer-r1.md for the failing run.
 */

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("T-841: planExtras save merges key-wise instead of replacing wholesale", () => {
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

  const seededExtras = {
    metadata: {
      phase: "cutting",
      startDate: "2026-09-14",
      bodyweight: "173 lbs",
      coachNotes: "Hit protein first",
      highlightedChanges: "more carbs on Monday",
    },
    dayOverrides: [{ label: "High Carb Day", color: "blue", weekdays: ["Monday"] }],
    confidence: { meals: 0.92 },
  };

  // The exact payload the shipped iOS build sends: mealPlanId, planNotes:"",
  // one item, and a planExtras object carrying only dayOverrides — no
  // metadata, no confidence (see PlanWorkspaceViewModel.swift:161-170 and
  // Models/MealPlan.swift:177-180 on ios origin/main).
  function iosShapedPayload(mealPlanId: string) {
    return {
      mealPlanId,
      planNotes: "",
      items: [
        { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
      ],
      planExtras: { dayOverrides: [{ label: "Refeed", color: "blue", weekdays: ["Friday"] }] },
    };
  }

  async function seedDraftWithExtras(clientId: string, extras: unknown, weekOf = new Date("2026-09-14T00:00:00Z")) {
    return db.mealPlan.create({
      data: {
        clientId,
        weekOf,
        version: 1,
        status: "DRAFT",
        planMode: "MEAL_PLAN",
        planExtras: extras as never,
        items: {
          create: [
            { mealName: "Meal 1", sortOrder: 0, foodName: "Old food", quantity: "1", unit: "unit", calories: 100, protein: 10, carbs: 10, fats: 1 },
          ],
        },
      },
    });
  }

  it("case 1 — THE NEGATIVE CONTROL: an iOS save with only dayOverrides must not destroy metadata/confidence", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraftWithExtras(client.id, seededExtras);

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(iosShapedPayload(draft.id)),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });
    const extras = row.planExtras as typeof seededExtras;

    expect(extras.metadata.phase).toBe("cutting");
    expect(extras.metadata.startDate).toBe("2026-09-14");
    expect(extras.metadata.bodyweight).toBe("173 lbs");
    expect(extras.metadata.coachNotes).toBe("Hit protein first");
    expect(extras.metadata.highlightedChanges).toBe("more carbs on Monday");
    expect(extras.confidence.meals).toBe(0.92);
    expect(extras.dayOverrides[0].label).toBe("Refeed");
  });

  it("case 2 — parity: the web Server Action save path produces a byte-identical stored result for the same effective payload", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraftWithExtras(client.id, seededExtras, new Date("2026-09-21T00:00:00Z"));

    const result = await saveDraftMealPlan({
      mealPlanId: draft.id,
      items: [
        { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz", calories: 280, protein: 52, carbs: 0, fats: 6 },
      ],
      planExtras: { dayOverrides: [{ label: "Refeed", color: "blue", weekdays: ["Friday"] }] },
    });
    expect(result).toEqual({ success: true });

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });

    // Byte-identical to what case 1 produces for the REST route given the
    // same effective payload — proves both surfaces call mergePlanExtras.
    expect(row.planExtras).toEqual({
      metadata: seededExtras.metadata,
      confidence: seededExtras.confidence,
      dayOverrides: [{ label: "Refeed", color: "blue", weekdays: ["Friday"] }],
    });
  });

  it("case 3 — web regression: a full-object payload (incl. metadata) still replaces metadata wholesale; the clear-highlighted-changes affordance still works", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraftWithExtras(client.id, seededExtras, new Date("2026-09-28T00:00:00Z"));

    // Web's "clear highlighted changes" affordance: rebuilds the whole
    // metadata object with the sub-key deleted, and sends it as a complete
    // top-level metadata object (the normal web save shape).
    const result = await saveDraftMealPlan({
      mealPlanId: draft.id,
      planExtras: {
        metadata: {
          phase: "cutting",
          startDate: "2026-09-14",
          bodyweight: "173 lbs",
          coachNotes: "Hit protein first",
          // highlightedChanges omitted — this is the "clear" affordance
        },
        dayOverrides: seededExtras.dayOverrides,
        confidence: seededExtras.confidence,
      },
    });
    expect(result).toEqual({ success: true });

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });
    const extras = row.planExtras as { metadata: { highlightedChanges?: string; phase?: string } };
    expect(extras.metadata.phase).toBe("cutting");
    expect(extras.metadata.highlightedChanges).toBeUndefined();
  });

  it("case 4 — clearing overrides: dayOverrides: [] clears the overrides array while metadata survives", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraftWithExtras(client.id, seededExtras, new Date("2026-10-05T00:00:00Z"));

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: draft.id, planExtras: { dayOverrides: [] } }),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });
    const extras = row.planExtras as typeof seededExtras;
    expect(extras.dayOverrides).toEqual([]);
    expect(extras.metadata).toEqual(seededExtras.metadata);
  });

  it("case 5 — omitted key: a payload with items only (no planExtras key) leaves the column deep-equal to before", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraftWithExtras(client.id, seededExtras, new Date("2026-10-12T00:00:00Z"));

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealPlanId: draft.id,
          items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "New food", quantity: "1", unit: "unit", calories: 200, protein: 20, carbs: 20, fats: 2 }],
        }),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.planExtras).toEqual(seededExtras);
  });

  it("case 6 — explicit null: planExtras: null is a documented no-op, column deep-equal to before", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraftWithExtras(client.id, seededExtras, new Date("2026-10-19T00:00:00Z"));

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: draft.id, planExtras: null }),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.planExtras).toEqual(seededExtras);
  });

  it("case 7 — legacy row: an iOS-shaped save preserves unknown legacy top-level keys verbatim", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const legacyExtras = {
      rules: ["Drink 3L"],
      supplements: [{ name: "Creatine" }],
      metadata: { phase: "cutting" },
    };
    const draft = await seedDraftWithExtras(client.id, legacyExtras, new Date("2026-10-26T00:00:00Z"));

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(iosShapedPayload(draft.id)),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } });
    const extras = row.planExtras as typeof legacyExtras & { dayOverrides: unknown[] };
    expect(extras.rules).toEqual(legacyExtras.rules);
    expect(extras.supplements).toEqual(legacyExtras.supplements);
    expect(extras.metadata).toEqual(legacyExtras.metadata);
    expect(extras.dayOverrides).toEqual([{ label: "Refeed", color: "blue", weekdays: ["Friday"] }]);
  });

  it("case 8 — macros-mode regression: a macroTargets-only save (no planExtras) replaces macro targets, leaves planExtras and items untouched", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date("2026-11-02T00:00:00Z"),
        version: 1,
        status: "DRAFT",
        planMode: "MACROS",
        planExtras: seededExtras as never,
        items: {
          create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Untouched food", quantity: "1", unit: "unit", calories: 100, protein: 10, carbs: 10, fats: 1 }],
        },
        macroTargets: {
          create: [{ mealName: "Breakfast", sortOrder: 0, calories: 400, protein: 30, carbs: 40, fats: 10 }],
        },
      },
    });

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealPlanId: draft.id,
          macroTargets: [{ mealName: "Breakfast", sortOrder: 0, calories: 500, protein: 40, carbs: 50, fats: 15 }],
        }),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({
      where: { id: draft.id },
      include: { macroTargets: true, items: true },
    });
    expect(row.planExtras).toEqual(seededExtras);
    expect(row.items).toHaveLength(1);
    expect(row.items[0].foodName).toBe("Untouched food");
    expect(row.macroTargets).toHaveLength(1);
    expect(row.macroTargets[0].calories).toBe(500);
  });

  it("case 9 — authorization regression: 403 for another coach's client with no write, 401 unauthenticated, 403 non-coach; the added select does not move the auth boundary", async () => {
    const { client } = await fixture();
    const draft = await seedDraftWithExtras(client.id, seededExtras, new Date("2026-11-09T00:00:00Z"));

    // Another coach, not assigned to this client.
    const otherCoachId = randomUUID();
    const otherCoach = await db.user.create({ data: { clerkId: otherCoachId, email: `${otherCoachId}@example.test`, isCoach: true, activeRole: "COACH" } });
    mocks.authUserId = otherCoach.clerkId;

    const forbiddenResponse = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: draft.id, planExtras: { metadata: { phase: "bulking" } } }),
      }),
      params(client.id)
    );
    expect(forbiddenResponse.status).toBe(403);
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } })).planExtras).toEqual(seededExtras);

    // Unauthenticated.
    mocks.authUserId = "";
    const unauthResponse = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: draft.id, planExtras: { metadata: { phase: "bulking" } } }),
      }),
      params(client.id)
    );
    expect(unauthResponse.status).toBe(401);
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } })).planExtras).toEqual(seededExtras);

    // Authenticated but not a coach.
    const nonCoachId = randomUUID();
    const nonCoachUser = await db.user.create({ data: { clerkId: nonCoachId, email: `${nonCoachId}@example.test`, isClient: true } });
    mocks.authUserId = nonCoachUser.clerkId;
    const nonCoachResponse = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId: draft.id, planExtras: { metadata: { phase: "bulking" } } }),
      }),
      params(client.id)
    );
    expect(nonCoachResponse.status).toBe(403);
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: draft.id } })).planExtras).toEqual(seededExtras);
  });

  it("case 10 — items/macroTargets replacement unchanged when planExtras is also present in the same request", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date("2026-11-16T00:00:00Z"),
        version: 1,
        status: "DRAFT",
        planMode: "MEAL_PLAN",
        planExtras: seededExtras as never,
        items: {
          create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Old food", quantity: "1", unit: "unit", calories: 100, protein: 10, carbs: 10, fats: 1 }],
        },
        macroTargets: {
          create: [{ mealName: "Breakfast", sortOrder: 0, calories: 400, protein: 30, carbs: 40, fats: 10 }],
        },
      },
    });

    const response = await putMealPlanRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/meal-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealPlanId: draft.id,
          items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "New food", quantity: "2", unit: "unit", calories: 250, protein: 25, carbs: 25, fats: 5 }],
          macroTargets: [{ mealName: "Lunch", sortOrder: 0, calories: 600, protein: 50, carbs: 60, fats: 20 }],
          planExtras: { dayOverrides: [{ label: "Refeed" }] },
        }),
      }),
      params(client.id)
    );
    expect(response.status).toBe(200);

    const row = await db.mealPlan.findUniqueOrThrow({
      where: { id: draft.id },
      include: { items: true, macroTargets: true },
    });
    expect(row.items).toHaveLength(1);
    expect(row.items[0].foodName).toBe("New food");
    expect(row.macroTargets).toHaveLength(1);
    expect(row.macroTargets[0].mealName).toBe("Lunch");
    const extras = row.planExtras as typeof seededExtras;
    expect(extras.metadata).toEqual(seededExtras.metadata);
    expect(extras.dayOverrides).toEqual([{ label: "Refeed" }]);
  });
});
