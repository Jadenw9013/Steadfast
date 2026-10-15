import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-2069 (P0) — the document-import routes authorized on `upload.coachId ===
 * coach.id` only, never on the CURRENT CoachClient link. Coach B uploads K's
 * plan, B is removed and K joins coach A, then B calls import-plan with
 * publish:true: B's plan was published for K and superseded A's plan.
 *
 * Every route that acts on an existing upload/import or its draft must now
 * verify the link (`verifyCoachAccessToClient`) before reading draft content
 * or writing anything, and return the sibling routes' 403
 * `{ error: "Not assigned to this client" }`. The current coach is unchanged.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  notifySms: vi.fn(),
  sendEmail: vi.fn(),
  pushMealPlanUpdated: vi.fn(),
  downloadMealPlanFile: vi.fn(),
  downloadWorkoutFile: vi.fn(),
  extractText: vi.fn(),
  parseMealPlanTextToJson: vi.fn(),
  parseWorkoutPlanTextToJson: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/sms/notify", () => ({ notifyMealPlanUpdated: mocks.notifySms }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/push", () => ({ pushMealPlanUpdated: mocks.pushMealPlanUpdated }));
vi.mock("@/lib/supabase/meal-plan-storage", () => ({ downloadMealPlanFile: mocks.downloadMealPlanFile }));
vi.mock("@/lib/supabase/workout-storage", () => ({ downloadWorkoutFile: mocks.downloadWorkoutFile }));
vi.mock("@/lib/ocr/google-vision", () => ({ extractText: mocks.extractText }));
vi.mock("@/lib/llm/parse-meal-plan", () => ({ parseMealPlanTextToJson: mocks.parseMealPlanTextToJson }));
vi.mock("@/lib/llm/parse-workout-plan", () => ({ parseWorkoutPlanTextToJson: mocks.parseWorkoutPlanTextToJson }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { POST as importPlanRoute } from "@/app/api/mealplans/import-plan/route";
import { GET as mealDraftRoute } from "@/app/api/mealplans/draft/route";
import { POST as mealParseRoute } from "@/app/api/mealplans/parse/route";
import { GET as workoutDraftRoute } from "@/app/api/workout-import/draft/route";
import { POST as workoutParseRoute } from "@/app/api/workout-import/parse/route";
import { POST as workoutImportRoute } from "@/app/api/workout-import/import/route";
import { PUBLISHED_MEAL_PLAN_INDEX } from "@/lib/meal-plans/publish";
import { getCurrentWeekMonday } from "@/lib/utils/date";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

const WEEK_OF = getCurrentWeekMonday();
const WEEK_START_DATE = WEEK_OF.toISOString().split("T")[0];
const NOT_ASSIGNED = { error: "Not assigned to this client" };

const mealDoc = () => ({
  title: "Coach B Week",
  meals: [{ name: "Meal 1", items: [{ food: "B oats", portion: "80 g" }] }],
});
const workoutDoc = () => ({
  name: "Coach B Program",
  notes: "",
  days: [{ dayName: "Day 1", blocks: [{ type: "EXERCISE", title: "Squat", content: "5x5" }] }],
});

function post(path: string, body: unknown) {
  return new NextRequest(`https://example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const get = (path: string) => new NextRequest(`https://example.test${path}`);

async function user(kind: "coach" | "client") {
  const clerkId = randomUUID();
  return db.user.create({
    data:
      kind === "coach"
        ? { clerkId, email: `coach-${clerkId}@example.test`, isCoach: true, activeRole: "COACH" }
        : { clerkId, email: `client-${clerkId}@example.test`, isClient: true },
  });
}

suite("T-2069 import routes verify the current CoachClient link", () => {
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
    mocks.downloadMealPlanFile.mockResolvedValue(new Uint8Array([1]));
    mocks.downloadWorkoutFile.mockResolvedValue(new Uint8Array([1]));
    mocks.extractText.mockResolvedValue("SYNTHETIC extracted text");
    mocks.parseMealPlanTextToJson.mockResolvedValue(mealDoc());
    mocks.parseWorkoutPlanTextToJson.mockResolvedValue(workoutDoc());
  });
  afterAll(async () => { await db.$disconnect(); });

  /**
   * Coach B uploaded K's meal plan and workout program while coaching K. B is
   * then removed, K joins coach A, and A publishes this week's meal plan.
   */
  async function removedCoachScenario() {
    const coachA = await user("coach");
    const coachB = await user("coach");
    const client = await user("client");

    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id } });
    const upload = await db.mealPlanUpload.create({
      data: { coachId: coachB.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "NEEDS_REVIEW" },
    });
    const draft = await db.mealPlanDraft.create({
      data: { uploadId: upload.id, extractedText: "K private text", parsedJson: mealDoc() },
    });
    const freshUpload = await db.mealPlanUpload.create({
      data: { coachId: coachB.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "UPLOADED" },
    });
    const wImport = await db.workoutImport.create({
      data: { coachId: coachB.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "NEEDS_REVIEW" },
    });
    const wDraft = await db.workoutImportDraft.create({
      data: { importId: wImport.id, extractedText: "K private text", parsedJson: workoutDoc() },
    });
    const wFreshImport = await db.workoutImport.create({
      data: { coachId: coachB.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "UPLOADED" },
    });

    // B removed; K joins A; A publishes this week's plan.
    await db.coachClient.delete({ where: { coachId_clientId: { coachId: coachB.id, clientId: client.id } } });
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    mocks.authUserId = coachA.clerkId;
    const { mealPlanId: aPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_START_DATE,
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "A food", quantity: "1", unit: "serving" }],
    });
    await publishMealPlan({ mealPlanId: aPlanId });

    mocks.authUserId = coachB.clerkId;
    return { coachA, coachB, client, upload, draft, freshUpload, wImport, wDraft, wFreshImport, aPlanId };
  }

  /** The same uploads, but B still coaches K. */
  async function currentCoachScenario() {
    const coach = await user("coach");
    const client = await user("client");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;
    const { mealPlanId: oldPlanId } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_START_DATE,
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Old food", quantity: "1", unit: "serving" }],
    });
    await publishMealPlan({ mealPlanId: oldPlanId });
    const upload = await db.mealPlanUpload.create({
      data: { coachId: coach.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "NEEDS_REVIEW" },
    });
    const draft = await db.mealPlanDraft.create({ data: { uploadId: upload.id, parsedJson: mealDoc() } });
    const freshUpload = await db.mealPlanUpload.create({
      data: { coachId: coach.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "UPLOADED" },
    });
    const wImport = await db.workoutImport.create({
      data: { coachId: coach.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "NEEDS_REVIEW" },
    });
    const wDraft = await db.workoutImportDraft.create({ data: { importId: wImport.id, parsedJson: workoutDoc() } });
    const wFreshImport = await db.workoutImport.create({
      data: { coachId: coach.id, clientId: client.id, storagePath: `x/${randomUUID()}.pdf`, mimeType: "application/pdf", status: "UPLOADED" },
    });
    return { coach, client, oldPlanId, upload, draft, freshUpload, wImport, wDraft, wFreshImport };
  }

  // ── The P0 ────────────────────────────────────────────────────────────────

  it("removed coach cannot import-and-publish; the current coach's PUBLISHED plan is not superseded", async () => {
    const s = await removedCoachScenario();
    const res = await importPlanRoute(post("/api/mealplans/import-plan", { draftId: s.draft.id, publish: true }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(NOT_ASSIGNED);
    const aPlan = await db.mealPlan.findUniqueOrThrow({ where: { id: s.aPlanId } });
    expect(aPlan.status).toBe("PUBLISHED");
    const plans = await db.mealPlan.findMany({ where: { clientId: s.client.id } });
    expect(plans.map((p) => p.id)).toEqual([s.aPlanId]);
    expect((await db.mealPlanUpload.findUniqueOrThrow({ where: { id: s.upload.id } })).status).toBe("NEEDS_REVIEW");
  });

  it("removed coach cannot import as a draft (no MealPlan row written)", async () => {
    const s = await removedCoachScenario();
    const res = await importPlanRoute(
      post("/api/mealplans/import-plan", { draftId: s.draft.id, publish: false, parsedJson: mealDoc() })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(NOT_ASSIGNED);
    expect(await db.mealPlan.count({ where: { clientId: s.client.id } })).toBe(1);
  });

  // ── Siblings ──────────────────────────────────────────────────────────────

  it("removed coach cannot read the meal-plan draft", async () => {
    const s = await removedCoachScenario();
    const res = await mealDraftRoute(get(`/api/mealplans/draft?uploadId=${s.upload.id}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(NOT_ASSIGNED);
  });

  it("removed coach cannot parse a meal-plan upload (no OCR, no write)", async () => {
    const s = await removedCoachScenario();
    const res = await mealParseRoute(post("/api/mealplans/parse", { uploadId: s.freshUpload.id }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(NOT_ASSIGNED);
    expect(mocks.downloadMealPlanFile).not.toHaveBeenCalled();
    expect((await db.mealPlanUpload.findUniqueOrThrow({ where: { id: s.freshUpload.id } })).status).toBe("UPLOADED");
    expect(await db.mealPlanDraft.count({ where: { uploadId: s.freshUpload.id } })).toBe(0);
  });

  it("removed coach cannot read, parse or import a client workout import", async () => {
    const s = await removedCoachScenario();

    const draftRes = await workoutDraftRoute(get(`/api/workout-import/draft?importId=${s.wImport.id}`));
    expect(draftRes.status).toBe(403);
    expect(await draftRes.json()).toEqual(NOT_ASSIGNED);

    const parseRes = await workoutParseRoute(post("/api/workout-import/parse", { importId: s.wFreshImport.id }));
    expect(parseRes.status).toBe(403);
    expect(mocks.downloadWorkoutFile).not.toHaveBeenCalled();
    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: s.wFreshImport.id } })).status).toBe("UPLOADED");

    const templatesBefore = await db.trainingTemplate.count({ where: { coachId: s.coachB.id } });
    for (const body of [
      { draftId: s.wDraft.id, parsedJson: workoutDoc(), saveAsTemplate: false, publish: true },
      { draftId: s.wDraft.id, parsedJson: workoutDoc(), saveAsTemplate: true },
    ]) {
      const res = await workoutImportRoute(post("/api/workout-import/import", body));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(NOT_ASSIGNED);
    }
    expect(await db.trainingProgram.count({ where: { clientId: s.client.id } })).toBe(0);
    expect(await db.trainingTemplate.count({ where: { coachId: s.coachB.id } })).toBe(templatesBefore);
    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: s.wImport.id } })).status).toBe("NEEDS_REVIEW");
  });

  it("another coach's upload is still a 404, not a 403 (ownership check order unchanged)", async () => {
    const s = await removedCoachScenario();
    mocks.authUserId = s.coachA.clerkId; // A coaches K but did not upload these
    const res = await importPlanRoute(post("/api/mealplans/import-plan", { draftId: s.draft.id, publish: true }));
    expect(res.status).toBe(404);
    const wres = await workoutDraftRoute(get(`/api/workout-import/draft?importId=${s.wImport.id}`));
    expect(wres.status).toBe(404);
  });

  // ── Regression: the current coach is unchanged ────────────────────────────

  it("current coach can still read, parse, import and publish (meal plan)", async () => {
    const s = await currentCoachScenario();

    const draftRes = await mealDraftRoute(get(`/api/mealplans/draft?uploadId=${s.upload.id}`));
    expect(draftRes.status).toBe(200);
    expect((await draftRes.json()).draftId).toBe(s.draft.id);

    const parseRes = await mealParseRoute(post("/api/mealplans/parse", { uploadId: s.freshUpload.id }));
    expect(parseRes.status).toBe(200);
    expect(await parseRes.json()).toEqual({ status: "needs_review" });

    const res = await importPlanRoute(post("/api/mealplans/import-plan", { draftId: s.draft.id, publish: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "imported", clientId: s.client.id, published: true, weekStartDate: WEEK_START_DATE });
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: body.mealPlanId } })).status).toBe("PUBLISHED");
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: s.oldPlanId } })).status).toBe("SUPERSEDED");
    expect((await db.mealPlanUpload.findUniqueOrThrow({ where: { id: s.upload.id } })).status).toBe("IMPORTED");
  });

  it("current coach can still read, parse and import (workout program + template)", async () => {
    const s = await currentCoachScenario();

    const draftRes = await workoutDraftRoute(get(`/api/workout-import/draft?importId=${s.wImport.id}`));
    expect(draftRes.status).toBe(200);
    expect((await draftRes.json()).clientId).toBe(s.client.id);

    const parseRes = await workoutParseRoute(post("/api/workout-import/parse", { importId: s.wFreshImport.id }));
    expect(parseRes.status).toBe(200);

    const res = await workoutImportRoute(
      post("/api/workout-import/import", { draftId: s.wDraft.id, parsedJson: workoutDoc(), saveAsTemplate: false, publish: true })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "imported", mode: "program", clientId: s.client.id });

    const tDraft = await db.workoutImportDraft.findUniqueOrThrow({ where: { importId: s.wFreshImport.id } });
    const tRes = await workoutImportRoute(
      post("/api/workout-import/import", { draftId: tDraft.id, parsedJson: workoutDoc(), saveAsTemplate: true })
    );
    expect(tRes.status).toBe(200);
    expect(await tRes.json()).toMatchObject({ status: "imported", mode: "template" });
  });
});
