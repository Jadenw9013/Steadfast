import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-739 — the three training publish transports' failure mapping, and the
 * import route's write ORDERING, deterministically.
 *
 * `tests/integration/training-publish-parity.test.ts` drives the race with real
 * concurrency and asserts the invariants that hold however PostgreSQL schedules
 * the transactions. It cannot pin the 409 bodies for the import route: two
 * imports publishing two DIFFERENT programs legitimately serialize (the
 * second's supersede demotes the first, both succeed), which T-730 measured at
 * 50/50 HTTP 200 over 25 concurrent pairs with zero lost races. So the new
 * `PUBLISH_RACE_LOST` / `PLAN_NOT_DRAFT` contract rows would otherwise ship
 * untested.
 *
 * Same remedy T-730 used in tests/integration/meal-plan-import-race-mapping.test.ts:
 * partially mock `@/lib/training-programs/publish` with `importOriginal`,
 * stubbing ONLY `publishTrainingProgramTarget`. The database, the auth ladders
 * and every other write stay real, which is what lets this file prove the
 * load-bearing ordering claim: on a failed publish the bookkeeping writes must
 * not have run, or the coach's retry hits the "Already imported" 400 and the
 * import is stranded forever.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  publishTarget: vi.fn(),
  revalidatePath: vi.fn(),
  pushTrainingProgramPublished: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/notifications/push", () => ({
  pushTrainingProgramPublished: mocks.pushTrainingProgramPublished,
}));
vi.mock("@/lib/training-programs/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/training-programs/publish")>()),
  publishTrainingProgramTarget: mocks.publishTarget,
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { saveTrainingProgram, publishTrainingProgram } from "@/app/actions/training-programs";
import { POST as publishRest } from "@/app/api/coach/clients/[clientId]/training/publish/route";
import { POST as importRoute } from "@/app/api/workout-import/import/route";
import { PUBLISHED_TRAINING_PROGRAM_INDEX } from "@/lib/training-programs/publish";
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

const doc = () => ({
  name: "Imported Program",
  notes: "Three sessions this week",
  days: [{ dayName: "Day 1", blocks: [{ type: "EXERCISE", title: "Back squat", content: "3x5" }] }],
});

