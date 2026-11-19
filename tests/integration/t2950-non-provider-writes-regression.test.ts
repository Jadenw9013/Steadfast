import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-2950 / T-2996 deployed-commit regression (release-safety section 2).
 *
 * Imports ONLY modules that exist on the deployed commit (32ec202): the
 * meal-plan route handlers, the publish route and the save/publish actions. It
 * does not import the gate module, and its fixture is written with raw `db`
 * calls. It must be RED on 32ec202 (the non-provider's writes succeed) and
 * GREEN on the T-2996 branch.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: vi.fn(async () => undefined) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/notifications/push", () => ({ pushMealPlanUpdated: vi.fn(async () => undefined) }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { saveDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { saveTrainingProgram, publishTrainingProgram } from "@/app/actions/training-programs";
import { PUT as trainingPut } from "@/app/api/coach/clients/[clientId]/training/route";
import { POST as trainingPublish } from "@/app/api/coach/clients/[clientId]/training/publish/route";
import { POST as restoreMeal } from "@/app/api/coach/clients/[clientId]/meal-plan/restore/route";
import { POST as setMode } from "@/app/api/coach/clients/[clientId]/plan-mode/route";
import { getMealPlanSaveTarget, saveMealPlanDraftContent } from "@/lib/meal-plans/drafts";
import { getMealPlanPublishTarget, publishMealPlanTarget } from "@/lib/meal-plans/publish";
import { checkMealPlanWriter } from "@/lib/meal-plans/writer-gate";
import { PUT as mealPlanPut, DELETE as mealPlanDelete } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/meal-plan/publish/route";
import { requireLocalTestDb } from "../helpers/require-local-test-db";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`https://example.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });
const ITEM = (foodName: string) => ({ mealName: "Meal 1", sortOrder: 0, foodName, quantity: "1", unit: "serving" });

suite("T-2950 non-provider coach cannot write a meal-plan draft", () => {
  const users: string[] = [];
  beforeAll(async () => {
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "MealPlan_one_published_per_client_week" ON "MealPlan"("clientId","weekOf") WHERE (status = 'PUBLISHED')`
    );
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await db.clientCoachingContext.deleteMany({ where: { clientId: { in: users } } });
    await db.coachClient.deleteMany({ where: { clientId: { in: users } } });
    await db.mealPlan.deleteMany({ where: { clientId: { in: users } } });
    await db.trainingProgram.deleteMany({ where: { clientId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  async function fixture() {
    const mk = async (isCoach: boolean) => {
      const clerkId = randomUUID();
      return db.user.create({
        data: isCoach
          ? { clerkId, email: `coach-${clerkId}@example.test`, isCoach: true, activeRole: "COACH" }
          : { clerkId, email: `client-${clerkId}@example.test`, isClient: true, activeRole: "CLIENT" },
      });
    };
    const A = await mk(true);
    const B = await mk(true);
    const K = await mk(false);
    users.push(A.id, B.id, K.id);
    const rowA = await db.coachClient.create({ data: { coachId: A.id, clientId: K.id } });
    await db.coachClient.create({ data: { coachId: B.id, clientId: K.id } });
    await db.clientCoachingContext.create({ data: { clientId: K.id, mode: "HUMAN", activeCoachClientId: rowA.id } });
    const plan = await db.mealPlan.create({
      data: {
        clientId: K.id,
        weekOf: new Date("2026-04-13T00:00:00.000Z"),
        status: "DRAFT",
        planMode: "MEAL_PLAN",
        items: { create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Draft", quantity: "1", unit: "serving" }] },
      },
    });
    mocks.authUserId = B.clerkId; // B is assigned but is NOT the provider
    return { A, B, K, planId: plan.id };
  }
  const foods = async (id: string) =>
    (await db.mealPlanItem.findMany({ where: { mealPlanId: id }, orderBy: { sortOrder: "asc" } })).map((i) => i.foodName);

  it("also refuses training saves and publication through web and REST", async () => {
    const fixtureData = await fixture();
    const program = await db.trainingProgram.create({ data: { clientId: fixtureData.K.id, weekOf: new Date("2026-04-13"), status: "DRAFT" } });
    expect(await saveTrainingProgram({ clientId: fixtureData.K.id, weekStartDate: "2026-04-13", days: [] })).toMatchObject({ code: "NOT_CURRENT_PROVIDER" });
    expect(await publishTrainingProgram({ programId: program.id })).toMatchObject({ code: "NOT_CURRENT_PROVIDER" });
    expect((await trainingPut(req("PUT", "/api/training", { programId: program.id, days: [] }), params(fixtureData.K.id))).status).toBe(403);
    expect((await trainingPublish(req("POST", "/api/training/publish", { programId: program.id }), params(fixtureData.K.id))).status).toBe(403);
    expect((await db.trainingProgram.findUniqueOrThrow({ where: { id: program.id } })).status).toBe("DRAFT");
  });

  it("refuses restore and plan-mode changes by the non-provider", async () => {
    const fixtureData = await fixture();
    expect((await restoreMeal(req("POST", "/api/restore", { sourceMealPlanId: fixtureData.planId }), params(fixtureData.K.id))).status).toBe(403);
    expect((await setMode(req("POST", "/api/plan-mode", { mode: "MACROS" }), params(fixtureData.K.id))).status).toBe(403);
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: fixtureData.planId } })).planMode).toBe("MEAL_PLAN");
  });

  it.each(["AI", "NONE"] as const)("refuses writes in %s mode even with a stale relationship", async (mode) => {
    const fixtureData = await fixture();
    await db.clientCoachingContext.update({ where: { clientId: fixtureData.K.id }, data: { mode } });
    expect(await checkMealPlanWriter(fixtureData.A.id, fixtureData.K.id)).toMatchObject({ ok: false });
  });

  it("fails closed for ambiguous relationships and retains the unambiguous legacy fallback", async () => {
    const fixtureData = await fixture();
    await db.clientCoachingContext.delete({ where: { clientId: fixtureData.K.id } });
    expect(await checkMealPlanWriter(fixtureData.A.id, fixtureData.K.id)).toMatchObject({ ok: false });
    await db.coachClient.deleteMany({ where: { clientId: fixtureData.K.id, coachId: fixtureData.B.id } });
    expect(await checkMealPlanWriter(fixtureData.A.id, fixtureData.K.id)).toEqual({ ok: true });
  });

  it("permits the current coach but refuses a deactivated client", async () => {
    const fixtureData = await fixture();
    mocks.authUserId = fixtureData.A.clerkId;
    expect(await saveDraftMealPlan({ mealPlanId: fixtureData.planId, items: [ITEM("Current coach edit")] })).toMatchObject({ success: true });
    await db.user.update({ where: { id: fixtureData.K.id }, data: { isDeactivated: true } });
    expect(await checkMealPlanWriter(fixtureData.A.id, fixtureData.K.id)).toMatchObject({ ok: false });
  });

  it("rechecks the provider inside publication before any live plan changes", async () => {
    const fixtureData = await fixture();
    const target = await getMealPlanPublishTarget(fixtureData.planId);
    await db.clientCoachingContext.update({ where: { clientId: fixtureData.K.id }, data: { mode: "NONE", revision: { increment: 1 } } });
    expect(await publishMealPlanTarget(target!, { publishedByCoachId: fixtureData.A.id })).toMatchObject({ ok: false, code: "NOT_ASSIGNED" });
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: fixtureData.planId } })).status).toBe("DRAFT");
  });

  it("does not overwrite live meal content when a draft is published during a save", async () => {
    const fixtureData = await fixture();
    const stale = await getMealPlanSaveTarget(fixtureData.planId);
    const target = await getMealPlanPublishTarget(fixtureData.planId);
    expect(await publishMealPlanTarget(target!, { publishedByCoachId: fixtureData.A.id })).toMatchObject({ ok: true });
    await expect(saveMealPlanDraftContent(stale!, { items: [{ ...ITEM("Late write"), calories: 0, protein: 0, carbs: 0, fats: 0 }] })).rejects.toThrow("changed while saving");
    expect(await foods(fixtureData.planId)).toEqual(["Draft"]);
  });

  it("B PUT returns 403 NOT_CURRENT_PROVIDER and items are unchanged", async () => {
    const f = await fixture();
    const res = await mealPlanPut(req("PUT", `/api/coach/clients/${f.K.id}/meal-plan`, { mealPlanId: f.planId, items: [ITEM("B edit")] }), params(f.K.id));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("NOT_CURRENT_PROVIDER");
    expect(await foods(f.planId)).toEqual(["Draft"]);
  });

  it("B saveDraftMealPlan is refused and items are unchanged", async () => {
    const f = await fixture();
    const r = await saveDraftMealPlan({ mealPlanId: f.planId, items: [ITEM("B edit")] });
    expect(r).toMatchObject({ ok: false, code: "NOT_CURRENT_PROVIDER" });
    expect(await foods(f.planId)).toEqual(["Draft"]);
  });

  it("B POST publish returns 403 and the draft is still DRAFT", async () => {
    const f = await fixture();
    const res = await publishRest(req("POST", `/api/coach/clients/${f.K.id}/meal-plan/publish`, { mealPlanId: f.planId }), params(f.K.id));
    expect(res.status).toBe(403);
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: f.planId } })).status).toBe("DRAFT");
  });

  it("B publishMealPlan is refused and the draft is still DRAFT", async () => {
    const f = await fixture();
    const r = await publishMealPlan({ mealPlanId: f.planId });
    expect(r).toMatchObject({ ok: false, code: "NOT_CURRENT_PROVIDER" });
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: f.planId } })).status).toBe("DRAFT");
  });

  it("B DELETE returns 403 and the draft still exists", async () => {
    const f = await fixture();
    const res = await mealPlanDelete(req("DELETE", `/api/coach/clients/${f.K.id}/meal-plan?mealPlanId=${f.planId}`), params(f.K.id));
    expect(res.status).toBe(403);
    expect(await db.mealPlan.findUnique({ where: { id: f.planId } })).not.toBeNull();
  });
});
