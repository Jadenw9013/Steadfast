import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-622 — the `saveTrainingProgram` Server Action and PUT/POST
 * `/api/coach/clients/[clientId]/training` must write identical rows for
 * identical input, because both now parse with, and write through,
 * `lib/training-programs/drafts.ts`.
 *
 * The P1 this file exists for: the REST route validated `type` against
 * `["TEXT", "EXERCISE"]`. `"TEXT"` is not a member of Prisma's `enum BlockType`
 * (it could only ever 500 at the DB), and the four legitimate non-exercise
 * types — ACTIVATION, INSTRUCTION, SUPERSET, CARDIO, OPTIONAL — were rejected
 * with 422 even though the LLM workout importer and the web editor create all
 * of them and the client's training tab renders all of them. The first test
 * below is the regression: load a real six-type program through GET and send it
 * straight back through PUT. Against the pre-T-622 route that PUT answers 422.
 *
 * Two further 500s are pinned here: a day named `""` (the OCR importer creates
 * those; `dayName` is a NOT NULL column and both routes wrote
 * `dayName || undefined`), and `title`/`content` written as `null` into NOT NULL
 * columns.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { saveTrainingProgram } from "@/app/actions/training-programs";
import {
  GET as getTraining,
  POST as postTraining,
  PUT as putTraining,
} from "@/app/api/coach/clients/[clientId]/training/route";
import { getCurrentWeekMonday } from "@/lib/utils/date";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test")
    throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const CURRENT_WEEK = getCurrentWeekMonday();
const CURRENT_WEEK_STR = CURRENT_WEEK.toISOString().split("T")[0];

/** One block of every BlockType, plus the three shapes that used to break. */
const sixTypeDayBlocks = [
  { type: "ACTIVATION" as const, title: "Glute bridge", content: "2x15", sortOrder: 0 },
  { type: "EXERCISE" as const, title: "Back squat", content: "3x5", sortOrder: 1 },
  {
    type: "EXERCISE" as const,
    title: "Front squat",
    content: "5 sets x 3-5 reps @ RPE 8",
    sortOrder: 2,
  },
  { type: "INSTRUCTION" as const, title: "Tempo", content: "", sortOrder: 3 },
  { type: "SUPERSET" as const, title: "A1/A2", content: "Curl + pushdown, 3 rounds", sortOrder: 4 },
  { type: "CARDIO" as const, title: "Bike|3|30min|Z2", content: "Keep it easy", sortOrder: 5 },
  { type: "OPTIONAL" as const, title: "Calves", content: "3x20 if time", sortOrder: 6 },
];

