import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB04/CB05 — published meal plans and training programs must be
 * immutable. Editing published content creates a new draft instead of
 * mutating or demoting the published record; at most one PUBLISHED plan
 * per client/week (and one PUBLISHED training program per client) can
 * exist; concurrent draft creation cannot produce duplicate version
 * numbers.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V03): published content unchanged; one valid transition; metadata/
 * content atomic; distinct concurrent version allocation.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("@/lib/notifications/push", () => ({ pushTrainingProgramPublished: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { createDraftMealPlan, saveDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { saveTrainingProgram, publishTrainingProgram } from "@/app/actions/training-programs";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("CB04/CB05 — published plans are immutable, with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  /** T-102b — fixture content only. `publishMealPlanTarget` now rejects a
   *  MEAL_PLAN plan with zero items, so every draft this file publishes needs
   *  one. Nothing here asserts on plan content except the fork test, which
   *  supplies its own items, so this food is not meaningful test data. */
  const FIXTURE_ITEM = {
    mealName: "Meal 1",
    sortOrder: 0,
    foodName: "Fixture food",
    quantity: "1",
    unit: "serving",
    calories: 100,
    protein: 10,
    carbs: 10,
    fats: 1,
  };

  async function makeCoachClient() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, isClient: false } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isCoach: false, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    return { coach, client };
  }

  it("editing a PUBLISHED meal plan forks a new draft and leaves the published plan's content untouched", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = coach.clerkId;

    const draft = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: "2026-01-05",
      items: [{ mealName: "Breakfast", sortOrder: 0, foodName: "Oatmeal", quantity: "1", unit: "cup", calories: 300, protein: 10, carbs: 50, fats: 5 }],
    });
    if (!("mealPlanId" in draft)) throw new Error("expected draft");
    await publishMealPlan({ mealPlanId: draft.mealPlanId });

    const publishedBefore = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.mealPlanId }, include: { items: true } });
    expect(publishedBefore.status).toBe("PUBLISHED");

    // Attempt to "save" directly against the published plan's id — as if a
    // stale client, a direct API call, or a race were replaying an old id.
    const saveResult = await saveDraftMealPlan({
      mealPlanId: draft.mealPlanId,
      items: [{ mealName: "Breakfast", sortOrder: 0, foodName: "TAMPERED", quantity: "99", unit: "cup", calories: 9999, protein: 0, carbs: 0, fats: 0 }],
    });

    expect("forkedNewDraftId" in saveResult && !!saveResult.forkedNewDraftId).toBe(true);
    const forkedId = (saveResult as { forkedNewDraftId: string }).forkedNewDraftId;
    expect(forkedId).not.toBe(draft.mealPlanId);

    const publishedAfter = await db.mealPlan.findUniqueOrThrow({ where: { id: draft.mealPlanId }, include: { items: true } });
    expect(publishedAfter.status).toBe("PUBLISHED");
    expect(publishedAfter.items[0].foodName).toBe("Oatmeal");
    expect(publishedAfter.items[0].calories).toBe(300);

    const forked = await db.mealPlan.findUniqueOrThrow({ where: { id: forkedId }, include: { items: true } });
    expect(forked.status).toBe("DRAFT");
    expect(forked.items[0].foodName).toBe("TAMPERED");
  });

  it("publishing a new draft supersedes the prior published plan — never two PUBLISHED at once", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = coach.clerkId;

    const draft1 = await createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-01-12", items: [FIXTURE_ITEM] });
    if (!("mealPlanId" in draft1)) throw new Error("expected draft");
    await publishMealPlan({ mealPlanId: draft1.mealPlanId });

    const draft2 = await createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-01-12", items: [FIXTURE_ITEM] });
    if (!("mealPlanId" in draft2)) throw new Error("expected draft");
    await publishMealPlan({ mealPlanId: draft2.mealPlanId });

    const plan1After = await db.mealPlan.findUniqueOrThrow({ where: { id: draft1.mealPlanId } });
    const plan2After = await db.mealPlan.findUniqueOrThrow({ where: { id: draft2.mealPlanId } });
    expect(plan1After.status).toBe("SUPERSEDED");
    expect(plan2After.status).toBe("PUBLISHED");

    const publishedCount = await db.mealPlan.count({ where: { clientId: client.id, weekOf: plan1After.weekOf, status: "PUBLISHED" } });
    expect(publishedCount).toBe(1);
  });

  it("a concurrent double-publish of the same draft only succeeds once", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = coach.clerkId;
    const draft = await createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-01-19", items: [FIXTURE_ITEM] });
    if (!("mealPlanId" in draft)) throw new Error("expected draft");

    const results = await Promise.allSettled([
      publishMealPlan({ mealPlanId: draft.mealPlanId }),
      publishMealPlan({ mealPlanId: draft.mealPlanId }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const publishedCount = await db.mealPlan.count({ where: { id: draft.mealPlanId, status: "PUBLISHED" } });
    expect(publishedCount).toBe(1);
  });

  it("concurrent draft creation for the same client/week never produces duplicate version numbers", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = coach.clerkId;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => createDraftMealPlan({ clientId: client.id, weekStartDate: "2026-01-26", items: [] }))
    );
    const ids = results.map((r) => ("mealPlanId" in r ? r.mealPlanId : null)).filter(Boolean) as string[];
    expect(ids).toHaveLength(5);

    const versions = await db.mealPlan.findMany({ where: { id: { in: ids } }, select: { version: true } });
    const versionNumbers = versions.map((v) => v.version).sort((a, b) => a - b);
    expect(new Set(versionNumbers).size).toBe(5); // all distinct
  });

  it("editing a PUBLISHED training program forks a new draft and never demotes the published one", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = coach.clerkId;

    const created = await saveTrainingProgram({
      clientId: client.id,
      weekStartDate: "2026-02-02",
      days: [{ dayName: "Day 1", blocks: [{ type: "EXERCISE", title: "Squat", content: "3x5" }] }],
    });
    if ("error" in created) throw new Error("expected program");
    await publishTrainingProgram({ programId: created.programId });

    const publishedBefore = await db.trainingProgram.findUniqueOrThrow({ where: { id: created.programId }, include: { days: { include: { blocks: true } } } });
    expect(publishedBefore.status).toBe("PUBLISHED");

    // Attempt to "save" directly against the published program's id.
    const saveResult = await saveTrainingProgram({
      clientId: client.id,
      weekStartDate: "2026-02-02",
      days: [{ dayName: "Day 1", blocks: [{ type: "EXERCISE", title: "TAMPERED", content: "0x0" }] }],
    });
    if ("error" in saveResult) throw new Error("expected save result");
    expect(saveResult.programId).not.toBe(created.programId);

    const publishedAfter = await db.trainingProgram.findUniqueOrThrow({ where: { id: created.programId }, include: { days: { include: { blocks: true } } } });
    // The critical assertion: still PUBLISHED, never demoted to DRAFT, and
    // its content is untouched.
    expect(publishedAfter.status).toBe("PUBLISHED");
    expect(publishedAfter.days[0].blocks[0].title).toBe("Squat");

    const forked = await db.trainingProgram.findUniqueOrThrow({ where: { id: saveResult.programId }, include: { days: { include: { blocks: true } } } });
    expect(forked.status).toBe("DRAFT");
    expect(forked.days[0].blocks[0].title).toBe("TAMPERED");
  });

  it("publishing a new training program supersedes the prior published one — never two PUBLISHED at once", async () => {
    const { coach, client } = await makeCoachClient();
    mocks.authUserId = coach.clerkId;

    const p1 = await saveTrainingProgram({ clientId: client.id, weekStartDate: "2026-02-09", days: [] });
    if ("error" in p1) throw new Error("expected program");
    await publishTrainingProgram({ programId: p1.programId });

    const p2 = await saveTrainingProgram({ clientId: client.id, weekStartDate: "2026-02-16", days: [] });
    if ("error" in p2) throw new Error("expected program");
    await publishTrainingProgram({ programId: p2.programId });

    const p1After = await db.trainingProgram.findUniqueOrThrow({ where: { id: p1.programId } });
    const p2After = await db.trainingProgram.findUniqueOrThrow({ where: { id: p2.programId } });
    expect(p1After.status).toBe("SUPERSEDED");
    expect(p2After.status).toBe("PUBLISHED");

    const publishedCount = await db.trainingProgram.count({ where: { clientId: client.id, status: "PUBLISHED" } });
    expect(publishedCount).toBe(1);
  });
});
