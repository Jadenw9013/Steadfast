import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
  clerkClient: async () => ({ users: { deleteUser: vi.fn() } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { NextRequest } from "next/server";
import { saveTrainingProgram, publishTrainingProgram } from "@/app/actions/training-programs";
import { PUT as putTrainingRest } from "@/app/api/coach/clients/[clientId]/training/route";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { db } from "@/lib/db";

/**
 * T-880 regression suite. Run through the local test DB:
 *   DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
 *   SECURITY_INTEGRATION=1 pnpm exec vitest run tests/integration/training-save-fork-regression.test.ts
 *
 * Cases 1 and 7 ("THE NEGATIVE CONTROL" and its REST twin) must FAIL on unmodified
 * 04e8d41 (origin/main) — the failing-then-passing output is pasted in the
 * web-engineer report at board/reviews/T-880-web-engineer-r1.md (round 2).
 * QA writes the authoritative run to board/evidence/T-880.md once this lands.
 */

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const INDEX_NAME = "TrainingProgram_one_published_per_client";

suite("T-880: saveTrainingProgram and REST PUT never write into a non-DRAFT training program", () => {
  let indexExistedBeforeSuite = false;

  beforeAll(async () => {
    const rows = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'TrainingProgram' AND indexname = '${INDEX_NAME}'`
    );
    indexExistedBeforeSuite = rows.length > 0;
    // Several cases here (C4, C6, C7) intentionally create a second PUBLISHED
    // row for the same client+week, which this team/sprint-1 index forbids.
    // It does not exist on production (04e8d41); drop it here for the
    // duration of this suite only.
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEX_NAME}"`);
  });

  // Track every client/user/template this suite creates so teardown can
  // guarantee no duplicate PUBLISHED rows (or FK-blocking templates) survive
  // before recreating the index, exactly as T-803's suite does for the same
  // shared local test DB.
  const createdClientIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdTemplateIds: string[] = [];

  afterAll(async () => {
    let cleanupError: unknown = null;

    // Steps 1-2 are best-effort with every failure captured, never thrown
    // directly — so the `finally` below (index recreate + disconnect) always
    // runs regardless of what happens here. This is a genuine try/finally,
    // not the previous round's ad hoc catch: nothing between here and the
    // final `throw cleanupError` can skip the index recreate.
    try {
      // Step 1: guarantee no duplicate PUBLISHED rows for this suite's clients
      // survive, ORM path or not. If deleteMany throws before removing the
      // deliberate two-PUBLISHED-rows fixtures, fall back to a raw DELETE that
      // does not go through the same code path. The fallback itself is now
      // guarded: if it also throws (dropped connection, lock timeout — the
      // same conditions that made the ORM call throw), that becomes the
      // reported cleanupError instead of escaping before the index recreate.
      try {
        await db.trainingProgram.deleteMany({ where: { clientId: { in: createdClientIds } } });
      } catch (err) {
        cleanupError = err;
        if (createdClientIds.length > 0) {
          try {
            await db.$executeRawUnsafe(
              `DELETE FROM "TrainingProgram" WHERE "clientId" = ANY($1::text[])`,
              createdClientIds
            );
          } catch (fallbackErr) {
            cleanupError = fallbackErr;
          }
        }
      }

      // Step 1b: TrainingTemplate.coachId and TrainingProgram.templateSourceId
      // are both Restrict FKs — templates created for the templateSourceId
      // assertions must be removed before step 2 deletes the coach, and after
      // step 1 has already cleared any TrainingProgram rows that reference them.
      try {
        if (createdTemplateIds.length > 0) {
          await db.trainingTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
        }
      } catch (err) {
        cleanupError = cleanupError ?? err;
      }

      // Step 2: best-effort cleanup of coach/client/user rows. Does not touch
      // the partial unique index, so a failure here must not block the
      // recreate, but must not be swallowed either.
      try {
        await db.coachClient.deleteMany({
          where: { OR: [{ coachId: { in: createdUserIds } }, { clientId: { in: createdUserIds } }] },
        });
        await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      } catch (err) {
        cleanupError = cleanupError ?? err;
      }
    } finally {
      // Step 3: recreate unconditionally, even if something above threw past
      // its own try/catch. Guarded individually so a failure here becomes a
      // reported cleanupError instead of a silent skip, and `$disconnect` is
      // in its own nested `finally` so it always runs last.
      try {
        if (indexExistedBeforeSuite) {
          await db.$executeRawUnsafe(
            `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}" ON public."TrainingProgram" USING btree ("clientId") WHERE (status = 'PUBLISHED'::"TrainingProgramStatus")`
          );
        }
      } catch (err) {
        cleanupError = cleanupError ?? err;
      } finally {
        await db.$disconnect();
      }
    }

    // Loud, not silent: if any step hit a real failure, a human needs to
    // know the shared local test DB may have residue, rather than the suite
    // reporting green.
    if (cleanupError) throw cleanupError;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function fixture() {
    const coachId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachId, email: `${coachId}@example.test`, isCoach: true, activeRole: "COACH" } });
    const clientId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientId, email: `${clientId}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    createdClientIds.push(client.id);
    createdUserIds.push(coach.id, client.id);
    return { coach, client };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  const WEEK = new Date("2026-09-14T00:00:00Z");
  const WEEK_STR = "2026-09-14";

  async function seedTemplate(coachId: string) {
    const template = await db.trainingTemplate.create({
      data: { coachId, name: "T-880 template" },
      select: { id: true },
    });
    createdTemplateIds.push(template.id);
    return template;
  }

  async function seedPublished(clientId: string, opts: {
    dayName?: string;
    injuries?: string | null;
    equipment?: string | null;
    templateSourceId?: string | null;
    publishedAt?: Date;
    weeklyFrequency?: number | null;
    clientNotes?: string | null;
  } = {}) {
    return db.trainingProgram.create({
      data: {
        clientId,
        weekOf: WEEK,
        status: "PUBLISHED",
        publishedAt: opts.publishedAt ?? new Date("2026-09-14T12:00:00Z"),
        injuries: opts.injuries ?? null,
        equipment: opts.equipment ?? null,
        templateSourceId: opts.templateSourceId ?? null,
        weeklyFrequency: opts.weeklyFrequency ?? null,
        clientNotes: opts.clientNotes ?? null,
        days: {
          create: [
            {
              dayName: opts.dayName ?? "Old A",
              sortOrder: 0,
              blocks: { create: [{ type: "EXERCISE", title: "Squat", content: "5x5", sortOrder: 0 }] },
            },
          ],
        },
      },
    });
  }

  async function seedDraft(clientId: string, dayName = "Draft A") {
    return db.trainingProgram.create({
      data: {
        clientId,
        weekOf: WEEK,
        status: "DRAFT",
        days: {
          create: [
            { dayName, sortOrder: 0, blocks: { create: [{ type: "EXERCISE", title: "Bench", content: "3x8", sortOrder: 0 }] } },
          ],
        },
      },
    });
  }

  async function dayNames(programId: string) {
    const days = await db.trainingDay.findMany({ where: { programId }, orderBy: { sortOrder: "asc" } });
    return days.map((d) => d.dayName);
  }

  function actionPayload(clientId: string, dayNamesArg: string[], extra: Record<string, unknown> = {}) {
    return {
      clientId,
      weekStartDate: WEEK_STR,
      days: dayNamesArg.map((dayName) => ({ dayName, blocks: [] })),
      ...extra,
    };
  }

  function restRequest(body: unknown) {
    return new NextRequest("https://example.test/api/coach/clients/x/training", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("C1 — THE NEGATIVE CONTROL: save against a PUBLISHED week forks instead of demoting", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id);

    const result = await saveTrainingProgram(actionPayload(client.id, ["New A"]));
    expect("error" in result).toBe(false);
    const newProgramId = (result as { programId: string }).programId;
    expect(newProgramId).not.toBe(published.id);

    const originalRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(originalRow.status).toBe("PUBLISHED");
    expect(originalRow.publishedAt?.toISOString()).toBe(published.publishedAt?.toISOString());
    expect(await dayNames(published.id)).toEqual(["Old A"]);

    const stillPublished = await getPublishedTrainingProgram(client.id);
    expect(stillPublished?.id).toBe(published.id);

    const newRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: newProgramId } });
    expect(newRow.status).toBe("DRAFT");
    expect(newRow.publishedAt).toBeNull();
    expect(newRow.weekOf.toISOString()).toBe(WEEK.toISOString());
    expect(await dayNames(newProgramId)).toEqual(["New A"]);
  });

  it("C2 — regression: an existing DRAFT is updated in place", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraft(client.id);
    const result = await saveTrainingProgram(actionPayload(client.id, ["Updated A"]));
    expect((result as { programId: string }).programId).toBe(draft.id);

    const count = await db.trainingProgram.count({ where: { clientId: client.id, weekOf: WEEK } });
    expect(count).toBe(1);
    expect(await dayNames(draft.id)).toEqual(["Updated A"]);
  });

  it("C3 — regression: an empty week creates a new DRAFT", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const result = await saveTrainingProgram(actionPayload(client.id, ["Day One"]));
    const newProgramId = (result as { programId: string }).programId;
    const row = await db.trainingProgram.findUniqueOrThrow({ where: { id: newProgramId } });
    expect(row.status).toBe("DRAFT");
    expect(row.clientId).toBe(client.id);
  });

  it("C4 — no fork storm: a second save against the same week reuses the fork", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id);
    const first = await saveTrainingProgram(actionPayload(client.id, ["New A"]));
    const forkId = (first as { programId: string }).programId;

    const second = await saveTrainingProgram(actionPayload(client.id, ["New B"]));
    expect((second as { programId: string }).programId).toBe(forkId);

    const count = await db.trainingProgram.count({ where: { clientId: client.id, weekOf: WEEK } });
    expect(count).toBe(2);

    const originalRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(originalRow.status).toBe("PUBLISHED");
    expect(await dayNames(published.id)).toEqual(["Old A"]);
    expect(await dayNames(forkId)).toEqual(["New B"]);
  });

  it("C5 — metadata survives the fork from the payload, and clearing still works", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // Finding 4: the published row's templateSourceId (template1) is a
    // DIFFERENT real template from the one the coach selects in the payload
    // (template2), so this assertion can only pass under payload-wins — it
    // would fail under inheritance, which is what makes it a real pin of the
    // acceptance-criterion-2 deviation rather than a coincidence of both
    // rules agreeing on a null target.
    const template1 = await seedTemplate(coach.id);
    const template2 = await seedTemplate(coach.id);
    await seedPublished(client.id, { injuries: "old knee", equipment: "old barbell", templateSourceId: template1.id });

    const withMetadata = await saveTrainingProgram(
      actionPayload(client.id, ["New A"], {
        injuries: "shoulder",
        equipment: "dumbbells",
        weeklyFrequency: 4,
        clientNotes: "notes",
        templateSourceId: template2.id,
      })
    );
    const forkId = (withMetadata as { programId: string }).programId;
    const row = await db.trainingProgram.findUniqueOrThrow({ where: { id: forkId } });
    expect(row.injuries).toBe("shoulder");
    expect(row.equipment).toBe("dumbbells");
    expect(row.weeklyFrequency).toBe(4);
    expect(row.clientNotes).toBe("notes");
    // All five metadata fields, including templateSourceId — the field
    // behind the deliberate acceptance-criterion-2 deviation (payload wins
    // on this web save path, inheritance on the programId-driven PUT).
    expect(row.templateSourceId).toBe(template2.id);

    // A payload omitting injuries (the editor's shape when the coach clears
    // the box) must not resurrect the published row's value. Second client,
    // same coach.
    const client2Id = randomUUID();
    const client2 = await db.user.create({ data: { clerkId: client2Id, email: `${client2Id}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client2.id } });
    createdClientIds.push(client2.id);
    createdUserIds.push(client2.id);
    mocks.authUserId = coach.clerkId;
    await seedPublished(client2.id, { injuries: "old knee" });
    const cleared = await saveTrainingProgram(actionPayload(client2.id, ["New A"]));
    const clearedRow = await db.trainingProgram.findUniqueOrThrow({
      where: { id: (cleared as { programId: string }).programId },
    });
    expect(clearedRow.injuries).toBeNull();

    // Finding 4: a payload that omits templateSourceId entirely (the
    // editor's shape when the coach saves with no template selected) must
    // null it on the fork, not inherit template1 from the published row —
    // the coach-visible consequence of payload-wins on this transport.
    const client3Id = randomUUID();
    const client3 = await db.user.create({ data: { clerkId: client3Id, email: `${client3Id}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client3.id } });
    createdClientIds.push(client3.id);
    createdUserIds.push(client3.id);
    mocks.authUserId = coach.clerkId;
    await seedPublished(client3.id, { templateSourceId: template1.id });
    const omitted = await saveTrainingProgram(actionPayload(client3.id, ["New A"]));
    const omittedRow = await db.trainingProgram.findUniqueOrThrow({
      where: { id: (omitted as { programId: string }).programId },
    });
    expect(omittedRow.templateSourceId).toBeNull();
  });

  it("C6 — fork then publish: the client lands on the new program", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const previous = await seedPublished(client.id, {
      publishedAt: new Date("2026-09-14T12:00:00Z"),
    });
    const saved = await saveTrainingProgram(actionPayload(client.id, ["New A"]));
    const forkId = (saved as { programId: string }).programId;

    await publishTrainingProgram({ programId: forkId });

    const nowPublished = await getPublishedTrainingProgram(client.id);
    expect(nowPublished?.id).toBe(forkId);

    const rows = await db.trainingProgram.findMany({
      where: { clientId: client.id, weekOf: WEEK },
      select: { id: true, status: true },
    });
    expect(rows).toContainEqual({ id: previous.id, status: "SUPERSEDED" });
    expect(rows).toContainEqual({ id: forkId, status: "PUBLISHED" });
    expect(rows.filter((row) => row.status === "PUBLISHED")).toHaveLength(1);
  });

  it("C7 — REST PUT against a PUBLISHED program forks, and a body omitting clientNotes/weeklyFrequency does not drop the coach's notes (finding 5)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const template = await seedTemplate(coach.id);
    const published = await seedPublished(client.id, {
      injuries: "old knee",
      equipment: "old rack",
      templateSourceId: template.id,
      weeklyFrequency: 3,
      clientNotes: "Coach's important notes",
    });

    // Body omits weeklyFrequency and clientNotes entirely — the shape a
    // caller sends when it only wants to update days. Publishing this fork
    // must not drop the coach's own notes.
    const res = await putTrainingRest(
      restRequest({
        programId: published.id,
        days: [{ dayName: "New A", sortOrder: 0, blocks: [] }],
      }),
      params(client.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.forkedNewProgramId).toBe("string");
    expect(body.forkedNewProgramId).not.toBe(published.id);

    const originalRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(originalRow.status).toBe("PUBLISHED");
    expect(originalRow.publishedAt?.toISOString()).toBe(published.publishedAt?.toISOString());
    expect(originalRow.injuries).toBe("old knee");
    expect(originalRow.equipment).toBe("old rack");
    expect(originalRow.templateSourceId).toBe(template.id);
    expect(originalRow.weeklyFrequency).toBe(3);
    expect(originalRow.clientNotes).toBe("Coach's important notes");
    expect(await dayNames(published.id)).toEqual(["Old A"]);

    const forkedRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: body.forkedNewProgramId } });
    expect(forkedRow.status).toBe("DRAFT");
    expect(forkedRow.publishedAt).toBeNull();
    expect(forkedRow.weekOf.toISOString()).toBe(published.weekOf.toISOString());
    expect(forkedRow.injuries).toBe("old knee");
    expect(forkedRow.equipment).toBe("old rack");
    expect(forkedRow.templateSourceId).toBe(template.id);
    // The fix under test: omitted fields inherit from the forked row rather
    // than being nulled out.
    expect(forkedRow.weeklyFrequency).toBe(3);
    expect(forkedRow.clientNotes).toBe("Coach's important notes");
    expect(await dayNames(body.forkedNewProgramId)).toEqual(["New A"]);
  });

  it("C7b — REST PUT fork: explicit body values override inherited metadata, explicit null clears clientNotes", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id, { weeklyFrequency: 3, clientNotes: "old notes" });

    const res = await putTrainingRest(
      restRequest({
        programId: published.id,
        days: [{ dayName: "New A", sortOrder: 0, blocks: [] }],
        weeklyFrequency: 5,
        clientNotes: null,
      }),
      params(client.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const forkedRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: body.forkedNewProgramId } });
    expect(forkedRow.weeklyFrequency).toBe(5);
    expect(forkedRow.clientNotes).toBeNull();

    const originalRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(originalRow.weeklyFrequency).toBe(3);
    expect(originalRow.clientNotes).toBe("old notes");
  });

  // Finding 5 (round 2): the guard's refuse branch on both transports.
  // A real concurrent transaction is not needed — only the pre-write read
  // needs to have seen a status that the row no longer has by the time the
  // guarded write runs. One read is stubbed; the transaction, the guard SQL,
  // the rollback and the HTTP/throw behaviour are all real. This is also the
  // only coverage that Prisma re-throws the guard's custom error unwrapped
  // out of an interactive transaction, so `instanceof` matches at the route's
  // catch and the route answers 409 instead of falling through to the 500.
  it("J1 — REST PUT: a concurrent publish between the pre-transaction read and the guarded write refuses (409) instead of rewriting", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id);

    // Lie: the route's pre-transaction findUnique reports DRAFT, as if this
    // read happened just before a concurrent publish (another transport)
    // flipped the row to PUBLISHED. The real row in the DB stays PUBLISHED
    // throughout — only what the route "saw" is faked.
    const spy = vi.spyOn(db.trainingProgram, "findUnique").mockResolvedValueOnce({
      id: published.id,
      clientId: client.id,
      weekOf: published.weekOf,
      status: "DRAFT",
      injuries: published.injuries,
      equipment: published.equipment,
      templateSourceId: published.templateSourceId,
      weeklyFrequency: published.weeklyFrequency,
      clientNotes: published.clientNotes,
    } as never);

    const res = await putTrainingRest(
      restRequest({ programId: published.id, days: [{ dayName: "New A", sortOrder: 0, blocks: [] }] }),
      params(client.id)
    );
    spy.mockRestore();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("PROGRAM_PUBLISHED_DURING_SAVE");

    // The point: nothing was rewritten. The row is still PUBLISHED with its
    // original day, because the guard fired before the deleteMany.
    const row = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(await dayNames(published.id)).toEqual(["Old A"]);
  });

  it("J2 — Server Action: a concurrent publish between the pre-transaction read and the guarded write throws instead of rewriting", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id);

    // The action's pre-transaction lookup selects only { id }, so the lie is
    // one line: report the published row's id as if it were this week's
    // DRAFT. The real row in the DB stays PUBLISHED throughout.
    const spy = vi.spyOn(db.trainingProgram, "findFirst").mockResolvedValueOnce({ id: published.id } as never);

    await expect(saveTrainingProgram(actionPayload(client.id, ["New A"]))).rejects.toThrow(
      "TRAINING_PROGRAM_PUBLISHED_DURING_SAVE"
    );
    spy.mockRestore();

    const row = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(await dayNames(published.id)).toEqual(["Old A"]);
  });

  it("C10 — REST PUT forks on every call against a published id (deliberately unbounded — pinned for T-882)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id);

    const first = await putTrainingRest(
      restRequest({ programId: published.id, days: [{ dayName: "Fork One", sortOrder: 0, blocks: [] }] }),
      params(client.id)
    );
    const firstBody = await first.json();

    // A caller that ignores forkedNewProgramId and keeps PUTting the
    // published id creates a new DRAFT row every time — no week-scoped
    // reuse like the action's C4. The shipped iOS app itself cannot trigger
    // this in normal operation: PlanEditorModels.swift only keeps a
    // programId when source == "draft", so it never sends a published id
    // (PlanEditorModels.swift:304). The reachable path is a stale-id window
    // — the app holds an id it fetched while it was still a DRAFT, another
    // transport publishes it, and the app's next PUT still carries the now
    // stale id. This is documented, unreachable-today-in-normal-operation
    // behaviour (T-882 owns closing it), pinned here so a future change to
    // it is a deliberate diff, not an accidental regression.
    const second = await putTrainingRest(
      restRequest({ programId: published.id, days: [{ dayName: "Fork Two", sortOrder: 0, blocks: [] }] }),
      params(client.id)
    );
    const secondBody = await second.json();

    expect(firstBody.forkedNewProgramId).not.toBe(secondBody.forkedNewProgramId);

    const count = await db.trainingProgram.count({ where: { clientId: client.id, weekOf: WEEK } });
    expect(count).toBe(3); // published + fork one + fork two

    expect(await dayNames(firstBody.forkedNewProgramId)).toEqual(["Fork One"]);
    expect(await dayNames(secondBody.forkedNewProgramId)).toEqual(["Fork Two"]);
  });

  it("C11 — a week holding both a DRAFT and a PUBLISHED row: the action targets the draft, the published row is untouched, row count stays 2", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id, { dayName: "Old A" });
    const draft = await seedDraft(client.id, "Draft A");

    const result = await saveTrainingProgram(actionPayload(client.id, ["Updated Draft"]));
    expect((result as { programId: string }).programId).toBe(draft.id);

    const count = await db.trainingProgram.count({ where: { clientId: client.id, weekOf: WEEK } });
    expect(count).toBe(2);

    const publishedRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(publishedRow.status).toBe("PUBLISHED");
    expect(await dayNames(published.id)).toEqual(["Old A"]);
    expect(await dayNames(draft.id)).toEqual(["Updated Draft"]);
  });

  it("C12 — a week holding both a DRAFT and a PUBLISHED row: the REST PUT against the draft id updates in place, the published row is untouched, row count stays 2", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const published = await seedPublished(client.id, { dayName: "Old A" });
    const draft = await seedDraft(client.id, "Draft A");

    const res = await putTrainingRest(
      restRequest({ programId: draft.id, days: [{ dayName: "Updated Draft", sortOrder: 0, blocks: [] }] }),
      params(client.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("forkedNewProgramId" in body).toBe(false);

    const count = await db.trainingProgram.count({ where: { clientId: client.id, weekOf: WEEK } });
    expect(count).toBe(2);

    const publishedRow = await db.trainingProgram.findUniqueOrThrow({ where: { id: published.id } });
    expect(publishedRow.status).toBe("PUBLISHED");
    expect(await dayNames(published.id)).toEqual(["Old A"]);
    expect(await dayNames(draft.id)).toEqual(["Updated Draft"]);
  });

  it("C8 — REST PUT against a DRAFT is byte-for-byte unchanged", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const draft = await seedDraft(client.id);
    const res = await putTrainingRest(
      restRequest({
        programId: draft.id,
        days: [{ dayName: "Updated A", sortOrder: 0, blocks: [] }],
      }),
      params(client.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect("forkedNewProgramId" in body).toBe(false);

    const count = await db.trainingProgram.count({ where: { clientId: client.id, weekOf: WEEK } });
    expect(count).toBe(1);
    expect(await dayNames(draft.id)).toEqual(["Updated A"]);
  });

  it("C9 — authorization unchanged on both transports", async () => {
    const { client } = await fixture();
    const unassignedCoachId = randomUUID();
    const unassignedCoach = await db.user.create({
      data: { clerkId: unassignedCoachId, email: `${unassignedCoachId}@example.test`, isCoach: true, activeRole: "COACH" },
    });
    createdUserIds.push(unassignedCoach.id);

    // Action: a coach with no CoachClient row throws.
    mocks.authUserId = unassignedCoach.clerkId;
    await expect(saveTrainingProgram(actionPayload(client.id, ["A"]))).rejects.toThrow();

    // Route: 403 when program.clientId !== clientId — the fork must not be
    // reachable before the ownership check. otherCoach is authorized for
    // BOTH clients (assignment check would pass for either); the program
    // being forked belongs to otherClient2, but the URL targets otherClient.
    const { coach: otherCoach, client: otherClient } = await fixture();
    const otherClient2Id = randomUUID();
    const otherClient2 = await db.user.create({ data: { clerkId: otherClient2Id, email: `${otherClient2Id}@example.test`, isClient: true } });
    await db.coachClient.create({ data: { coachId: otherCoach.id, clientId: otherClient2.id } });
    createdClientIds.push(otherClient2.id);
    createdUserIds.push(otherClient2.id);
    const otherProgram = await seedPublished(otherClient2.id);
    mocks.authUserId = otherCoach.clerkId;
    const forbidden = await putTrainingRest(
      restRequest({ programId: otherProgram.id, days: [] }),
      params(otherClient.id)
    );
    expect(forbidden.status).toBe(403);
    const stillIntact = await db.trainingProgram.findUniqueOrThrow({ where: { id: otherProgram.id } });
    expect(stillIntact.status).toBe("PUBLISHED");
    const forkCount = await db.trainingProgram.count({ where: { clientId: otherClient2.id, weekOf: WEEK } });
    expect(forkCount).toBe(1);

    // Route: 404 for a missing id.
    mocks.authUserId = otherCoach.clerkId;
    const missing = await putTrainingRest(
      restRequest({ programId: "nonexistent-id", days: [] }),
      params(otherClient.id)
    );
    expect(missing.status).toBe(404);

    // Route: 422 for a bad body.
    const badBody = await putTrainingRest(
      restRequest({ programId: otherProgram.id }),
      params(otherClient.id)
    );
    expect(badBody.status).toBe(422);
  });
});