suite("training-program draft parity (action vs REST) against real PostgreSQL constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    return { coach, client };
  }

  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

  const put = (clientId: string, body: unknown) =>
    putTraining(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/training`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params(clientId)
    );

  const post = (clientId: string, body: unknown) =>
    postTraining(
      new NextRequest(`https://example.test/api/coach/clients/${clientId}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params(clientId)
    );

  const get = (clientId: string, weekOf?: string) =>
    getTraining(
      new NextRequest(
        `https://example.test/api/coach/clients/${clientId}/training${weekOf ? `?weekOf=${weekOf}` : ""}`
      ),
      params(clientId)
    );

  /** Every stored day/block, in stored order, stripped to the columns the
   *  contract promises to round-trip. */
  async function storedShape(programId: string) {
    const program = await db.trainingProgram.findUniqueOrThrow({
      where: { id: programId },
      select: {
        days: {
          orderBy: { sortOrder: "asc" },
          select: {
            dayName: true,
            sortOrder: true,
            blocks: {
              orderBy: { sortOrder: "asc" },
              select: { type: true, title: true, content: true, sortOrder: true },
            },
          },
        },
      },
    });
    return program.days;
  }

  /** A DRAFT program holding the six-type day plus a day named "". */
  async function seedSixTypeDraft(clientId: string) {
    const program = await db.trainingProgram.create({
      data: {
        clientId,
        weekOf: CURRENT_WEEK,
        status: "DRAFT",
        weeklyFrequency: 3,
        clientNotes: "Push hard",
        days: {
          create: [
            { dayName: "Day 1 — Lower", sortOrder: 0, blocks: { create: sixTypeDayBlocks } },
            {
              dayName: "",
              sortOrder: 1,
              blocks: { create: [{ type: "EXERCISE", title: "Bench", content: "4x6", sortOrder: 0 }] },
            },
          ],
        },
      },
      select: { id: true },
    });
    return program.id;
  }

  // ── THE regression ─────────────────────────────────────────────────────────

  it("round-trips a six-block-type program through GET → PUT byte-identically (pre-T-622: 422 on ACTIVATION)", async () => {
    const { client } = await fixture();
    const programId = await seedSixTypeDraft(client.id);
    const before = await storedShape(programId);

    const loaded = await get(client.id, CURRENT_WEEK_STR);
    expect(loaded.status).toBe(200);
    const loadedBody = await loaded.json();
    expect(loadedBody.source).toBe("draft");

    // Feed the GET response's days straight back in, unchanged. This is exactly
    // what an editor that preserves what it cannot author does.
    const res = await put(client.id, {
      programId,
      days: loadedBody.program.days,
      weeklyFrequency: loadedBody.program.weeklyFrequency,
      clientNotes: loadedBody.program.clientNotes,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, programId });

    expect(await storedShape(programId)).toEqual(before);
    // Explicit: all six types survived, and the free-form and empty content did.
    const types = before[0].blocks.map((b) => b.type);
    expect(new Set(types)).toEqual(
      new Set(["ACTIVATION", "EXERCISE", "INSTRUCTION", "SUPERSET", "CARDIO", "OPTIONAL"])
    );
    const stored = await storedShape(programId);
    expect(stored[0].blocks[2].content).toBe("5 sets x 3-5 reps @ RPE 8");
    expect(stored[0].blocks[3].content).toBe("");
    expect(stored[1].dayName).toBe("");
  });

  // ── "TEXT" is gone ─────────────────────────────────────────────────────────

  it('PUT with "type": "TEXT" is a 422, not a 500, and changes nothing (pre-T-622: it parsed, then 500ed at Prisma)', async () => {
    const { client } = await fixture();
    const programId = await seedSixTypeDraft(client.id);
    const before = await storedShape(programId);

    const res = await put(client.id, {
      programId,
      days: [{ dayName: "Day 1", sortOrder: 0, blocks: [{ type: "TEXT", title: "x", content: "y", sortOrder: 0 }] }],
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeTruthy();

    expect(await storedShape(programId)).toEqual(before);
  });

  // ── action vs route write identical rows ──────────────────────────────────

  it("the Server Action and the REST route write identical days/blocks for identical input", async () => {
    const { client: clientA } = await fixture();
    const coachAUserId = mocks.authUserId;
    const { client: clientB } = await fixture();
    const coachBUserId = mocks.authUserId;

    const payloadDays = [
      { dayName: "Day 1 — Lower", blocks: sixTypeDayBlocks.map(({ sortOrder, ...b }) => ({ ...b, sortOrder })) },
      { dayName: "", blocks: [{ type: "EXERCISE" as const, title: "Bench", content: "4x6", sortOrder: 0 }] },
    ];

    mocks.authUserId = coachAUserId;
    const viaAction = await saveTrainingProgram({
      clientId: clientA.id,
      weekStartDate: CURRENT_WEEK_STR,
      days: payloadDays,
      weeklyFrequency: 4,
      clientNotes: "same notes",
    });
    if ("error" in viaAction) throw new Error(`action rejected: ${JSON.stringify(viaAction.error)}`);

    mocks.authUserId = coachBUserId;
    const created = await post(clientB.id, { weekOf: CURRENT_WEEK_STR });
    expect(created.status).toBe(201);
    const createdBody = await created.json();

    const saved = await put(clientB.id, {
      programId: createdBody.program.id,
      days: payloadDays.map((d, i) => ({ ...d, sortOrder: i })),
      weeklyFrequency: 4,
      clientNotes: "same notes",
    });
    expect(saved.status).toBe(200);

    expect(await storedShape(createdBody.program.id)).toEqual(await storedShape(viaAction.programId));

    const [a, b] = await Promise.all([
      db.trainingProgram.findUniqueOrThrow({
        where: { id: viaAction.programId },
        select: { status: true, weeklyFrequency: true, clientNotes: true },
      }),
      db.trainingProgram.findUniqueOrThrow({
        where: { id: createdBody.program.id },
        select: { status: true, weeklyFrequency: true, clientNotes: true },
      }),
    ]);
    expect(b).toEqual(a);
  });

  // ── dayName: "" ────────────────────────────────────────────────────────────

  it('dayName "" round-trips through PUT and through POST { copyFromPublished: true } (pre-T-622: both 500)', async () => {
    const { client } = await fixture();

    const draft = await db.trainingProgram.create({
      data: { clientId: client.id, weekOf: CURRENT_WEEK, status: "DRAFT" },
      select: { id: true },
    });

    const res = await put(client.id, {
      programId: draft.id,
      days: [{ dayName: "", sortOrder: 0, blocks: [{ type: "EXERCISE", title: "Squat", content: "3x5", sortOrder: 0 }] }],
    });
    expect(res.status).toBe(200);
    expect((await storedShape(draft.id))[0].dayName).toBe("");

    // And the copy-forward path, whose source is a PUBLISHED program with an
    // empty day name.
    const published = await db.trainingProgram.create({
      data: {
        clientId: client.id,
        weekOf: CURRENT_WEEK,
        status: "PUBLISHED",
        publishedAt: new Date(),
        days: {
          create: [
            { dayName: "", sortOrder: 0, blocks: { create: [{ type: "CARDIO", title: "Bike|3|30min|Z2", content: "", sortOrder: 0 }] } },
          ],
        },
      },
      select: { id: true },
    });
    expect(published.id).toBeTruthy();

    const nextWeek = new Date(CURRENT_WEEK.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const copied = await post(client.id, { weekOf: nextWeek, copyFromPublished: true });
    expect(copied.status).toBe(201);
    const copiedBody = await copied.json();

    expect(await storedShape(copiedBody.program.id)).toEqual([
      {
        dayName: "",
        sortOrder: 0,
        blocks: [{ type: "CARDIO", title: "Bike|3|30min|Z2", content: "", sortOrder: 0 }],
      },
    ]);
  });

  // ── POST/PUT metadata parity (T-622 parity audit, gap 9) ───────────────────

  it('POST and PUT parse weeklyFrequency/clientNotes with the same schemas: a string "3" is coerced on both (pre-fix: POST 422ed)', async () => {
    const { client } = await fixture();

    const created = await post(client.id, {
      weekOf: CURRENT_WEEK.toISOString().split("T")[0],
      weeklyFrequency: "3",
      clientNotes: "from POST",
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();

    expect(
      await db.trainingProgram.findUniqueOrThrow({
        where: { id: createdBody.program.id },
        select: { weeklyFrequency: true, clientNotes: true },
      })
    ).toEqual({ weeklyFrequency: 3, clientNotes: "from POST" });

    // The same value on the same program through PUT: identical result.
    const updated = await put(client.id, {
      programId: createdBody.program.id,
      days: [],
      weeklyFrequency: "3",
      clientNotes: "from POST",
    });
    expect(updated.status).toBe(200);

    expect(
      await db.trainingProgram.findUniqueOrThrow({
        where: { id: createdBody.program.id },
        select: { weeklyFrequency: true, clientNotes: true },
      })
    ).toEqual({ weeklyFrequency: 3, clientNotes: "from POST" });

    // Nothing POST accepted before starts failing: a plain number still works,
    // out-of-range is still a 422.
    const numeric = await post(client.id, {
      weekOf: new Date(CURRENT_WEEK.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      weeklyFrequency: 5,
    });
    expect(numeric.status).toBe(201);

    const tooMany = await post(client.id, {
      weekOf: new Date(CURRENT_WEEK.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      weeklyFrequency: 8,
    });
    expect(tooMany.status).toBe(422);

    // The other half of the widening: explicit null on POST. Pre-fix both of
    // these 422ed against POST's local schemas. .nullable() short-circuits
    // before z.coerce would turn null into 0 and trip min(1).
    const nulled = await post(client.id, {
      weekOf: new Date(CURRENT_WEEK.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      weeklyFrequency: null,
      clientNotes: null,
    });
    expect(nulled.status).toBe(201);
    const nulledBody = await nulled.json();

    expect(
      await db.trainingProgram.findUniqueOrThrow({
        where: { id: nulledBody.program.id },
        select: { weeklyFrequency: true, clientNotes: true },
      })
    ).toEqual({ weeklyFrequency: null, clientNotes: null });
  });

  it("PUT normalizes null title/content to empty strings rather than handing null to Prisma", async () => {
    const { client } = await fixture();
    const draft = await db.trainingProgram.create({
      data: { clientId: client.id, weekOf: CURRENT_WEEK, status: "DRAFT" },
      select: { id: true },
    });

    const res = await put(client.id, {
      programId: draft.id,
      days: [{ dayName: null, sortOrder: 0, blocks: [{ type: "INSTRUCTION", title: null, content: null, sortOrder: 0 }] }],
    });

    expect(res.status).toBe(200);
    expect(await storedShape(draft.id)).toEqual([
      { dayName: "", sortOrder: 0, blocks: [{ type: "INSTRUCTION", title: "", content: "", sortOrder: 0 }] },
    ]);
  });

  // ── sortOrder normalization ───────────────────────────────────────────────

  it("PUT densifies gapped sortOrder into 0..n-1 while keeping the submitted order", async () => {
    const { client } = await fixture();
    const draft = await db.trainingProgram.create({
      data: { clientId: client.id, weekOf: CURRENT_WEEK, status: "DRAFT" },
      select: { id: true },
    });

    const res = await put(client.id, {
      programId: draft.id,
      days: [
        {
          dayName: "second",
          sortOrder: 3,
          blocks: [
            { type: "EXERCISE", title: "b", content: "", sortOrder: 9 },
            { type: "EXERCISE", title: "a", content: "", sortOrder: 4 },
          ],
        },
        { dayName: "first", sortOrder: 1, blocks: [] },
      ],
    });
    expect(res.status).toBe(200);

    expect(await storedShape(draft.id)).toEqual([
      { dayName: "first", sortOrder: 0, blocks: [] },
      {
        dayName: "second",
        sortOrder: 1,
        blocks: [
          { type: "EXERCISE", title: "a", content: "", sortOrder: 0 },
          { type: "EXERCISE", title: "b", content: "", sortOrder: 1 },
        ],
      },
    ]);
  });

  // ── CB05 ──────────────────────────────────────────────────────────────────

  it("PUT against a PUBLISHED program forks a new draft, returns forkedNewProgramId and never touches the published rows", async () => {
    const { client } = await fixture();
    const published = await db.trainingProgram.create({
      data: {
        clientId: client.id,
        weekOf: CURRENT_WEEK,
        status: "PUBLISHED",
        publishedAt: new Date(),
        weeklyFrequency: 2,
        clientNotes: "old notes",
        injuries: "left knee",
        equipment: "barbell",
        days: {
          create: [
            { dayName: "Day 1", sortOrder: 0, blocks: { create: [{ type: "EXERCISE", title: "Squat", content: "3x5", sortOrder: 0 }] } },
          ],
        },
      },
      select: { id: true },
    });
    const publishedBefore = await storedShape(published.id);

    const res = await put(client.id, {
      programId: published.id,
      days: [{ dayName: "Day 1", sortOrder: 0, blocks: [{ type: "ACTIVATION", title: "TAMPERED", content: "2x15", sortOrder: 0 }] }],
      weeklyFrequency: 5,
      clientNotes: "new notes",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.programId).toBe(published.id);
    expect(typeof body.forkedNewProgramId).toBe("string");
    expect(body.forkedNewProgramId).not.toBe(published.id);

    const publishedAfter = await db.trainingProgram.findUniqueOrThrow({
      where: { id: published.id },
      select: { status: true, weeklyFrequency: true, clientNotes: true },
    });
    expect(publishedAfter.status).toBe("PUBLISHED");
    expect(publishedAfter.weeklyFrequency).toBe(2);
    expect(publishedAfter.clientNotes).toBe("old notes");
    expect(await storedShape(published.id)).toEqual(publishedBefore);

    const fork = await db.trainingProgram.findUniqueOrThrow({
      where: { id: body.forkedNewProgramId },
      select: {
        status: true,
        weekOf: true,
        weeklyFrequency: true,
        clientNotes: true,
        injuries: true,
        equipment: true,
        templateSourceId: true,
      },
    });
    expect(fork.status).toBe("DRAFT");
    expect(fork.weekOf.toISOString()).toBe(CURRENT_WEEK.toISOString());
    // Request wins for the two fields this surface carries...
    expect(fork.weeklyFrequency).toBe(5);
    expect(fork.clientNotes).toBe("new notes");
    // ...and the three it does not carry are inherited, never cleared.
    expect(fork.injuries).toBe("left knee");
    expect(fork.equipment).toBe("barbell");
    expect(fork.templateSourceId).toBeNull();

    expect(await storedShape(body.forkedNewProgramId)).toEqual([
      { dayName: "Day 1", sortOrder: 0, blocks: [{ type: "ACTIVATION", title: "TAMPERED", content: "2x15", sortOrder: 0 }] },
    ]);
  });

  // ── metadata semantics ────────────────────────────────────────────────────

  it("PUT omitting clientNotes clears it (today's behavior) and never clears injuries/equipment", async () => {
    const { client } = await fixture();
    const draft = await db.trainingProgram.create({
      data: {
        clientId: client.id,
        weekOf: CURRENT_WEEK,
        status: "DRAFT",
        weeklyFrequency: 3,
        clientNotes: "keep me?",
        injuries: "left knee",
        equipment: "barbell",
      },
      select: { id: true },
    });

    const res = await put(client.id, { programId: draft.id, days: [] });
    expect(res.status).toBe(200);

    const after = await db.trainingProgram.findUniqueOrThrow({
      where: { id: draft.id },
      select: { weeklyFrequency: true, clientNotes: true, injuries: true, equipment: true },
    });
    expect(after.clientNotes).toBeNull();
    expect(after.weeklyFrequency).toBeNull();
    expect(after.injuries).toBe("left knee");
    expect(after.equipment).toBe("barbell");
  });

  // ── auth ladder (unchanged) ───────────────────────────────────────────────

  it("PUT auth ladder: 401 unauthenticated, 403 non-coach, 403 unassigned coach, 403 other client's program, 404 unknown program", async () => {
    const { coach, client } = await fixture();
    const programId = await seedSixTypeDraft(client.id);
    const body = { programId, days: [] };

    mocks.authUserId = "";
    expect((await put(client.id, body)).status).toBe(401);

    const plainClerkId = randomUUID();
    await db.user.create({
      data: { clerkId: plainClerkId, email: `plain-${plainClerkId}@example.test`, isClient: true },
    });
    mocks.authUserId = plainClerkId;
    expect((await put(client.id, body)).status).toBe(403);

    const otherCoachClerkId = randomUUID();
    await db.user.create({
      data: {
        clerkId: otherCoachClerkId,
        email: `coach2-${otherCoachClerkId}@example.test`,
        isCoach: true,
        activeRole: "COACH",
      },
    });
    mocks.authUserId = otherCoachClerkId;
    expect((await put(client.id, body)).status).toBe(403);

    // A program belonging to another client, requested through this coach's own
    // assigned client: 403, not 200.
    const { client: otherClient } = await fixture();
    const otherProgramId = await seedSixTypeDraft(otherClient.id);
    mocks.authUserId = coach.clerkId;
    expect((await put(client.id, { programId: otherProgramId, days: [] })).status).toBe(403);

    expect((await put(client.id, { programId: randomUUID(), days: [] })).status).toBe(404);
  });
});
