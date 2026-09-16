import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-730 — the import route's publish-failure mapping, deterministically.
 *
 * `tests/integration/meal-plan-import-parity.test.ts` drives the race with real
 * concurrency and asserts the invariants that hold however PostgreSQL schedules
 * the two transactions. It cannot pin the 409 itself: two imports publishing
 * two DIFFERENT drafts of the same week legitimately serialize (the second's
 * supersede demotes the first, both succeed), and probing 25 concurrent pairs
 * against the local database produced 50/50 HTTP 200 — zero lost races. So the
 * new `PUBLISH_RACE_LOST` contract row would otherwise ship with no test at all.
 *
 * Same remedy T-660 used for the identical problem in
 * tests/unit/meal-plan-publish-race.test.ts: mock the boundary and assert the
 * mapping. Here only `publishMealPlanTarget` is stubbed — the database, the
 * auth ladder and `createMealPlanDraft` are all real, which is what lets this
 * file prove the load-bearing ORDERING claim (spec risk 2): on a failed publish
 * the bookkeeping writes must not have run, or the coach's retry hits the
 * "Already imported" 400 and the import is stranded.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  publishTarget: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/meal-plans/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meal-plans/publish")>()),
  publishMealPlanTarget: mocks.publishTarget,
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as importPlanRoute } from "@/app/api/mealplans/import-plan/route";
import { getCurrentWeekMonday } from "@/lib/utils/date";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const WEEK_OF = getCurrentWeekMonday();

const doc = () => ({
  title: "Imported Week",
  meals: [{ name: "Meal 1", items: [{ food: "Oats", portion: "80 g" }] }],
});

suite("import-plan publish-failure mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterAll(async () => { await db.$disconnect(); });

  async function fixture() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;

    const upload = await db.mealPlanUpload.create({
      data: { coachId: coach.id, clientId: client.id, storagePath: `meal-plan-uploads/${randomUUID()}.pdf`, status: "NEEDS_REVIEW" },
    });
    const draft = await db.mealPlanDraft.create({ data: { uploadId: upload.id, parsedJson: doc() } });
    return { coach, client, upload, draft };
  }

  const importPlan = (body: unknown) =>
    importPlanRoute(
      new NextRequest("https://example.test/api/mealplans/import-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  it("maps RACE_LOST to T-660's frozen 409 body and leaves the upload retryable", async () => {
    const { client, upload, draft } = await fixture();
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "RACE_LOST" });

    const response = await importPlan({ draftId: draft.id, publish: true });

    expect(response.status).toBe(409);
    // Byte-identical to the other two publish surfaces — the coach gets an
    // actionable sentence instead of the old generic "Unique constraint failed".
    expect(await response.json()).toEqual({
      error: "This plan was already published or changed by someone else",
      code: "PUBLISH_RACE_LOST",
    });

    // The bookkeeping writes are genuinely AFTER the publish.
    expect((await db.mealPlanUpload.findUniqueOrThrow({ where: { id: upload.id } })).status).toBe("NEEDS_REVIEW");

    // By design the just-created DRAFT stays (deleting it would add a
    // compensating write with its own failure mode). Nothing is published.
    const plans = await db.mealPlan.findMany({ where: { clientId: client.id } });
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe("DRAFT");
    expect(plans[0].publishedAt).toBeNull();
  });

  it("does not persist the coach's parsedJson override when the publish failed", async () => {
    const { upload, draft } = await fixture();
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "RACE_LOST" });

    const override = { ...doc(), supportContent: "Edited in the review screen" };
    expect((await importPlan({ draftId: draft.id, parsedJson: override, publish: true })).status).toBe(409);

    const stored = await db.mealPlanDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect((stored.parsedJson as { supportContent?: string }).supportContent).toBeUndefined();
    expect((await db.mealPlanUpload.findUniqueOrThrow({ where: { id: upload.id } })).status).toBe("NEEDS_REVIEW");
  });

  it("maps NOT_DRAFT to the frozen PLAN_NOT_DRAFT 409", async () => {
    const { draft } = await fixture();
    // Unreachable in practice (the row was created microseconds earlier by
    // createMealPlanDraft, which only ever writes DRAFT), but the branch exists
    // and must return the same string as the other publish surfaces.
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "NOT_DRAFT", status: "PUBLISHED" });

    const response = await importPlan({ draftId: draft.id, publish: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" });
  });

  it("calls publishMealPlanTarget with the freshly created draft, this client and this week", async () => {
    const { client, draft } = await fixture();
    mocks.publishTarget.mockImplementation(async (target: { id: string }) => ({
      ok: true,
      mealPlanId: target.id,
      clientId: client.id,
      weekOf: WEEK_OF,
      publishedAt: new Date(),
      supersededCount: 0,
    }));

    const response = await importPlan({ draftId: draft.id, publish: true });
    expect(response.status).toBe(200);
    const { mealPlanId } = await response.json();

    expect(mocks.publishTarget).toHaveBeenCalledTimes(1);
    expect(mocks.publishTarget).toHaveBeenCalledWith({
      id: mealPlanId,
      clientId: client.id,
      weekOf: WEEK_OF,
      status: "DRAFT",
    });
  });

  it("never calls the publish service when the request did not ask to publish", async () => {
    const { draft } = await fixture();

    expect((await importPlan({ draftId: draft.id, publish: false })).status).toBe(200);
    expect((await importPlan({ draftId: (await fixture()).draft.id })).status).toBe(200);

    expect(mocks.publishTarget).not.toHaveBeenCalled();
  });
});
