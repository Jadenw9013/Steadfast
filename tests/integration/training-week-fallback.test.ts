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
import { GET as getTrainingRest } from "@/app/api/coach/clients/[clientId]/training/route";
import { getTrainingProgramForReview } from "@/lib/queries/training-programs";
import { db } from "@/lib/db";

/**
 * T-803 regression suite. Run through the local test DB:
 *   DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
 *   SECURITY_INTEGRATION=1 pnpm exec vitest run tests/integration/training-week-fallback.test.ts
 *
 * Cases 1-4 must FAIL on unmodified 04e8d41 (origin/main) — see
 * board/logs/20260919-010421-t803-repro.log and board/evidence/T-803.md for the
 * failing run against this exact file.
 */

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const INDEX_NAME = "TrainingProgram_one_published_per_client";

suite("T-803: coach training week-scoped read falls back to the latest published program", () => {
  let indexExistedBeforeSuite = false;

  beforeAll(async () => {
    const rows = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'TrainingProgram' AND indexname = '${INDEX_NAME}'`
    );
    indexExistedBeforeSuite = rows.length > 0;
    // The duplicate-resolution cases (3, 4) need two PUBLISHED rows for the
    // same client+week, which this team/sprint-1 index forbids. It does not
    // exist on production (04e8d41); drop it here for the duration of this
    // suite only.
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEX_NAME}"`);
  });

  // Cases 3/4 intentionally leave two PUBLISHED rows for one client, which
  // would block recreating the sprint-1 partial unique index below. Track
  // every client created by fixture() and hard-delete its training data
  // first so the index can always be recreated on exit, even if a test threw.
  const createdClientIds: string[] = [];
  // Every User row this suite creates (coaches, clients and the case-9
  // non-coach/unassigned-coach fixtures) so afterAll leaves the shared local
  // test DB with no residue, not just no dropped index.
  const createdUserIds: string[] = [];

  afterAll(async () => {
    let cleanupError: unknown = null;

    // Step 1: guarantee no duplicate PUBLISHED rows for this suite's clients
    // survive, ORM path or not. `CREATE UNIQUE INDEX IF NOT EXISTS` below does
    // NOT protect against a real 23505 conflict — it only skips the statement
    // if an index of that name already exists. If `deleteMany` throws before
    // removing the two-PUBLISHED-rows fixtures that cases 3/4 create on
    // purpose, the index recreate below would hit that live conflict, fail,
    // and leave the SHARED local test DB without the sprint-1 index — the
    // exact incident from round 1. So on any failure here, fall back to a raw
    // DELETE that does not go through the same code path, before ever
    // attempting to recreate the index.
    try {
      await db.trainingProgram.deleteMany({ where: { clientId: { in: createdClientIds } } });
    } catch (err) {
      cleanupError = err;
      if (createdClientIds.length > 0) {
        await db.$executeRawUnsafe(
          `DELETE FROM "TrainingProgram" WHERE "clientId" = ANY($1::text[])`,
          createdClientIds
        );
      }
    }

    // Step 2: best-effort cleanup of coach/client/user rows. These do not
    // touch the partial unique index, so a failure here must not block the
    // index recreation in step 3 — but it must not be swallowed either.
    try {
      await db.coachClient.deleteMany({
        where: { OR: [{ coachId: { in: createdUserIds } }, { clientId: { in: createdUserIds } }] },
      });
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    } catch (err) {
      cleanupError = cleanupError ?? err;
    }

    // Step 3: recreate unconditionally. Step 1 guarantees this table has no
    // duplicate PUBLISHED rows for this suite's clients left over, so this
    // is never blocked by a 23505 conflict caused by our own fixtures.
    if (indexExistedBeforeSuite) {
      await db.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "TrainingProgram" ("clientId") WHERE (status = 'PUBLISHED')`
      );
    }
    await db.$disconnect();

    // Loud, not silent: the index is back, but if step 1 or 2 hit a real
    // failure, a human needs to know the shared local test DB may have
    // residue beyond the index, rather than the suite reporting green.
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

  const WEEK_A = new Date("2026-08-31T00:00:00Z");
  const WEEK_B = new Date("2026-09-07T00:00:00Z");

  async function createProgram(clientId: string, opts: {
    weekOf: Date;
    status: "DRAFT" | "PUBLISHED";
    publishedAt?: Date | null;
    createdAt?: Date;
    dayName?: string;
  }) {
    const program = await db.trainingProgram.create({
      data: {
        clientId,
        weekOf: opts.weekOf,
        status: opts.status,
        publishedAt: opts.status === "PUBLISHED" ? (opts.publishedAt ?? new Date()) : null,
        days: {
          create: [
            {
              dayName: opts.dayName ?? "Day 1",
              sortOrder: 0,
              blocks: { create: [{ type: "EXERCISE", title: "Squat", content: "5x5", sortOrder: 0 }] },
            },
          ],
        },
      },
    });
    if (opts.createdAt) {
      await db.trainingProgram.update({ where: { id: program.id }, data: { createdAt: opts.createdAt } });
    }
    return program;
  }

  function restRequest(clientId: string, weekOf?: Date) {
    const url = new URL(`https://example.test/api/coach/clients/${clientId}/training`);
    if (weekOf) url.searchParams.set("weekOf", weekOf.toISOString().split("T")[0]);
    return new NextRequest(url);
  }

  it("case 1 — web query fallback: week A has a published program, week B has none; the web query for week B returns carried-over", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const programA = await createProgram(client.id, { weekOf: WEEK_A, status: "PUBLISHED" });

    const result = await getTrainingProgramForReview(client.id, WEEK_B);

    expect(result.source).toBe("carried-over");
    expect(result.carriedOverFrom?.toISOString()).toBe(WEEK_A.toISOString());
    expect(result.program?.id).toBe(programA.id);
    expect(result.program?.days[0]?.dayName).toBe("Day 1");
  });

  it("case 1b — week-bounded fallback: a published program for a LATER week must not carry over into an earlier week's review (SPEC AMENDMENT, T-803 round 1)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    // Client's only published program is for the LATER week (WEEK_B). The
    // coach opens the review page for the EARLIER week (WEEK_A). Before the
    // amendment, the unbounded fallback would offer WEEK_B's program under a
    // banner that only makes sense for a program from the past — publishing
    // it there would stamp `publishedAt = now` onto a row whose `weekOf` is
    // in the past, which the non-week-scoped client read then serves as the
    // client's current workout. The bound (`weekOf: { lt: requestedWeekOf }`)
    // must keep this case at `source: "empty"`.
    const futureProgram = await createProgram(client.id, { weekOf: WEEK_B, status: "PUBLISHED", dayName: "Future" });

    const webResult = await getTrainingProgramForReview(client.id, WEEK_A);
    expect(webResult.source).toBe("empty");
    expect(webResult.program).toBeNull();
    expect(webResult.carriedOverFrom).toBeNull();

    const response = await getTrainingRest(restRequest(client.id, WEEK_A), params(client.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("empty");
    expect(body.program).toBeNull();
    expect(body.carriedOverFromWeekOf).toBeNull();
    // The future program must never be the one offered.
    expect(body.program?.id).not.toBe(futureProgram.id);
  });

  it("case 2 — REST route fallback: same fixture, ?weekOf=<week B> returns carried-over with carriedOverFromWeekOf", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const programA = await createProgram(client.id, { weekOf: WEEK_A, status: "PUBLISHED" });

    const response = await getTrainingRest(restRequest(client.id, WEEK_B), params(client.id));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.source).toBe("carried-over");
    // Frozen contract: `carriedOverFromWeekOf` is "always present". This key
    // does not exist at all on 04e8d41 (the field is new), so this assertion
    // fails on base alongside the value assertions below, preserving the
    // negative-control split while pinning presence, not just value.
    expect(Object.hasOwn(body, "carriedOverFromWeekOf")).toBe(true);
    expect(body.carriedOverFromWeekOf).toBe(WEEK_A.toISOString());
    expect(body.program.id).toBe(programA.id);
  });

  it("case 3 — duplicate resolution: two PUBLISHED rows for one client+week resolve to the newest on both the web query and the REST route", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const older = await createProgram(client.id, {
      weekOf: WEEK_A,
      status: "PUBLISHED",
      publishedAt: new Date("2026-08-31T09:00:00Z"),
      dayName: "Older",
    });
    const newer = await createProgram(client.id, {
      weekOf: WEEK_A,
      status: "PUBLISHED",
      publishedAt: new Date("2026-08-31T20:00:00Z"),
      dayName: "Newer",
    });
    // Update the older row so it sits later in the heap than a naive
    // findFirst-with-no-orderBy would otherwise return.
    await db.trainingProgram.update({ where: { id: older.id }, data: { clientNotes: "touched" } });

    const webResult = await getTrainingProgramForReview(client.id, WEEK_A);
    expect(webResult.source).toBe("published");
    expect(webResult.program?.id).toBe(newer.id);

    const response = await getTrainingRest(restRequest(client.id, WEEK_A), params(client.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("published");
    expect(body.program.id).toBe(newer.id);
  });

  it("case 4 — null publishedAt tiebreak: a PUBLISHED row with publishedAt null never outranks a real one", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const nullPublishedAt = await createProgram(client.id, { weekOf: WEEK_A, status: "PUBLISHED", dayName: "NullPublishedAt" });
    await db.trainingProgram.update({ where: { id: nullPublishedAt.id }, data: { publishedAt: null } });
    const realOne = await createProgram(client.id, {
      weekOf: WEEK_A,
      status: "PUBLISHED",
      publishedAt: new Date("2026-08-31T12:00:00Z"),
      dayName: "Real",
    });

    const webResult = await getTrainingProgramForReview(client.id, WEEK_A);
    expect(webResult.source).toBe("published");
    expect(webResult.program?.id).toBe(realOne.id);
  });

  it("case 5 — regression: no weekOf on the REST route still returns source published with carriedOverFromWeekOf null (proves the shipped iOS build is unaffected)", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const program = await createProgram(client.id, { weekOf: WEEK_A, status: "PUBLISHED" });

    const response = await getTrainingRest(restRequest(client.id), params(client.id));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.source).toBe("published");
    // `?? null`: on 04e8d41 this key does not exist on the response at all
    // (it is new in this ticket), so it comes back `undefined` there and
    // `null` after the fix — both collapse to "absent/no carry-over" for a
    // Decodable-ignores-unknown-keys client. This is the assertion that
    // proves the shipped iOS build's only call shape is unaffected.
    expect(body.carriedOverFromWeekOf ?? null).toBeNull();
    expect(body.program.id).toBe(program.id);
  });

  it("case 6 — regression: a DRAFT for the requested week wins over everything, carriedOverFrom is null", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    await createProgram(client.id, { weekOf: WEEK_A, status: "PUBLISHED", dayName: "Earlier published" });
    const draft = await createProgram(client.id, { weekOf: WEEK_B, status: "DRAFT", dayName: "Draft" });

    const result = await getTrainingProgramForReview(client.id, WEEK_B);
    expect(result.source).toBe("draft");
    // `?? null`: `carriedOverFrom` does not exist on 04e8d41's return shape.
    expect(result.carriedOverFrom ?? null).toBeNull();
    expect(result.program?.id).toBe(draft.id);
  });

  it("case 7 — regression: a PUBLISHED program for the requested week itself returns published, not carried-over", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const program = await createProgram(client.id, { weekOf: WEEK_B, status: "PUBLISHED" });

    const result = await getTrainingProgramForReview(client.id, WEEK_B);
    expect(result.source).toBe("published");
    expect(result.carriedOverFrom ?? null).toBeNull();
    expect(result.program?.id).toBe(program.id);
  });

  it("case 8 — regression: a client with no programs at all still returns empty on both surfaces", async () => {
    const { coach, client } = await fixture();
    mocks.authUserId = coach.clerkId;

    const result = await getTrainingProgramForReview(client.id, WEEK_B);
    expect(result.source).toBe("empty");
    expect(result.program).toBeNull();
    expect(result.carriedOverFrom ?? null).toBeNull();

    const response = await getTrainingRest(restRequest(client.id, WEEK_B), params(client.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("empty");
    expect(body.program).toBeNull();
    expect(body.carriedOverFromWeekOf ?? null).toBeNull();
  });

  it("case 9 — auth ladder on the REST GET is unchanged: 401 unauthenticated, 403 non-coach, 403 unassigned coach, 400 invalid weekOf", async () => {
    const { client } = await fixture();

    mocks.authUserId = "";
    const unauth = await getTrainingRest(restRequest(client.id, WEEK_B), params(client.id));
    expect(unauth.status).toBe(401);

    const nonCoachId = randomUUID();
    const nonCoach = await db.user.create({ data: { clerkId: nonCoachId, email: `${nonCoachId}@example.test`, isClient: true } });
    createdUserIds.push(nonCoach.id);
    mocks.authUserId = nonCoach.clerkId;
    const forbiddenNonCoach = await getTrainingRest(restRequest(client.id, WEEK_B), params(client.id));
    expect(forbiddenNonCoach.status).toBe(403);

    const otherCoachId = randomUUID();
    const otherCoach = await db.user.create({ data: { clerkId: otherCoachId, email: `${otherCoachId}@example.test`, isCoach: true, activeRole: "COACH" } });
    createdUserIds.push(otherCoach.id);
    mocks.authUserId = otherCoach.clerkId;
    const forbiddenUnassigned = await getTrainingRest(restRequest(client.id, WEEK_B), params(client.id));
    expect(forbiddenUnassigned.status).toBe(403);

    const assignedCoachId = randomUUID();
    const assignedCoach = await db.user.create({ data: { clerkId: assignedCoachId, email: `${assignedCoachId}@example.test`, isCoach: true, activeRole: "COACH" } });
    createdUserIds.push(assignedCoach.id);
    await db.coachClient.create({ data: { coachId: assignedCoach.id, clientId: client.id } });
    mocks.authUserId = assignedCoach.clerkId;
    const badWeekOf = await getTrainingRest(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/training?weekOf=not-a-date`),
      params(client.id)
    );
    expect(badWeekOf.status).toBe(400);
  });
});
