import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-739 — the three training-program publish transports (the
 * `publishTrainingProgram` server action, the iOS-facing REST publish route and
 * the OCR path `/api/workout-import/import`) must publish identically:
 * supersede the client's previous PUBLISHED program, keep at most ONE PUBLISHED
 * row per client, and return a 409 (never a 500) to whoever loses a concurrent
 * publish race.
 *
 * The import route is the P0 this file exists for: it used to `create` a row
 * with `status: "PUBLISHED"` directly, with no supersede and no race guard, so
 * import-and-publish for a client who already had a published program left two
 * PUBLISHED rows (and, once the partial unique index ships, a generic
 * "Unique constraint failed").
 *
 * Supersede is scoped to `clientId` ALONE here — deliberately unlike the meal
 * twin's `(clientId, weekOf)`. The "supersede is client-scoped, not
 * week-scoped" case below is the guard against someone "harmonizing" the two.
 *
 * These assertions are only meaningful with the partial unique index
 * `TrainingProgram_one_published_per_client` present. Reproducibility note,
 * identical to tests/integration/meal-plan-publish-parity.test.ts:
 *   - The index is raw SQL inside
 *     `prisma/migrations/20260913220000_plan_supersede_backfill/migration.sql`
 *     and is deliberately NOT mirrored in `schema.prisma`, so `prisma db push`
 *     (how this local test DB is kept in sync) neither creates it nor preserves
 *     it — a later `db push` can drop it.
 *   - `prisma migrate deploy` cannot install it either: the local test DB was
 *     created by `db push` and was never baselined, so `migrate deploy` fails
 *     with P3005 ("database schema is not empty").
 * So `beforeAll` below creates the index itself if it is missing, which makes
 * this suite self-healing and reproducible on a fresh checkout. The first test
 * still asserts (never skips) that the index exists, so a missing index can
 * never let the rest of the file pass vacuously.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  pushTrainingProgramPublished: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/notifications/push", () => ({
  pushTrainingProgramPublished: mocks.pushTrainingProgramPublished,
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { saveTrainingProgram, publishTrainingProgram } from "@/app/actions/training-programs";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/training/publish/route";
import { POST as importRoute } from "@/app/api/workout-import/import/route";
import {
  PUBLISHED_TRAINING_PROGRAM_INDEX,
  publishTrainingProgramTarget,
} from "@/lib/training-programs/publish";
import { getCurrentWeekMonday } from "@/lib/utils/date";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const CURRENT_WEEK = getCurrentWeekMonday();
const CURRENT_WEEK_STR = CURRENT_WEEK.toISOString().split("T")[0];
const weeksAgo = (n: number) =>
  new Date(CURRENT_WEEK.getTime() - n * 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

/** Satisfies parsedWorkoutProgramSchema (`days` needs `.min(1)`). */
const doc = () => ({
  name: "Imported Program",
  notes: "Three sessions this week",
  days: [
    {
      dayName: "Day 1 — Lower",
      blocks: [
        { type: "ACTIVATION", title: "Glute bridge", content: "2x15" },
        { type: "EXERCISE", title: "Back squat", content: "3x5 @ RPE 8" },
      ],
    },
    {
      dayName: "Day 2 — Upper",
      blocks: [{ type: "EXERCISE", title: "Bench press", content: "4x6" }],
    },
  ],
});

suite("training-program publish parity (action vs REST vs workout import) with real PostgreSQL constraints", () => {
  // Self-heal the raw-SQL partial index (see the file header for why neither
  // `db push` nor `migrate deploy` can be relied on to put it here). Guarded by
  // the local-database check above, so this can only ever run against
  // 127.0.0.1/steadfast_security_test.
  beforeAll(async () => {
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${PUBLISHED_TRAINING_PROGRAM_INDEX}" ON "TrainingProgram"("clientId") WHERE (status = 'PUBLISHED')`
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pushTrainingProgramPublished.mockResolvedValue(undefined);
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

  /** A WorkoutImport awaiting review plus its parsed draft. */
  async function workoutFixture(coachId: string, clientId: string | null, parsedJson: unknown = doc()) {
    const workoutImport = await db.workoutImport.create({
      data: { coachId, clientId, storagePath: `meal-plan-uploads/${randomUUID()}.pdf`, status: "NEEDS_REVIEW" },
    });
    const draft = await db.workoutImportDraft.create({
      data: { importId: workoutImport.id, parsedJson: parsedJson as object },
    });
    return { workoutImport, draft };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  const publishViaRest = (clientId: string, body: unknown) =>
    publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/training/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      params(clientId)
    );

  const importWorkout = (body: unknown) =>
    importRoute(
      new NextRequest("https://example.test/api/workout-import/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  async function draft(clientId: string, weekStartDate: string) {
    const created = await saveTrainingProgram({
      clientId,
      weekStartDate,
      days: [{ dayName: "Day 1", blocks: [{ type: "EXERCISE", title: "Squat", content: "3x5" }] }],
    });
    if ("error" in created) throw new Error(`expected a program: ${JSON.stringify(created.error)}`);
    return created.programId;
  }

  const statusOf = async (id: string) =>
    (await db.trainingProgram.findUniqueOrThrow({ where: { id } })).status;
  const publishedCount = (clientId: string) =>
    db.trainingProgram.count({ where: { clientId, status: "PUBLISHED" } });
  const programCount = (clientId: string) => db.trainingProgram.count({ where: { clientId } });

  // ── Guard: without the partial index everything below passes vacuously ─────

  it("the partial unique index TrainingProgram_one_published_per_client exists on this database", async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname = ${PUBLISHED_TRAINING_PROGRAM_INDEX}
    `;
    expect(rows).toHaveLength(1);
  });

  // ── The production break (acceptance criterion 1) ──────────────────────────

  it("import-and-publish supersedes the client's existing PUBLISHED program", async () => {
    const { coach, client } = await fixture();

    const p1 = await draft(client.id, CURRENT_WEEK_STR);
    expect(await publishTrainingProgram({ programId: p1 })).toEqual({ success: true });
    expect(await statusOf(p1)).toBe("PUBLISHED");

    const { draft: importDraft } = await workoutFixture(coach.id, client.id);
    const response = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: true,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "imported",
      mode: "program",
      programId: expect.any(String),
      clientId: client.id,
      weekStartDate: CURRENT_WEEK_STR,
    });

    // The P0: the old program is demoted, not left live alongside the new one.
    expect(await statusOf(p1)).toBe("SUPERSEDED");
    const imported = await db.trainingProgram.findUniqueOrThrow({ where: { id: body.programId } });
    expect(imported.status).toBe("PUBLISHED");
    expect(imported.publishedAt).not.toBeNull();
    expect(await publishedCount(client.id)).toBe(1);
  });

  it("supersede is client-scoped, not week-scoped (do not harmonize with the meal twin)", async () => {
    // The meal service filters supersede by (clientId, weekOf); training must
    // NOT. A copy-paste that adds `weekOf` here leaves week A's program
    // PUBLISHED alongside the new one and trips the partial unique index.
    const { coach, client } = await fixture();

    const weekA = await draft(client.id, weeksAgo(2));
    await publishTrainingProgram({ programId: weekA });
    expect(await statusOf(weekA)).toBe("PUBLISHED");

    const { draft: importDraft } = await workoutFixture(coach.id, client.id);
    const response = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: true,
    });
    expect(response.status).toBe(200);

    expect(await statusOf(weekA)).toBe("SUPERSEDED");
    expect(await publishedCount(client.id)).toBe(1);

    // Same assertion driving the publish through the REST route instead.
    const { client: client2 } = await fixture();
    const otherWeek = await draft(client2.id, weeksAgo(2));
    await publishTrainingProgram({ programId: otherWeek });

    const thisWeek = await draft(client2.id, CURRENT_WEEK_STR);
    expect((await publishViaRest(client2.id, { programId: thisWeek })).status).toBe(200);

    expect(await statusOf(otherWeek)).toBe("SUPERSEDED");
    expect(await statusOf(thisWeek)).toBe("PUBLISHED");
    expect(await publishedCount(client2.id)).toBe(1);
  });

  it("a vanished publish target rolls the supersede back instead of leaving zero PUBLISHED programs", async () => {
    // Review finding 1 (T-739 r1). The supersede and the flip must share one
    // fate. If the target row disappears between the caller's read and the
    // transaction — reachable via the import route's unguarded existing-DRAFT
    // delete — a post-commit `flipped === 0` check would report RACE_LOST while
    // the already-committed supersede had demoted the client's live program,
    // leaving the client with NOTHING published.
    const { client } = await fixture();

    const p1 = await draft(client.id, weeksAgo(1));
    expect(await publishTrainingProgram({ programId: p1 })).toEqual({ success: true });
    expect(await statusOf(p1)).toBe("PUBLISHED");

    // The target the caller read, then deleted out from under it.
    const vanished = await draft(client.id, CURRENT_WEEK_STR);
    await db.trainingProgram.delete({ where: { id: vanished } });

    const result = await publishTrainingProgramTarget({
      id: vanished,
      clientId: client.id,
      status: "DRAFT",
    });

    expect(result).toEqual({ ok: false, code: "RACE_LOST" });
    expect(await statusOf(p1)).toBe("PUBLISHED");
    expect(await publishedCount(client.id)).toBe(1);
  });

  // ── Regressions: the two pre-existing surfaces behave exactly as before ────

  it("REST publish supersedes the previous published program", async () => {
    const { client } = await fixture();

    const p1 = await draft(client.id, weeksAgo(1));
    expect((await publishViaRest(client.id, { programId: p1 })).status).toBe(200);

    const p2 = await draft(client.id, CURRENT_WEEK_STR);
    const response = await publishViaRest(client.id, { programId: p2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    expect(await statusOf(p1)).toBe("SUPERSEDED");
    expect(await statusOf(p2)).toBe("PUBLISHED");
    expect(await publishedCount(client.id)).toBe(1);
  });

  it("the server action publishes identically", async () => {
    const { client } = await fixture();

    const p1 = await draft(client.id, weeksAgo(1));
    expect(await publishTrainingProgram({ programId: p1 })).toEqual({ success: true });

    const p2 = await draft(client.id, CURRENT_WEEK_STR);
    expect(await publishTrainingProgram({ programId: p2 })).toEqual({ success: true });

    expect(await statusOf(p1)).toBe("SUPERSEDED");
    expect(await statusOf(p2)).toBe("PUBLISHED");
    expect(await publishedCount(client.id)).toBe(1);
  });

  it("supersedes across surfaces — action then import then REST leaves exactly one PUBLISHED", async () => {
    const { coach, client } = await fixture();

    const p1 = await draft(client.id, weeksAgo(2));
    await publishTrainingProgram({ programId: p1 });
    expect(await publishedCount(client.id)).toBe(1);

    const { draft: importDraft } = await workoutFixture(coach.id, client.id);
    const imported = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: true,
    });
    expect(imported.status).toBe(200);
    const importedId = (await imported.json()).programId as string;
    expect(await statusOf(p1)).toBe("SUPERSEDED");
    expect(await publishedCount(client.id)).toBe(1);

    const p3 = await draft(client.id, weeksAgo(1));
    expect((await publishViaRest(client.id, { programId: p3 })).status).toBe(200);
    expect(await statusOf(importedId)).toBe("SUPERSEDED");
    expect(await statusOf(p3)).toBe("PUBLISHED");
    expect(await publishedCount(client.id)).toBe(1);
  });

  // ── The import route's own behavior, unchanged apart from the publish ──────

  it("first-ever import-and-publish is unchanged", async () => {
    const { coach, client } = await fixture();
    const { draft: importDraft } = await workoutFixture(coach.id, client.id);

    const response = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: true,
    });
    expect(response.status).toBe(200);
    const { programId } = await response.json();

    const program = await db.trainingProgram.findUniqueOrThrow({
      where: { id: programId },
      include: { days: { include: { blocks: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } },
    });
    expect(program.status).toBe("PUBLISHED");
    expect(program.publishedAt).not.toBeNull();
    expect(program.clientNotes).toBe(doc().notes);
    expect(await publishedCount(client.id)).toBe(1);

    expect(program.days.map((d) => [d.dayName, d.sortOrder])).toEqual([
      ["Day 1 — Lower", 0],
      ["Day 2 — Upper", 1],
    ]);
    expect(program.days[0].blocks.map((b) => [b.type, b.title, b.sortOrder])).toEqual([
      ["ACTIVATION", "Glute bridge", 0],
      ["EXERCISE", "Back squat", 1],
    ]);
    expect(program.days[1].blocks.map((b) => [b.type, b.title, b.sortOrder])).toEqual([
      ["EXERCISE", "Bench press", 0],
    ]);
  });

  it("import as a draft is unchanged (the path the shipped UI actually uses)", async () => {
    const { coach, client } = await fixture();
    const { workoutImport, draft: importDraft } = await workoutFixture(coach.id, client.id);

    const response = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: false,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "imported",
      mode: "program",
      programId: expect.any(String),
      clientId: client.id,
      weekStartDate: CURRENT_WEEK_STR,
    });

    const program = await db.trainingProgram.findUniqueOrThrow({
      where: { id: body.programId },
      include: { days: { include: { blocks: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } },
    });
    expect(program.status).toBe("DRAFT");
    expect(program.publishedAt).toBeNull();
    expect(program.days.map((d) => d.dayName)).toEqual(["Day 1 — Lower", "Day 2 — Upper"]);
    expect(program.days[0].blocks.map((b) => b.title)).toEqual(["Glute bridge", "Back squat"]);
    expect(await publishedCount(client.id)).toBe(0);

    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: workoutImport.id } })).status).toBe("IMPORTED");
    const storedDraft = await db.workoutImportDraft.findUniqueOrThrow({ where: { id: importDraft.id } });
    expect(storedDraft.parsedJson).toEqual(doc());
  });

  it("import replaces the week's existing DRAFT", async () => {
    const { coach, client } = await fixture();
    const existing = await draft(client.id, CURRENT_WEEK_STR);
    const { draft: importDraft } = await workoutFixture(coach.id, client.id);

    const response = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: false,
    });
    expect(response.status).toBe(200);

    expect(await db.trainingProgram.findUnique({ where: { id: existing } })).toBeNull();
    expect(await db.trainingProgram.count({ where: { clientId: client.id, status: "DRAFT" } })).toBe(1);
  });

  it("the saveAsTemplate branch is unchanged and creates no TrainingProgram", async () => {
    const { coach, client } = await fixture();
    const { workoutImport, draft: importDraft } = await workoutFixture(coach.id, client.id);

    const response = await importWorkout({
      draftId: importDraft.id,
      parsedJson: doc(),
      saveAsTemplate: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "imported", mode: "template", templateId: expect.any(String) });

    const template = await db.trainingTemplate.findUniqueOrThrow({
      where: { id: body.templateId },
      include: { days: { include: { blocks: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } },
    });
    expect(template.coachId).toBe(coach.id);
    expect(template.days.map((d) => d.dayName)).toEqual(["Day 1 — Lower", "Day 2 — Upper"]);
    expect(template.days[0].blocks.map((b) => b.title)).toEqual(["Glute bridge", "Back squat"]);

    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: workoutImport.id } })).status).toBe("IMPORTED");
    expect(await programCount(client.id)).toBe(0);
  });

  // ── Auth ladders ──────────────────────────────────────────────────────────

  it("the import route's auth ladder is unchanged and never creates a program on rejection", async () => {
    const { coach, client } = await fixture();

    // No Clerk user → 401
    const { draft: d401 } = await workoutFixture(coach.id, client.id);
    mocks.authUserId = "";
    const unauth = await importWorkout({ draftId: d401.id, parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: "Unauthorized" });

    // Signed-in non-coach → 403
    mocks.authUserId = client.clerkId;
    const notCoach = await importWorkout({ draftId: d401.id, parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(notCoach.status).toBe(403);
    expect(await notCoach.json()).toEqual({ error: "Not a coach" });

    // Deactivated coach → 403
    const deadClerkId = randomUUID();
    const deactivated = await db.user.create({ data: { clerkId: deadClerkId, email: `dead-${deadClerkId}@example.test`, isCoach: true, activeRole: "COACH", isDeactivated: true } });
    await db.coachClient.create({ data: { coachId: deactivated.id, clientId: client.id } });
    mocks.authUserId = deactivated.clerkId;
    const pendingDeletion = await importWorkout({ draftId: d401.id, parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(pendingDeletion.status).toBe(403);
    expect(await pendingDeletion.json()).toEqual({ error: "Account is pending deletion" });

    mocks.authUserId = coach.clerkId;

    // Missing draftId → 400
    const noDraftId = await importWorkout({ parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(noDraftId.status).toBe(400);

    // Unknown draftId → 404
    const unknown = await importWorkout({ draftId: randomUUID(), parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Draft not found" });

    // A draft owned by another coach → 404 (never 403 — no existence leak)
    const { coach: otherCoach, client: otherClient } = await fixture();
    const { draft: othersDraft } = await workoutFixture(otherCoach.id, otherClient.id);
    mocks.authUserId = coach.clerkId;
    const othersImport = await importWorkout({ draftId: othersDraft.id, parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(othersImport.status).toBe(404);
    expect(await othersImport.json()).toEqual({ error: "Draft not found" });

    // An import already IMPORTED → 400
    const { workoutImport: doneImport, draft: doneDraft } = await workoutFixture(coach.id, client.id);
    await db.workoutImport.update({ where: { id: doneImport.id }, data: { status: "IMPORTED" } });
    const alreadyImported = await importWorkout({ draftId: doneDraft.id, parsedJson: doc(), saveAsTemplate: false, clientId: client.id });
    expect(alreadyImported.status).toBe(400);
    expect(await alreadyImported.json()).toEqual({ error: "Already imported" });

    // parsedJson failing parsedWorkoutProgramSchema → 400 with details
    const badProgram = await importWorkout({ draftId: d401.id, parsedJson: { ...doc(), days: [] }, saveAsTemplate: false, clientId: client.id });
    expect(badProgram.status).toBe(400);
    const badBody = await badProgram.json();
    expect(badBody.error).toBe("Invalid program data");
    expect(badBody.details).toBeDefined();

    // No clientId on the body or the import → 400
    const { draft: clientlessDraft } = await workoutFixture(coach.id, null);
    const noClient = await importWorkout({ draftId: clientlessDraft.id, parsedJson: doc(), saveAsTemplate: false });
    expect(noClient.status).toBe(400);
    expect(await noClient.json()).toEqual({ error: "clientId required for program assignment" });

    // A clientId with no CoachClient row → 403
    const strangerClerkId = randomUUID();
    const stranger = await db.user.create({ data: { clerkId: strangerClerkId, email: `stranger-${strangerClerkId}@example.test`, isClient: true } });
    const unassigned = await importWorkout({ draftId: d401.id, parsedJson: doc(), saveAsTemplate: false, clientId: stranger.id });
    expect(unassigned.status).toBe(403);
    expect(await unassigned.json()).toEqual({ error: "Not assigned to this client" });

    // Not one of those rejections created a program.
    expect(await programCount(client.id)).toBe(0);
    expect(await programCount(stranger.id)).toBe(0);
    expect(await programCount(otherClient.id)).toBe(0);
  });

  it("the REST publish route's auth ladder is unchanged", async () => {
    const { client } = await fixture();
    const programId = await draft(client.id, CURRENT_WEEK_STR);

    // No Clerk user → 401
    mocks.authUserId = "";
    const unauth = await publishViaRest(client.id, { programId });
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: "Unauthorized" });

    // Signed-in non-coach → 403
    mocks.authUserId = client.clerkId;
    const notCoach = await publishViaRest(client.id, { programId });
    expect(notCoach.status).toBe(403);
    expect(await notCoach.json()).toEqual({ error: "Forbidden" });

    // A coach with no CoachClient row for this client → 403
    const strangerClerkId = randomUUID();
    const stranger = await db.user.create({ data: { clerkId: strangerClerkId, email: `stranger-${strangerClerkId}@example.test`, isCoach: true, activeRole: "COACH" } });
    mocks.authUserId = stranger.clerkId;
    const forbidden = await publishViaRest(client.id, { programId });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });
    expect(await statusOf(programId)).toBe("DRAFT");

    const { coach, client: coachsClient } = await fixture();
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;

    // Malformed body → 422 with details
    const malformed = await publishViaRest(client.id, { programId: "" });
    expect(malformed.status).toBe(422);
    const malformedBody = await malformed.json();
    expect(malformedBody.error).toBe("Validation failed");
    expect(malformedBody.details).toBeDefined();

    // Unknown programId → 404
    const missing = await publishViaRest(client.id, { programId: randomUUID() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Training program not found" });

    // A program belonging to a different client than the URL segment → 403
    const othersProgram = await draft(coachsClient.id, CURRENT_WEEK_STR);
    const mismatch = await publishViaRest(client.id, { programId: othersProgram });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ error: "Forbidden" });
    expect(await statusOf(othersProgram)).toBe("DRAFT");

    // Republishing an already-PUBLISHED program → 409 PLAN_NOT_DRAFT
    expect((await publishViaRest(client.id, { programId })).status).toBe(200);
    const notDraft = await publishViaRest(client.id, { programId });
    expect(notDraft.status).toBe(409);
    expect(await notDraft.json()).toEqual({ error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" });
  });

  // ── Notifications stay exactly where they are (T-666 owns changing them) ───

  it("push notification behavior is unchanged", async () => {
    const { client } = await fixture();
    await db.user.update({ where: { id: client.id }, data: { pushMealPlanUpdates: true } });

    const p1 = await draft(client.id, weeksAgo(2));
    expect((await publishViaRest(client.id, { programId: p1 })).status).toBe(200);
    await vi.waitFor(() => expect(mocks.pushTrainingProgramPublished).toHaveBeenCalledTimes(1));
    expect(mocks.pushTrainingProgramPublished.mock.calls[0][0]).toBe(client.id);

    // Opted out → never pushed.
    mocks.pushTrainingProgramPublished.mockClear();
    await db.user.update({ where: { id: client.id }, data: { pushMealPlanUpdates: false } });
    const p2 = await draft(client.id, weeksAgo(1));
    expect((await publishViaRest(client.id, { programId: p2 })).status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.pushTrainingProgramPublished).not.toHaveBeenCalled();

    // The action has never pushed.
    await db.user.update({ where: { id: client.id }, data: { pushMealPlanUpdates: true } });
    const p3 = await draft(client.id, CURRENT_WEEK_STR);
    await publishTrainingProgram({ programId: p3 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.pushTrainingProgramPublished).not.toHaveBeenCalled();
  });

  // ── Races (acceptance criterion 3) ────────────────────────────────────────

  it("concurrent import-and-publish never 500s and leaves exactly one PUBLISHED program", async () => {
    const { coach, client } = await fixture();
    // Precondition, load-bearing: no existing DRAFT for the current week, so
    // the route's pre-existing unguarded read-then-delete (out of scope for
    // T-739) cannot make this test flaky with a P2025 → 500.
    expect(await db.trainingProgram.count({ where: { clientId: client.id, status: "DRAFT" } })).toBe(0);

    const a = await workoutFixture(coach.id, client.id);
    const b = await workoutFixture(coach.id, client.id);
    const payload = (draftId: string) => ({
      draftId,
      parsedJson: doc(),
      saveAsTemplate: false,
      clientId: client.id,
      publish: true,
    });

    const settled = await Promise.allSettled([
      importWorkout(payload(a.draft.id)),
      importWorkout(payload(b.draft.id)),
    ]);
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    const responses = settled.map((r) => (r as PromiseFulfilledResult<Response>).value);

    // Deliberately NOT asserting "exactly one winner": two imports publishing
    // two different programs can legitimately serialize (the second's supersede
    // sees the first's committed row and demotes it), and that outcome is
    // correct. The invariants that hold either way:
    const fixtures = [a, b];
    for (const [i, response] of responses.entries()) {
      expect([200, 409]).toContain(response.status);
      const body = await response.json();
      // A P2002 escaping to prismaErrorMessage is the regression this ticket kills.
      expect(JSON.stringify(body)).not.toContain("Unique constraint failed");
      if (response.status === 200) {
        // The reported outcome matches the persisted state: a 200 means the
        // program really was published. It may since have been SUPERSEDED by
        // the other racer if the two serialized, so the invariant is
        // "published at some point", not "still PUBLISHED".
        const program = await db.trainingProgram.findUniqueOrThrow({ where: { id: body.programId } });
        expect(program.publishedAt).not.toBeNull();
        expect(["PUBLISHED", "SUPERSEDED"]).toContain(program.status);
        expect(
          (await db.workoutImport.findUniqueOrThrow({ where: { id: fixtures[i].workoutImport.id } })).status
        ).toBe("IMPORTED");
      } else {
        expect(body).toEqual({
          error: "This program was already published or changed by someone else",
          code: "PUBLISH_RACE_LOST",
        });
        // …and a loser's import stays retryable.
        expect(
          (await db.workoutImport.findUniqueOrThrow({ where: { id: fixtures[i].workoutImport.id } })).status
        ).toBe("NEEDS_REVIEW");
      }
    }

    expect(await publishedCount(client.id)).toBe(1);
  });

  it("concurrent publish across surfaces never 500s and leaves exactly one PUBLISHED program", async () => {
    const { client } = await fixture();
    const programId = await draft(client.id, CURRENT_WEEK_STR);

    const [actionResult, restResult] = await Promise.allSettled([
      publishTrainingProgram({ programId }),
      publishViaRest(client.id, { programId }),
    ]);

    expect(restResult.status).toBe("fulfilled");
    const restResponse = (restResult as PromiseFulfilledResult<Response>).value;
    expect([200, 409]).toContain(restResponse.status);

    // Either frozen failure shape is correct here. A loser that reads the row
    // BEFORE the winner commits sees DRAFT and loses in the transaction
    // (RACE_LOST); a loser that reads it AFTER sees PUBLISHED and loses at the
    // status check (NOT_DRAFT). Both are handled, neither is a 500, and neither
    // leaks a raw Prisma message.
    if (restResponse.status === 409) {
      expect([
        {
          error: "This program was already published or changed by someone else",
          code: "PUBLISH_RACE_LOST",
        },
        { error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" },
      ]).toContainEqual(await restResponse.json());
    }
    if (actionResult.status === "rejected") {
      expect([
        "This program was already published or changed by someone else — refresh and try again.",
        "Can only publish drafts",
      ]).toContain((actionResult.reason as Error).message);
    }
    // At least one of the two surfaces must have lost — both raced the SAME
    // draft, and only one `updateMany where status: "DRAFT"` can match.
    expect(actionResult.status === "rejected" || restResponse.status === 409).toBe(true);

    expect(await statusOf(programId)).toBe("PUBLISHED");
    expect(await publishedCount(client.id)).toBe(1);
  });
});