const RACE_LOST_BODY = {
  error: "This program was already published or changed by someone else",
  code: "PUBLISH_RACE_LOST",
};
const NOT_DRAFT_BODY = { error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" };

suite("training publish failure mapping", () => {
  // Self-heal the raw-SQL partial index — see
  // tests/integration/training-publish-parity.test.ts's header for why neither
  // `db push` nor `migrate deploy` can be relied on to put it here. Guarded by
  // the local-database check above.
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
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isClient: true, pushMealPlanUpdates: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    mocks.authUserId = coach.clerkId;

    const workoutImport = await db.workoutImport.create({
      data: { coachId: coach.id, clientId: client.id, storagePath: `meal-plan-uploads/${randomUUID()}.pdf`, status: "NEEDS_REVIEW" },
    });
    const draft = await db.workoutImportDraft.create({
      data: { importId: workoutImport.id, parsedJson: { name: "Original", notes: "", days: [{ dayName: "Untouched", blocks: [] }] } },
    });
    return { coach, client, workoutImport, draft };
  }

  const importWorkout = (body: unknown) =>
    importRoute(
      new NextRequest("https://example.test/api/workout-import/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  const publishViaRest = (clientId: string, body: unknown) =>
    publishRest(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/training/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ clientId }) }
    );

  const importBody = (draftId: string, clientId: string, publish: boolean) => ({
    draftId,
    parsedJson: doc(),
    saveAsTemplate: false,
    clientId,
    publish,
  });

  async function actionDraft(clientId: string) {
    const created = await saveTrainingProgram({
      clientId,
      weekStartDate: CURRENT_WEEK_STR,
      days: [{ dayName: "Day 1", blocks: [{ type: "EXERCISE", title: "Squat", content: "3x5" }] }],
    });
    if ("error" in created) throw new Error(`expected a program: ${JSON.stringify(created.error)}`);
    return created.programId;
  }

  // ── Import route ──────────────────────────────────────────────────────────

  it("maps RACE_LOST to the frozen 409 body and leaves the import retryable", async () => {
    const { client, workoutImport, draft } = await fixture();
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "RACE_LOST" });

    const response = await importWorkout(importBody(draft.id, client.id, true));

    expect(response.status).toBe(409);
    // Byte-identical to the REST publish route — one condition, one sentence.
    expect(await response.json()).toEqual(RACE_LOST_BODY);

    // The bookkeeping writes are genuinely AFTER the publish. Marking the
    // import IMPORTED here would strand it behind the "Already imported" 400.
    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: workoutImport.id } })).status).toBe("NEEDS_REVIEW");
    const storedDraft = await db.workoutImportDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect((storedDraft.parsedJson as { name?: string }).name).toBe("Original");

    // The orphan DRAFT stays (the coach's retry deletes it at route.ts:122-129).
    const programs = await db.trainingProgram.findMany({ where: { clientId: client.id } });
    expect(programs).toHaveLength(1);
    expect(programs[0].status).toBe("DRAFT");
    expect(programs[0].publishedAt).toBeNull();

    // The early return means the client cache was never revalidated.
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/client", "layout");
  });

  it("maps NOT_DRAFT to the frozen PLAN_NOT_DRAFT 409 with the same bookkeeping guarantees", async () => {
    const { client, workoutImport, draft } = await fixture();
    // Unreachable in practice (the row was created microseconds earlier with a
    // literal `status: "DRAFT"`), but the branch exists and must return the
    // same string as the other publish surfaces.
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "NOT_DRAFT", status: "PUBLISHED" });

    const response = await importWorkout(importBody(draft.id, client.id, true));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(NOT_DRAFT_BODY);

    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: workoutImport.id } })).status).toBe("NEEDS_REVIEW");
    const storedDraft = await db.workoutImportDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect((storedDraft.parsedJson as { name?: string }).name).toBe("Original");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/client", "layout");
  });

  it("runs the bookkeeping writes only once the publish has succeeded", async () => {
    const { client, workoutImport, draft } = await fixture();
    mocks.publishTarget.mockImplementation(async (target: { id: string; clientId: string }) => ({
      ok: true,
      programId: target.id,
      clientId: target.clientId,
      publishedAt: new Date(),
      supersededCount: 0,
    }));

    const response = await importWorkout(importBody(draft.id, client.id, true));

    expect(response.status).toBe(200);
    // Proves the bookkeeping is genuinely AFTER the publish, not merely
    // reordered in the file: the same two writes that stayed untouched above
    // land here.
    expect((await db.workoutImport.findUniqueOrThrow({ where: { id: workoutImport.id } })).status).toBe("IMPORTED");
    const storedDraft = await db.workoutImportDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(storedDraft.parsedJson).toEqual(doc());
  });

  it("calls publishTrainingProgramTarget with the freshly created program, this client and a constructed DRAFT status", async () => {
    const { client, draft } = await fixture();
    mocks.publishTarget.mockImplementation(async (target: { id: string; clientId: string }) => ({
      ok: true,
      programId: target.id,
      clientId: target.clientId,
      publishedAt: new Date(),
      supersededCount: 0,
    }));

    const response = await importWorkout(importBody(draft.id, client.id, true));
    expect(response.status).toBe(200);
    const { programId } = await response.json();

    expect(mocks.publishTarget).toHaveBeenCalledTimes(1);
    // No `weekOf`: training supersede is client-scoped.
    expect(mocks.publishTarget).toHaveBeenCalledWith({
      id: programId,
      clientId: client.id,
      status: "DRAFT",
    });
  });

  it("never calls the publish service when the request did not ask to publish", async () => {
    const { client, draft } = await fixture();
    expect((await importWorkout(importBody(draft.id, client.id, false))).status).toBe(200);

    // …and with the `publish` field omitted entirely (schema default false).
    const second = await fixture();
    const noPublishField = { ...importBody(second.draft.id, second.client.id, false) } as Record<string, unknown>;
    delete noPublishField.publish;
    expect((await importWorkout(noPublishField)).status).toBe(200);

    expect(mocks.publishTarget).not.toHaveBeenCalled();
  });

  // ── REST publish route ────────────────────────────────────────────────────

  it("maps RACE_LOST to the frozen 409 on the REST publish route and sends no push", async () => {
    const { client } = await fixture();
    const programId = await actionDraft(client.id);
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "RACE_LOST" });

    const response = await publishViaRest(client.id, { programId });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(RACE_LOST_BODY);

    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.pushTrainingProgramPublished).not.toHaveBeenCalled();
  });

  it("maps NOT_DRAFT to the frozen PLAN_NOT_DRAFT 409 on the REST publish route", async () => {
    const { client } = await fixture();
    const programId = await actionDraft(client.id);
    mocks.publishTarget.mockResolvedValue({ ok: false, code: "NOT_DRAFT", status: "SUPERSEDED" });

    const response = await publishViaRest(client.id, { programId });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(NOT_DRAFT_BODY);
  });

  // ── Server action ─────────────────────────────────────────────────────────

  it("throws the frozen messages from the server action", async () => {
    const { client } = await fixture();
    const programId = await actionDraft(client.id);

    mocks.publishTarget.mockResolvedValue({ ok: false, code: "RACE_LOST" });
    // Note the trailing "— refresh and try again." which the REST body does NOT
    // have; both strings are frozen exactly as they are.
    await expect(publishTrainingProgram({ programId })).rejects.toThrow(
      "This program was already published or changed by someone else — refresh and try again."
    );

    mocks.publishTarget.mockResolvedValue({ ok: false, code: "NOT_DRAFT", status: "PUBLISHED" });
    await expect(publishTrainingProgram({ programId })).rejects.toThrow("Can only publish drafts");
  });
});
