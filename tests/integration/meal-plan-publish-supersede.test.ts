import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const mocks = vi.hoisted(() => ({
  authUserId: "",
  notifySms: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: mocks.notifySms }));

import { NextRequest } from "next/server";
import { publishMealPlan, saveDraftMealPlan } from "@/app/actions/meal-plans";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/meal-plan/publish/route";
import { GET as exportMealPlan } from "@/app/api/mealplans/[mealPlanId]/export/route";
import { db } from "@/lib/db";

const PUBLISHED_MEAL_PLAN_INDEX = "MealPlan_one_published_per_client_week";
const enabled = process.env.SECURITY_INTEGRATION === "1";

if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}

const suite = enabled ? describe : describe.skip;

suite("T-952a meal-plan publish supersede", () => {
  beforeAll(async () => {
    // Production already has this enum value from the migration deployed ahead
    // of 973c955. The local test database must mirror that production state.
    await db.$executeRawUnsafe(
      `ALTER TYPE "MealPlanStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED'`
    );
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${PUBLISHED_MEAL_PLAN_INDEX}" ON "MealPlan"("clientId","weekOf") WHERE (status = 'PUBLISHED')`
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifySms.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function fixture() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({
      data: {
        clerkId: coachClerkId,
        email: `coach-${coachClerkId}@example.test`,
        isCoach: true,
        activeRole: "COACH",
      },
    });
    const clientClerkId = randomUUID();
    const client = await db.user.create({
      data: {
        clerkId: clientClerkId,
        email: `client-${clientClerkId}@example.test`,
        isClient: true,
      },
    });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;
    return { client };
  }

  async function createPlan(args: {
    clientId: string;
    weekOf: Date;
    version: number;
    status?: "DRAFT" | "PUBLISHED";
    withItem?: boolean;
  }) {
    return db.mealPlan.create({
      data: {
        clientId: args.clientId,
        weekOf: args.weekOf,
        version: args.version,
        status: args.status ?? "DRAFT",
        publishedAt: args.status === "PUBLISHED" ? new Date() : null,
        ...(args.withItem === false
          ? {}
          : {
              items: {
                create: {
                  mealName: "Meal 1",
                  sortOrder: 0,
                  foodName: "Fixture food",
                  quantity: "1",
                  unit: "serving",
                  calories: 100,
                  protein: 10,
                  carbs: 10,
                  fats: 1,
                },
              },
            }),
      },
    });
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  function publishRequest(clientId: string, mealPlanId: string) {
    return new NextRequest(
      `https://example.test/api/coach/clients/${clientId}/meal-plan/publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlanId }),
      }
    );
  }

  async function expectSinglePublished(args: {
    clientId: string;
    weekOf: Date;
    previousId: string;
    replacementId: string;
  }) {
    const rows = await db.mealPlan.findMany({
      where: { clientId: args.clientId, weekOf: args.weekOf },
      select: { id: true, status: true },
      orderBy: { version: "asc" },
    });

    expect(rows).toEqual([
      { id: args.previousId, status: "SUPERSEDED" },
      { id: args.replacementId, status: "PUBLISHED" },
    ]);
    expect(rows.filter((row) => row.status === "PUBLISHED")).toHaveLength(1);
  }

  async function supersededFixture(weekOf: Date) {
    const { client } = await fixture();
    const previous = await createPlan({
      clientId: client.id,
      weekOf,
      version: 1,
      status: "PUBLISHED",
    });
    const replacement = await createPlan({ clientId: client.id, weekOf, version: 2 });
    await expect(publishMealPlan({ mealPlanId: replacement.id })).resolves.toEqual({
      success: true,
    });
    return { client, previous, replacement };
  }

  it("server action re-publishes a week by superseding its previous published plan", async () => {
    const { client } = await fixture();
    const weekOf = new Date("2026-10-05T00:00:00.000Z");
    const previous = await createPlan({
      clientId: client.id,
      weekOf,
      version: 1,
      status: "PUBLISHED",
    });
    const replacement = await createPlan({ clientId: client.id, weekOf, version: 2 });

    await expect(publishMealPlan({ mealPlanId: replacement.id })).resolves.toEqual({
      success: true,
    });

    await expectSinglePublished({
      clientId: client.id,
      weekOf,
      previousId: previous.id,
      replacementId: replacement.id,
    });
  });

  it("REST re-publishes a week through the same supersede behavior", async () => {
    const { client } = await fixture();
    const weekOf = new Date("2026-10-12T00:00:00.000Z");
    const previous = await createPlan({
      clientId: client.id,
      weekOf,
      version: 1,
      status: "PUBLISHED",
    });
    const replacement = await createPlan({ clientId: client.id, weekOf, version: 2 });

    const response = await publishRest(
      publishRequest(client.id, replacement.id),
      params(client.id)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    await expectSinglePublished({
      clientId: client.id,
      weekOf,
      previousId: previous.id,
      replacementId: replacement.id,
    });
  });

  it("keeps the T-800 empty-plan guard on both entry points", async () => {
    const { client } = await fixture();
    const weekOf = new Date("2026-10-19T00:00:00.000Z");
    const emptyPlan = await createPlan({
      clientId: client.id,
      weekOf,
      version: 1,
      withItem: false,
    });

    await expect(publishMealPlan({ mealPlanId: emptyPlan.id })).rejects.toThrow(
      "Add at least one food before publishing."
    );

    const response = await publishRest(
      publishRequest(client.id, emptyPlan.id),
      params(client.id)
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Add at least one food before publishing.",
      code: "PLAN_EMPTY",
    });

    const unchanged = await db.mealPlan.findUniqueOrThrow({
      where: { id: emptyPlan.id },
      select: { status: true, publishedAt: true },
    });
    expect(unchanged).toEqual({ status: "DRAFT", publishedAt: null });
  });

  it("the save action can deserialize a just-superseded plan", async () => {
    const { previous } = await supersededFixture(
      new Date("2026-10-26T00:00:00.000Z")
    );

    await expect(
      saveDraftMealPlan({
        mealPlanId: previous.id,
        supportContent: "Superseded plan read regression",
      })
    ).resolves.toEqual({ success: true });

    await expect(
      db.mealPlan.findUniqueOrThrow({
        where: { id: previous.id },
        select: { status: true },
      })
    ).resolves.toEqual({ status: "SUPERSEDED" });
  });

  it("the PDF export route can deserialize a just-superseded plan", async () => {
    const { previous } = await supersededFixture(
      new Date("2026-11-02T00:00:00.000Z")
    );

    const response = await exportMealPlan(
      new NextRequest(`https://example.test/api/mealplans/${previous.id}/export`),
      { params: Promise.resolve({ mealPlanId: previous.id }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
