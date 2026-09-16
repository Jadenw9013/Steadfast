import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-730 — the OCR import route (`app/api/mealplans/import-plan/route.ts`) was a
 * THIRD `MealPlan` writer: it hand-rolled version allocation and published with
 * a raw `db.mealPlan.create`, bypassing both shared services. What this suite
 * pins down, now that it routes through them:
 *
 *  - import-and-publish supersedes the week's existing PUBLISHED plan, leaving
 *    exactly one PUBLISHED row (the P0 — it used to leave two),
 *  - concurrent imports for one client/week allocate DISTINCT versions instead
 *    of surfacing "Unique constraint failed",
 *  - a lost publish race returns T-660's frozen `PUBLISH_RACE_LOST` 409 and
 *    leaves the upload retryable,
 *  - the document's `supportContent` reaches `MealPlan.supportContent`
 *    (`MealPlanDraft.supportContent` is a dead column — the live source is
 *    `parsedJson.supportContent`),
 *  - and the route's request/response contract plus its whole auth ladder are
 *    byte-identical to before.
 *
 * Index reproducibility: same self-heal as
 * tests/integration/meal-plan-publish-parity.test.ts:60-70 — the partial unique
 * index is raw SQL inside
 * `prisma/migrations/20260913220000_plan_supersede_backfill/migration.sql`, is
 * deliberately not mirrored in `schema.prisma`, and `db push` (how this local
 * test DB is kept in sync) neither creates nor preserves it. The first `it`
 * asserts the index exists so nothing below can pass vacuously.
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
import { createDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { POST as importPlanRoute } from "@/app/api/mealplans/import-plan/route";
import { PUBLISHED_MEAL_PLAN_INDEX } from "@/lib/meal-plans/publish";
import { getCurrentWeekMonday } from "@/lib/utils/date";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

/** The route can only ever import into the current week (`getCurrentWeekMonday()`
 *  at route.ts:69 — there is no field to choose one), so the fixtures follow it
 *  rather than hardcoding a Monday. */
const WEEK_OF = getCurrentWeekMonday();
const WEEK_START_DATE = WEEK_OF.toISOString().split("T")[0];
const previousWeek = () => {
  const d = new Date(WEEK_OF);
  d.setUTCDate(d.getUTCDate() - 7);
  return d;
};
const PREV_WEEK = previousWeek();
const PREV_WEEK_START_DATE = PREV_WEEK.toISOString().split("T")[0];

type ParsedDoc = Record<string, unknown>;

/** A representative parsed document: two meals, extras, no plan notes. */
const baseDoc = (): ParsedDoc => ({
  title: "Imported Week",
  meals: [
    { name: "Meal 1", items: [{ food: "Oats", portion: "80 g" }, { food: "Whey", portion: "1 scoop" }] },
    { name: "Meal 2", items: [{ food: "Chicken", portion: "200 g" }] },
  ],
  metadata: { phase: "cutting", bodyweight: "82kg" },
  dayOverrides: [{ label: "High Carb Day", color: "blue", weekdays: ["Monday"] }],
});

suite("meal-plan import parity (import route vs the shared draft/publish services)", () => {
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

  /** An upload sitting at NEEDS_REVIEW with its parsed draft — what the coach
   *  sees in the review screen just before pressing Import. */
  async function importFixture(
    coachId: string,
    clientId: string,
    parsedJson: ParsedDoc = baseDoc()
  ) {
    const upload = await db.mealPlanUpload.create({
      data: {
        coachId,
        clientId,
        storagePath: `meal-plan-uploads/${randomUUID()}.pdf`,
        status: "NEEDS_REVIEW",
      },
    });
    const draft = await db.mealPlanDraft.create({
      data: { uploadId: upload.id, parsedJson: parsedJson as object },
    });
    return { upload, draft };
  }

  function importRequest(body: unknown) {
    return new NextRequest("https://example.test/api/mealplans/import-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const importPlan = (body: unknown) => importPlanRoute(importRequest(body));

  const plansFor = (clientId: string) =>
    db.mealPlan.findMany({ where: { clientId }, orderBy: { version: "asc" } });
  const publishedCount = (clientId: string, weekOf: Date = WEEK_OF) =>
    db.mealPlan.count({ where: { clientId, weekOf, status: "PUBLISHED" } });
  const statusOf = async (id: string) => (await db.mealPlan.findUniqueOrThrow({ where: { id } })).status;
  const uploadStatus = async (id: string) =>
    (await db.mealPlanUpload.findUniqueOrThrow({ where: { id } })).status;

  // ── Guard: without the partial index the supersede assertions are vacuous ──

  it("the partial unique index MealPlan_one_published_per_client_week exists on this database", async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname = ${PUBLISHED_MEAL_PLAN_INDEX}
    `;
    expect(rows).toHaveLength(1);
  });

  // ── Acceptance criteria ───────────────────────────────────────────────────

  it("import-and-publish supersedes the week's existing published plan", async () => {
    const { coach, client } = await fixture();

    // A plan already published for this week through the normal coach flow.
    const { mealPlanId: v1 } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: WEEK_START_DATE,
      items: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Old food", quantity: "1", unit: "serving" }],
    });
    await publishMealPlan({ mealPlanId: v1 });
    expect(await publishedCount(client.id)).toBe(1);

    const { draft } = await importFixture(coach.id, client.id);
    const response = await importPlan({ draftId: draft.id, publish: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.published).toBe(true);

    // The pre-existing plan was superseded, not left published alongside.
    expect(await statusOf(v1)).toBe("SUPERSEDED");

    const imported = await db.mealPlan.findUniqueOrThrow({ where: { id: body.mealPlanId } });
    expect(imported.status).toBe("PUBLISHED");
    expect(imported.publishedAt).not.toBeNull();
    expect(imported.version).toBe(2);

    // The invariant the raw `db.mealPlan.create` used to break.
    expect(await publishedCount(client.id)).toBe(1);
  });

  it("concurrent imports for one client/week allocate distinct versions", async () => {
    const { coach, client } = await fixture();
    const a = await importFixture(coach.id, client.id);
    const b = await importFixture(coach.id, client.id);

    const settled = await Promise.allSettled([
      importPlan({ draftId: a.draft.id, publish: false }),
      importPlan({ draftId: b.draft.id, publish: false }),
    ]);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);

    const responses = settled.map((r) => (r as PromiseFulfilledResult<Response>).value);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    // `createMealPlanWithNextVersion`'s P2002 retry is what keeps this out of
    // the catch block — the old hand-rolled read-max-and-add-one could not.
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toContain("Unique constraint failed");
    }

    const plans = await plansFor(client.id);
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.status === "DRAFT")).toBe(true);
    expect(new Set(plans.map((p) => p.version)).size).toBe(2);
    expect(new Set(bodies.map((b) => b.mealPlanId)).size).toBe(2);
  });

  it("supportContent from the stored parsedJson reaches MealPlan.supportContent", async () => {
    const { coach, client } = await fixture();
    const { draft } = await importFixture(coach.id, client.id, {
      ...baseDoc(),
      supportContent: "Hydration: 3L/day",
    });

    const response = await importPlan({ draftId: draft.id });
    expect(response.status).toBe(200);
    const { mealPlanId } = await response.json();

    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } });
    expect(plan.supportContent).toBe("Hydration: 3L/day");
  });

  it("supportContent supplied only via the parsedJson override reaches the column and is persisted back onto the draft", async () => {
    const { coach, client } = await fixture();
    // Stored draft has NO plan notes; the coach typed them in the review screen.
    const { draft } = await importFixture(coach.id, client.id, baseDoc());
    const override = { ...baseDoc(), supportContent: "Coach-edited: 3L water, 10k steps" };

    const response = await importPlan({ draftId: draft.id, parsedJson: override, publish: false });
    expect(response.status).toBe(200);
    const { mealPlanId } = await response.json();

    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } });
    expect(plan.supportContent).toBe("Coach-edited: 3L water, 10k steps");

    // The override is written back to the draft (unchanged bookkeeping).
    const stored = await db.mealPlanDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect((stored.parsedJson as { supportContent?: string }).supportContent).toBe(
      "Coach-edited: 3L water, 10k steps"
    );
    // The dead column stays dead — the live source is parsedJson.
    expect(stored.supportContent).toBeNull();
  });

  it("an empty or absent supportContent leaves the column null, never an empty string", async () => {
    const { coach, client } = await fixture();

    const emptyDoc = await importFixture(coach.id, client.id, { ...baseDoc(), supportContent: "" });
    const emptyResponse = await importPlan({ draftId: emptyDoc.draft.id });
    expect(emptyResponse.status).toBe(200);
    const emptyPlan = await db.mealPlan.findUniqueOrThrow({
      where: { id: (await emptyResponse.json()).mealPlanId },
    });
    expect(emptyPlan.supportContent).toBeNull();

    const absentDoc = await importFixture(coach.id, client.id, baseDoc());
    const absentResponse = await importPlan({ draftId: absentDoc.draft.id });
    expect(absentResponse.status).toBe(200);
    const absentPlan = await db.mealPlan.findUniqueOrThrow({
      where: { id: (await absentResponse.json()).mealPlanId },
    });
    expect(absentPlan.supportContent).toBeNull();
  });

  // ── Regressions: existing behavior must be byte-identical ─────────────────

  it("import as draft is unchanged — same response shape, same row content", async () => {
    const { coach, client } = await fixture();
    const { upload, draft } = await importFixture(coach.id, client.id);

    const response = await importPlan({ draftId: draft.id, publish: false });
    expect(response.status).toBe(200);
    const body = await response.json();

    // Exact contract: same keys, same types, nothing added or renamed.
    expect(body).toEqual({
      status: "imported",
      mealPlanId: expect.any(String),
      clientId: client.id,
      weekStartDate: WEEK_START_DATE,
      published: false,
    });

    const plan = await db.mealPlan.findUniqueOrThrow({
      where: { id: body.mealPlanId },
      include: { items: { orderBy: { sortOrder: "asc" } }, macroTargets: true },
    });
    expect(plan.status).toBe("DRAFT");
    expect(plan.version).toBe(1);
    expect(plan.publishedAt).toBeNull();
    expect(plan.planMode).toBe("MEAL_PLAN");
    expect(plan.weekOf.toISOString()).toBe(WEEK_OF.toISOString());

    // Item mapping: document order, sortOrder 0..n, original portion kept as
    // servingDescription, macros zeroed.
    expect(plan.items.map((i) => [i.sortOrder, i.mealName, i.foodName, i.servingDescription])).toEqual([
      [0, "Meal 1", "Oats", "80 g"],
      [1, "Meal 1", "Whey", "1 scoop"],
      [2, "Meal 2", "Chicken", "200 g"],
    ]);
    expect(plan.items.every((i) => i.calories === 0 && i.protein === 0 && i.carbs === 0 && i.fats === 0)).toBe(true);
    expect(plan.items[0]).toMatchObject({ quantity: "80", unit: "g" });

    const extras = plan.planExtras as { metadata?: unknown; dayOverrides?: { label: string }[] };
    expect(extras.metadata).toEqual({ phase: "cutting", bodyweight: "82kg" });
    expect(extras.dayOverrides?.[0].label).toBe("High Carb Day");

    expect(await uploadStatus(upload.id)).toBe("IMPORTED");
  });

  it("first-ever import-and-publish for a week is unchanged", async () => {
    const { coach, client } = await fixture();
    const { upload, draft } = await importFixture(coach.id, client.id);

    const response = await importPlan({ draftId: draft.id, publish: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "imported",
      mealPlanId: expect.any(String),
      clientId: client.id,
      weekStartDate: WEEK_START_DATE,
      published: true,
    });

    const plans = await plansFor(client.id);
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe("PUBLISHED");
    expect(plans[0].version).toBe(1);
    expect(plans[0].publishedAt).not.toBeNull();
    expect(await db.mealPlan.count({ where: { clientId: client.id, status: "SUPERSEDED" } })).toBe(0);
    expect(await uploadStatus(upload.id)).toBe("IMPORTED");
  });

  it("an imported plan is always MEAL_PLAN, even for a client whose default plan mode is MACROS", async () => {
    const { coach, client } = await fixture();
    await db.coachClient.update({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      data: { planMode: "MACROS" },
    });

    const { draft } = await importFixture(coach.id, client.id);
    const response = await importPlan({ draftId: draft.id, publish: true });
    expect(response.status).toBe(200);
    const { mealPlanId } = await response.json();

    // A parsed document can only ever produce foods. Falling through to
    // CoachClient.planMode would publish a MACROS plan with zero macro targets,
    // which every reader renders as an empty plan.
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: mealPlanId } });
    expect(plan.planMode).toBe("MEAL_PLAN");

    // The client's persistent default is not a side effect of importing.
    const assignment = await db.coachClient.findUniqueOrThrow({
      where: { coachId_clientId: { coachId: coach.id, clientId: client.id } },
      select: { planMode: true },
    });
    expect(assignment.planMode).toBe("MACROS");
  });

  it("an import never carries forward the previous published plan's content", async () => {
    const { coach, client } = await fixture();

    // A rich published plan for the PREVIOUS week — exactly what copy-forward
    // would pull in if `startBlank: true` were ever dropped.
    const { mealPlanId: previous } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: PREV_WEEK_START_DATE,
      items: [{ mealName: "Old Meal", sortOrder: 0, foodName: "Old food", quantity: "1", unit: "serving" }],
      macroTargets: [{ mealName: "Old Meal", sortOrder: 0, calories: 600, protein: 50, carbs: 40, fats: 20 }],
      planExtras: { metadata: { phase: "bulking" } },
      supportContent: "Old week's notes",
    });
    await publishMealPlan({ mealPlanId: previous });

    const { draft } = await importFixture(coach.id, client.id);
    const response = await importPlan({ draftId: draft.id, publish: false });
    expect(response.status).toBe(200);
    const { mealPlanId } = await response.json();

    const imported = await db.mealPlan.findUniqueOrThrow({
      where: { id: mealPlanId },
      include: { items: true, macroTargets: true },
    });
    expect(imported.items.map((i) => i.foodName).sort()).toEqual(["Chicken", "Oats", "Whey"]);
    expect(imported.macroTargets).toHaveLength(0);
    expect(imported.supportContent).toBeNull();
    expect((imported.planExtras as { metadata?: { phase?: string } }).metadata?.phase).toBe("cutting");
  });

  it("an extras-only document (no meals) imports with zero items", async () => {
    const { coach, client } = await fixture();
    const { draft } = await importFixture(coach.id, client.id, {
      title: "Guidance only",
      meals: [],
      supportContent: "Hydration: 3L/day",
      dayOverrides: [{ label: "Refeed", color: "amber", weekdays: ["Sunday"] }],
    });

    const response = await importPlan({ draftId: draft.id, publish: false });
    expect(response.status).toBe(200);
    const { mealPlanId } = await response.json();

    const plan = await db.mealPlan.findUniqueOrThrow({
      where: { id: mealPlanId },
      include: { items: true },
    });
    expect(plan.items).toHaveLength(0);
    expect(plan.supportContent).toBe("Hydration: 3L/day");
    expect((plan.planExtras as { dayOverrides?: { label: string }[] }).dayOverrides?.[0].label).toBe("Refeed");
  });

  it("supersede is scoped to the week — importing into this week leaves another week's plan published", async () => {
    const { coach, client } = await fixture();

    const { mealPlanId: otherWeek } = await createDraftMealPlan({
      clientId: client.id,
      weekStartDate: PREV_WEEK_START_DATE,
      items: [],
    });
    await publishMealPlan({ mealPlanId: otherWeek });

    const { draft } = await importFixture(coach.id, client.id);
    expect((await importPlan({ draftId: draft.id, publish: true })).status).toBe(200);

    expect(await statusOf(otherWeek)).toBe("PUBLISHED");
    expect(await publishedCount(client.id, PREV_WEEK)).toBe(1);
    expect(await publishedCount(client.id, WEEK_OF)).toBe(1);
  });

  it("a lost publish race returns 409 PUBLISH_RACE_LOST and leaves that upload retryable", async () => {
    const { coach, client } = await fixture();
    // The race window is inside the handler and cannot be opened from outside,
    // so drive it with real concurrency and assert the invariants that hold
    // however PostgreSQL schedules the two transactions (same reasoning as
    // T-660's amended concurrency case).
    const uploads = [
      await importFixture(coach.id, client.id),
      await importFixture(coach.id, client.id),
    ];

    const settled = await Promise.allSettled(
      uploads.map((u) => importPlan({ draftId: u.draft.id, publish: true }))
    );
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    const responses = settled.map((r) => (r as PromiseFulfilledResult<Response>).value);

    // Nobody ever gets a 500, and the only failure shape is T-660's frozen body.
    expect(responses.some((r) => r.status === 500)).toBe(false);
    expect(responses.some((r) => r.status === 200)).toBe(true);

    for (const [i, response] of responses.entries()) {
      const upload = uploads[i].upload;
      if (response.status === 200) {
        const body = await response.json();
        expect(body.published).toBe(true);
        // A winner's plan is either still published or was superseded by the
        // other winner if the two serialized — never left a draft.
        expect(["PUBLISHED", "SUPERSEDED"]).toContain(await statusOf(body.mealPlanId));
        expect(await uploadStatus(upload.id)).toBe("IMPORTED");
      } else {
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "This plan was already published or changed by someone else",
          code: "PUBLISH_RACE_LOST",
        });
        // The bookkeeping writes are genuinely AFTER the publish: a loser's
        // upload must still be importable or the coach is stranded on the
        // "Already imported" 400.
        expect(await uploadStatus(upload.id)).toBe("NEEDS_REVIEW");
      }
    }

    expect(await publishedCount(client.id)).toBe(1);
  });

  // ── Auth / validation ladder is unchanged, and never writes a plan ─────────

  it("auth and validation ladder is unchanged and creates no MealPlan row", async () => {
    const { coach, client } = await fixture();
    const { upload, draft } = await importFixture(coach.id, client.id);

    // Not signed in → 401
    mocks.authUserId = "";
    const anonymous = await importPlan({ draftId: draft.id });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "Unauthorized" });

    // Signed in but not a coach → 403
    const nonCoachClerkId = randomUUID();
    await db.user.create({ data: { clerkId: nonCoachClerkId, email: `nc-${nonCoachClerkId}@example.test`, isClient: true } });
    mocks.authUserId = nonCoachClerkId;
    const nonCoach = await importPlan({ draftId: draft.id });
    expect(nonCoach.status).toBe(403);
    expect(await nonCoach.json()).toEqual({ error: "Not a coach" });

    // Deactivated coach → 403
    const deactivatedClerkId = randomUUID();
    await db.user.create({ data: { clerkId: deactivatedClerkId, email: `dc-${deactivatedClerkId}@example.test`, isCoach: true, activeRole: "COACH", isDeactivated: true } });
    mocks.authUserId = deactivatedClerkId;
    const deactivated = await importPlan({ draftId: draft.id });
    expect(deactivated.status).toBe(403);
    expect(await deactivated.json()).toEqual({ error: "Account is pending deletion" });

    mocks.authUserId = coach.clerkId;

    // Missing draftId → 400
    const missing = await importPlan({ publish: true });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Missing draftId" });

    // Unknown draft → 404
    const unknown = await importPlan({ draftId: randomUUID() });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Draft not found" });

    // A draft whose upload belongs to ANOTHER coach → 404
    const otherCoachClerkId = randomUUID();
    const otherCoach = await db.user.create({ data: { clerkId: otherCoachClerkId, email: `oc-${otherCoachClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const foreign = await importFixture(otherCoach.id, client.id);
    const notMine = await importPlan({ draftId: foreign.draft.id });
    expect(notMine.status).toBe(404);
    expect(await notMine.json()).toEqual({ error: "Draft not found" });

    // A parsedJson override that fails the schema → 400 with details
    const invalid = await importPlan({ draftId: draft.id, parsedJson: { title: 42, meals: "nope" } });
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.error).toBe("Invalid meal plan data");
    expect(invalidBody.details).toBeTypeOf("object");

    // Nothing above may have written a plan.
    expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(0);
    expect(await uploadStatus(upload.id)).toBe("NEEDS_REVIEW");

    // An already-imported upload → 400, still no second plan for it.
    expect((await importPlan({ draftId: draft.id })).status).toBe(200);
    expect(await uploadStatus(upload.id)).toBe("IMPORTED");
    const alreadyImported = await importPlan({ draftId: draft.id });
    expect(alreadyImported.status).toBe(400);
    expect(await alreadyImported.json()).toEqual({ error: "Already imported" });
    expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(1);
  });
});
