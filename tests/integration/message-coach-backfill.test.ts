import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";

/**
 * T-661 — the CB03 message backfill must not hide every client-authored
 * message from every coach.
 *
 * `20260913200000_message_coach_scope` attributes only coach-authored rows
 * (senderId != clientId); every client reply keeps coachId = NULL while every
 * coach-facing reader filters on coachId. This suite proves the follow-up
 * migration `20260915000000_message_coach_backfill_single_coach` attributes the
 * unambiguous remainder and nothing else. A coach is named only when all three
 * hold: exactly one CoachClient row exists today, ClientCoachingContext agrees
 * (or does not exist), and either no other coach's conversation appears in the
 * client's history or the surviving relationship provably began after it —
 * bounded to the period the relationship demonstrably existed and clamped to
 * start strictly after any other coach's last message.
 *
 * TOPOLOGY SPLIT (amendment 2). When another coach's conversation IS present
 * there are two shapes and they are not treated alike:
 *   - CLEAN SUCCESSOR (rowCreatedAt > lastOtherCoachAt): attribute from the
 *     surviving relationship's row date forward. Cases 7, 8 and 11.
 *   - PREDECESSOR SURVIVOR (rowCreatedAt <= lastOtherCoachAt): no
 *     evidence-backed lower bound exists, so startsAt is NULL and the whole
 *     client is withheld. Cases 10 and 18.
 *
 * NO WIDENING CLAUSE (amendment 3). `startsAt` is EXACTLY
 * `CoachClient."createdAt"` or NULL — nothing ever moves it earlier than the
 * relationship row date. An earlier revision pulled it back to
 * `LEAST(rowCreatedAt, this coach's own earliest message)` whenever no
 * other-coach evidence survived, which leaked a departed coach's whole era to
 * the survivor after `purgeUserAccount` erased that evidence. Cases 6 and 19 are
 * the standing pins: both FAIL against any SQL that still has a widening clause.
 * If either fails, someone re-added one; the fixtures are not stale.
 *
 * It executes the SHIPPED SQL: the backfill statement is read out of the
 * migration file between the `>>> T-661 BACKFILL >>>` / `<<< T-661 BACKFILL <<<`
 * markers, so any drift in the migration fails this suite rather than passing
 * against a hand-copied duplicate. Step 1 is pinned as a constant and asserted
 * to still be present verbatim in 20260913200000.
 *
 * FIXTURE NOTE — cases 1-11 and 16-19 create NO `ClientCoachingContext` row, so
 * they exercise the migration's legacy `NOT EXISTS` fallback (the branch that
 * mirrors `lib/queries/client-provider.ts:11-15` for clients with no context row).
 * Cases 12-15 and 20 exercise the context test itself; case 15 is the one that
 * mirrors what production will actually hit, because
 * `20260913260000_client_coaching_context` writes a context row for every
 * `isClient` user before this migration runs.
 *
 * WARNING — this suite mutates the local test database DB-WIDE by design: both
 * migration statements are UPDATEs with no fixture scoping, so running them here
 * attributes NULL-coachId rows belonging to any client in the database, exactly
 * as they will behave on deploy. No other integration file may depend on a
 * NULL-coachId row for a single-coach client surviving (see
 * tests/integration/message-conversation-scope.test.ts, whose ambiguous fixture
 * uses a two-coach client for this reason). Nothing here ever clears or
 * overwrites an existing coachId.
 *
 * Run this gate with `--no-file-parallelism`:
 *   DATABASE_URL=postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test \
 *   SECURITY_INTEGRATION=1 pnpm vitest run tests/integration --no-file-parallelism
 * The DB-wide UPDATEs above can otherwise interleave with
 * tests/integration/account-deletion.test.ts's purge, which deletes Message
 * rows inside one db.$transaction (lib/account-deletion/purge.ts:28,180) —
 * without the flag this produces an intermittent failure that reads as a code
 * defect in either suite.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { db } from "@/lib/db";
import { GET as getMessagesRoute } from "@/app/api/messages/route";
import { GET as getCoachWeeklyMessagesRoute } from "@/app/api/coach/clients/[clientId]/messages/route";
import { getAllMessages, getMessages } from "@/lib/queries/messages";
import { getClientProfile } from "@/lib/queries/client-profile";
import { getClientProvider } from "@/lib/queries/client-provider";
import { NextRequest } from "next/server";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

const SCOPE_MIGRATION = path.join(process.cwd(), "prisma/migrations/20260913200000_message_coach_scope/migration.sql");
const BACKFILL_MIGRATION = path.join(process.cwd(), "prisma/migrations/20260915000000_message_coach_backfill_single_coach/migration.sql");

/** Step 1, shipped by 20260913200000 and pinned here so drift fails the suite. */
const STEP_ONE = 'UPDATE "Message" SET "coachId" = "senderId" WHERE "senderId" != "clientId"';

const START_MARKER = "-- >>> T-661 BACKFILL";
const END_MARKER = "-- <<< T-661 BACKFILL <<<";

/** Slice the shipped backfill out of the migration file, between its markers. */
function extractBackfillStatements(): string[] {
  const sql = readFileSync(BACKFILL_MIGRATION, "utf8");
  const startMarkerAt = sql.indexOf(START_MARKER);
  const endAt = sql.indexOf(END_MARKER);
  if (startMarkerAt === -1 || endAt === -1 || endAt <= startMarkerAt) {
    throw new Error("T-661 backfill markers missing from the migration file");
  }
  const startAt = sql.indexOf("\n", startMarkerAt) + 1;
  return sql
    .slice(startAt, endAt)
    // The Prisma adapter cannot run multiple statements in one call.
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((line) => line.trim().startsWith("--") || line.trim() === ""));
}

/** 20260913200000 — sender-based attribution. Feeds condition 3 of step 2. */
async function runStepOne() {
  await db.$executeRawUnsafe(STEP_ONE);
}

/** 20260915000000 — the shipped T-661 backfill, read from the migration file. */
async function runT661Backfill() {
  for (const statement of extractBackfillStatements()) {
    await db.$executeRawUnsafe(statement);
  }
}

/** Run the two migration statements in their shipped order. */
async function runBackfill() {
  await runStepOne();
  await runT661Backfill();
}

suite("T-661 — the shipped message coachId backfill attributes single-coach history and nothing else", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoach(label: string) {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${label}-${id}@example.test`, isCoach: true, isClient: false, activeRole: "COACH", firstName: label } });
  }

  async function makeClient(label: string) {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${label}-${id}@example.test`, isCoach: false, isClient: true, activeRole: "CLIENT", firstName: label } });
  }

  /** A pre-migration row: whatever the sender, coachId was never recorded. */
  async function legacyMessage(clientId: string, senderId: string, body: string, createdAt: Date, weekOf: Date) {
    return db.message.create({ data: { clientId, senderId, body, createdAt, weekOf, coachId: null } });
  }

  async function coachSees(coach: { clerkId: string }, clientId: string) {
    mocks.authUserId = coach.clerkId;
    const res = await getMessagesRoute(new NextRequest(`https://example.test/api/messages?clientId=${clientId}`));
    const body = await res.json() as { messages: { body: string }[] };
    return body.messages.map((m) => m.body);
  }

  async function coachIdOf(messageId: string) {
    return (await db.message.findUnique({ where: { id: messageId }, select: { coachId: true } }))?.coachId ?? null;
  }

  it("pins step 1 to the statement 20260913200000_message_coach_scope actually ships", () => {
    expect(readFileSync(SCOPE_MIGRATION, "utf8")).toContain(`${STEP_ONE};`);
  });

  it("1. restores both directions of a single-coach client's thread on the general messages API", async () => {
    const coach = await makeCoach("BfCoach1");
    const client = await makeClient("BfClient1");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await legacyMessage(client.id, coach.id, "coach question 1", new Date("2026-02-03T10:00:00Z"), weekOf);
    await legacyMessage(client.id, client.id, "client reply 1", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    const bodies = await coachSees(coach, client.id);
    expect(bodies).toContain("coach question 1");
    expect(bodies).toContain("client reply 1");
  });

  it("2. restores both directions on the coach weekly messages route", async () => {
    const coach = await makeCoach("BfCoach2");
    const client = await makeClient("BfClient2");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await legacyMessage(client.id, coach.id, "coach question 2", new Date("2026-02-03T10:00:00Z"), weekOf);
    await legacyMessage(client.id, client.id, "client reply 2", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    mocks.authUserId = coach.clerkId;
    const res = await getCoachWeeklyMessagesRoute(
      new NextRequest(`https://example.test/api/coach/clients/${client.id}/messages?weekOf=2026-02-02`),
      { params: Promise.resolve({ clientId: client.id }) }
    );
    const body = await res.json() as { messages: { content: string }[] };
    const contents = body.messages.map((m) => m.content);
    expect(contents).toContain("coach question 2");
    expect(contents).toContain("client reply 2");
  });

  it("3. leaves a multi-coach client's reply NULL and hidden from both coaches, but keeps it in the client's archive", async () => {
    const coachA = await makeCoach("BfCoach3A");
    const coachB = await makeCoach("BfCoach3B");
    const client = await makeClient("BfClient3");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    const ambiguous = await legacyMessage(client.id, client.id, "ambiguous two-coach reply", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(ambiguous.id)).toBeNull();
    expect(await coachSees(coachA, client.id)).not.toContain("ambiguous two-coach reply");
    expect(await coachSees(coachB, client.id)).not.toContain("ambiguous two-coach reply");
    expect((await getAllMessages(client.id)).map((m) => m.body)).toContain("ambiguous two-coach reply");
  });

  it("4. leaves an unassigned client's reply NULL and only in their own archive", async () => {
    const client = await makeClient("BfClient4");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    const orphan = await legacyMessage(client.id, client.id, "unassigned reply", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(orphan.id)).toBeNull();
    expect((await getAllMessages(client.id)).map((m) => m.body)).toContain("unassigned reply");
  });

  it("5. leaves a reply that predates the relationship NULL", async () => {
    const coach = await makeCoach("BfCoach5");
    const client = await makeClient("BfClient5");
    const weekOf = new Date("2026-01-12T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-03-02T00:00:00Z") } });
    const preRelationship = await legacyMessage(client.id, client.id, "reply before this coach existed", new Date("2026-01-15T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(preRelationship.id)).toBeNull();
    expect(await coachSees(coach, client.id)).not.toContain("reply before this coach existed");
  });

  it("6. never widens the window back to the coach's own earliest message — startsAt is exactly the relationship row date", async () => {
    // AMENDMENT-3 PIN. This is the exact fixture the pre-amendment-3 SQL WOULD
    // have widened into, and it must now be withheld. THIS CASE FAILS AGAINST
    // THE AMENDMENT-2 SQL — that is its purpose. If it fails, someone re-added a
    // widening clause (LEAST(...) / a MIN(m2."createdAt") subquery over this
    // coach's own messages); the fixture is not stale.
    //
    // Shape: single coach, NO ClientCoachingContext row (legacy fallback), and
    // NO other-coach evidence anywhere in the thread — precisely the emptiness
    // that used to enable the widening. That emptiness proves nothing: an
    // account purge deletes a departed coach's Message rows AND their
    // CoachClient row (lib/account-deletion/purge.ts:180,183), and a predecessor
    // who never wrote leaves the same emptiness with no purge at all. See case
    // 19 for the purge path specifically.
    const coach = await makeCoach("BfCoach6");
    const client = await makeClient("BfClient6");
    const weekOf = new Date("2025-01-06T00:00:00Z");

    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2025-06-01T00:00:00Z") } });
    // This coach's own earliest message to this client — the value the deleted
    // clause used to pull startsAt back to.
    const coachEarliest = await legacyMessage(client.id, coach.id, "coach earliest message", new Date("2025-01-10T10:00:00Z"), weekOf);
    // Strictly after the coach's earliest message and strictly before
    // rowCreatedAt: the span the deleted clause would have swept in.
    const widenedEarly = await legacyMessage(client.id, client.id, "reply inside the old widened span (early)", new Date("2025-02-01T10:00:00Z"), weekOf);
    const widenedLate = await legacyMessage(client.id, client.id, "reply inside the old widened span (late)", new Date("2025-05-31T10:00:00Z"), weekOf);
    const afterRow = await legacyMessage(client.id, client.id, "reply after the relationship row date", new Date("2025-06-02T10:00:00Z"), weekOf);

    await runBackfill();

    // startsAt is EXACTLY rowCreatedAt (2025-06-01), no matter how far back this
    // coach's own message history runs.
    expect(await coachIdOf(widenedEarly.id)).toBeNull();
    expect(await coachIdOf(widenedLate.id)).toBeNull();
    expect(await coachIdOf(afterRow.id)).toBe(coach.id);
    expect(await coachIdOf(coachEarliest.id)).toBe(coach.id);

    const seen = await coachSees(coach, client.id);
    expect(seen).toEqual(["coach earliest message", "reply after the relationship row date"]);
    expect((await getAllMessages(client.id)).map((m) => m.body)).toEqual([
      "coach earliest message",
      "reply inside the old widened span (early)",
      "reply inside the old widened span (late)",
      "reply after the relationship row date",
    ]);
  });

  it("7. never overwrites an existing attribution, and bounds a clean successor at its own relationship row date", async () => {
    // CLEAN-SUCCESSOR topology, with every date pinned. Coach A's relationship
    // ended (CoachClient hard-deleted) and coach B's row was created strictly
    // after A's last message, so `rowCreatedAt > lastOtherCoachAt` and startsAt
    // is B's row date (2025-06-01). Without pinning these dates relative to each
    // other the branch taken — and therefore every assertion below — is
    // undefined.
    const coachA = await makeCoach("BfCoach7A");
    const coachB = await makeCoach("BfCoach7B");
    const client = await makeClient("BfClient7");
    const weekOf = new Date("2025-01-13T00:00:00Z");

    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id, createdAt: new Date("2025-06-01T00:00:00Z") } });
    const alreadyAttributed = await db.message.create({
      data: { clientId: client.id, senderId: coachA.id, body: "already attributed to coach A", coachId: coachA.id, weekOf, createdAt: new Date("2025-03-01T10:00:00Z") },
    });
    // A CLIENT-authored reply written during coach A's era that already carries
    // attribution. The coach-authored row above is not a non-overwrite test on
    // its own — step 1 would have re-derived it to the same value anyway. This
    // row proves the real thing worth pinning: the write can only ever land on
    // a NULL-coachId row, so an already-attributed client-authored row is a
    // case step 1 could not fix for us. (The `m."coachId" IS NULL` guard in the
    // UPDATE is itself unfalsifiable by any fixture: the clamp already requires
    // createdAt > lastOtherCoachAt for a window to open, which makes a
    // foreign-coach row inside that window impossible, and the only candidate
    // left is the survivor's own id, where overwriting is a same-value no-op.
    // It stays in the SQL as defence-in-depth, not because a test can catch its
    // removal — see T-661 round-4 review.)
    const clientRowAlreadyAttributed = await db.message.create({
      data: { clientId: client.id, senderId: client.id, body: "client reply already attributed to coach A", coachId: coachA.id, weekOf, createdAt: new Date("2025-02-10T10:00:00Z") },
    });
    const beforeEverything = await legacyMessage(client.id, client.id, "reply inside coach A's era", new Date("2025-01-15T10:00:00Z"), weekOf);
    const betweenAAndBsRow = await legacyMessage(client.id, client.id, "reply after coach A but before coach B's row", new Date("2025-04-01T10:00:00Z"), weekOf);
    const afterBsRow = await legacyMessage(client.id, client.id, "reply after coach B's relationship began", new Date("2025-07-01T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(alreadyAttributed.id)).toBe(coachA.id);
    // Untouched, not overwritten and not re-derived.
    expect(await coachIdOf(clientRowAlreadyAttributed.id)).toBe(coachA.id);
    // Before startsAt and before coach A's last message.
    expect(await coachIdOf(beforeEverything.id)).toBeNull();
    // After coach A's last message but before coach B's row date: the successor
    // branch bounds by rowCreatedAt, not by the clamp alone, so this stays NULL.
    expect(await coachIdOf(betweenAAndBsRow.id)).toBeNull();
    expect(await coachIdOf(afterBsRow.id)).toBe(coachB.id);

    const seen = await coachSees(coachB, client.id);
    expect(seen).not.toContain("already attributed to coach A");
    expect(seen).not.toContain("client reply already attributed to coach A");
    expect(seen).not.toContain("reply inside coach A's era");
    expect(seen).not.toContain("reply after coach A but before coach B's row");
    expect(seen).toContain("reply after coach B's relationship began");
  });

  it("8. is idempotent — a second pass changes nothing and does not widen the clamp", async () => {
    // Case-1 shape: a clean single-coach client.
    const coach = await makeCoach("BfCoach8");
    const client = await makeClient("BfClient8");
    // Case-7 shape (clean successor, same pinned dates): a predecessor's row
    // already attributed to coach A, coach B's row created strictly after it.
    const coachA = await makeCoach("BfCoach8A");
    const coachB = await makeCoach("BfCoach8B");
    const successorClient = await makeClient("BfClient8Successor");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    const successorWeekOf = new Date("2025-01-13T00:00:00Z");

    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await legacyMessage(client.id, coach.id, "idempotency coach row", new Date("2026-02-03T10:00:00Z"), weekOf);
    await legacyMessage(client.id, client.id, "idempotency client row", new Date("2026-02-04T10:00:00Z"), weekOf);

    await db.coachClient.create({ data: { coachId: coachB.id, clientId: successorClient.id, createdAt: new Date("2025-06-01T00:00:00Z") } });
    await db.message.create({
      data: { clientId: successorClient.id, senderId: coachA.id, body: "idempotency predecessor row", coachId: coachA.id, weekOf: successorWeekOf, createdAt: new Date("2025-03-01T10:00:00Z") },
    });
    const stillNull = await legacyMessage(successorClient.id, successorClient.id, "idempotency clamped row", new Date("2025-04-01T10:00:00Z"), successorWeekOf);
    const gained = await legacyMessage(successorClient.id, successorClient.id, "idempotency gained row", new Date("2025-07-01T10:00:00Z"), successorWeekOf);

    const snapshot = async () => db.message.findMany({
      where: { clientId: { in: [client.id, successorClient.id] } },
      orderBy: { id: "asc" },
      select: { id: true, coachId: true },
    });

    await runBackfill();
    const afterFirst = await snapshot();
    await runBackfill();
    const afterSecond = await snapshot();

    // The first pass must actually have attributed something, otherwise the
    // equality below would pass on two identically-empty result sets.
    expect(afterFirst.filter((row) => row.coachId === coach.id)).toHaveLength(2);
    expect(afterFirst.find((row) => row.id === gained.id)?.coachId).toBe(coachB.id);
    expect(afterSecond).toEqual(afterFirst);
    // Pass 2 must not treat the rows pass 1 attributed to B as "other coach
    // evidence" for B — that would flip the topology test and change startsAt.
    expect(afterSecond.find((row) => row.id === stillNull.id)?.coachId).toBeNull();
    expect(afterSecond.find((row) => row.id === gained.id)?.coachId).toBe(coachB.id);
  });

  it("9. returns check-in posts to the coach thread", async () => {
    const coach = await makeCoach("BfCoach9");
    const client = await makeClient("BfClient9");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    const checkInPost = await legacyMessage(client.id, client.id, "[CHECKIN:fixture-checkin-id:Feb 3]Felt strong this week", new Date("2026-02-03T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(checkInPost.id)).toBe(coach.id);
    expect(await coachSees(coach, client.id)).toContain("[CHECKIN:fixture-checkin-id:Feb 3]Felt strong this week");
  });

  it("10. withholds the ENTIRE client when the surviving coach's relationship predates a departed second coach", async () => {
    // finding-1(a) + amendment 2: coach D's row is hard-deleted, so today's
    // COUNT(*) = 1 test sees only coach C. Step 1's attribution of D's own
    // message is the durable evidence that a second conversation existed.
    //
    // PREDECESSOR-SURVIVOR topology: C's surviving row (2025-01-01) is NOT
    // strictly after D's last message (2025-04-01), so no evidence-backed lower
    // bound exists and startsAt is NULL. Nothing is attributed for this client.
    //
    // WHY 2026-02-01 IS WITHHELD TOO, even though C is X's only coach today —
    // do not "fix" this assertion back to `toBe(coachC.id)`. On every signal
    // this database holds, the 2026-02-01 row is indistinguishable from the
    // 2025-04-02 row: same sender, both postdate C's relationship row date, both
    // postdate C's own last message, both postdate D's last message. The only
    // thing separating them is elapsed time, which is a heuristic, not evidence.
    // Attributing 2025-04-02 to C would hand C a reply written into D's live
    // thread, permanently and irreversibly, which is exactly the CB03 violation
    // this ticket exists to prevent. So the whole client is withheld. NULL is
    // recoverable by a later evidence-reviewed migration; a wrong non-NULL
    // attribution is not. See the topology split in T-661's Decision summary.
    const coachC = await makeCoach("BfCoach10C");
    const coachD = await makeCoach("BfCoach10D");
    const client = await makeClient("BfClient10");
    const weekOf = new Date("2025-01-06T00:00:00Z");

    await db.coachClient.create({ data: { coachId: coachC.id, clientId: client.id, createdAt: new Date("2025-01-01T00:00:00Z") } });
    const departed = await db.coachClient.create({ data: { coachId: coachD.id, clientId: client.id, createdAt: new Date("2025-03-01T00:00:00Z") } });

    const cAuthored = await legacyMessage(client.id, coachC.id, "C authored", new Date("2025-02-01T10:00:00Z"), weekOf);
    const dAuthored = await legacyMessage(client.id, coachD.id, "D authored", new Date("2025-04-01T10:00:00Z"), weekOf);
    const inCEra = await legacyMessage(client.id, client.id, "X reply in C era", new Date("2025-02-15T10:00:00Z"), weekOf);
    const inDEra = await legacyMessage(client.id, client.id, "X reply in D era", new Date("2025-04-02T10:00:00Z"), weekOf);
    const postD = await legacyMessage(client.id, client.id, "X reply after D", new Date("2026-02-01T10:00:00Z"), weekOf);

    await db.coachClient.delete({ where: { id: departed.id } });

    await runBackfill();

    // All three client-authored rows stay NULL: startsAt is NULL for this client.
    expect(await coachIdOf(inCEra.id)).toBeNull();
    expect(await coachIdOf(inDEra.id)).toBeNull();
    expect(await coachIdOf(postD.id)).toBeNull();
    // Step 1's sender-based attribution is untouched by step 2.
    expect(await coachIdOf(cAuthored.id)).toBe(coachC.id);
    expect(await coachIdOf(dAuthored.id)).toBe(coachD.id);

    const seen = await coachSees(coachC, client.id);
    expect(seen).toEqual(["C authored"]);

    expect((await getAllMessages(client.id)).map((m) => m.body)).toEqual([
      "C authored", "X reply in C era", "D authored", "X reply in D era", "X reply after D",
    ]);
  });

  it("11. still attributes a returning coach's own era — the topology split discriminates rather than over-refusing", async () => {
    // finding-1(b) + amendment 2: this is the CLEAN-SUCCESSOR topology. C's
    // re-created row (2026-01-01) IS strictly after D's last message
    // (2025-08-01), so startsAt = 2026-01-01 and attribution still happens. This
    // is the case that proves case 10's withhold is a narrow, evidence-driven
    // split and not a blanket refusal for every client with other-coach
    // evidence. C's own earliest message (2025-01-01) is irrelevant to startsAt:
    // nothing ever moves it earlier than the relationship row date (amendment 3
    // deleted the widening clause outright — see cases 6 and 19).
    const coachC = await makeCoach("BfCoach11C");
    const coachD = await makeCoach("BfCoach11D");
    const client = await makeClient("BfClient11");
    const weekOf = new Date("2025-01-06T00:00:00Z");

    const originalC = await db.coachClient.create({ data: { coachId: coachC.id, clientId: client.id, createdAt: new Date("2024-12-01T00:00:00Z") } });
    const departedD = await db.coachClient.create({ data: { coachId: coachD.id, clientId: client.id, createdAt: new Date("2025-07-01T00:00:00Z") } });

    await legacyMessage(client.id, coachC.id, "C authored 2025-01", new Date("2025-01-01T10:00:00Z"), weekOf);
    await legacyMessage(client.id, coachD.id, "D authored 2025-08", new Date("2025-08-01T10:00:00Z"), weekOf);
    const replyToD = await legacyMessage(client.id, client.id, "X reply to D", new Date("2025-09-01T10:00:00Z"), weekOf);
    const afterReturn = await legacyMessage(client.id, client.id, "X reply after C returned", new Date("2026-02-01T10:00:00Z"), weekOf);

    // D leaves; C's relationship is re-created, so the only surviving row is
    // C's, dated 2026-01-01.
    await db.coachClient.delete({ where: { id: departedD.id } });
    await db.coachClient.delete({ where: { id: originalC.id } });
    await db.coachClient.create({ data: { coachId: coachC.id, clientId: client.id, createdAt: new Date("2026-01-01T00:00:00Z") } });

    await runBackfill();

    // startsAt must be 2026-01-01 (the re-created row), not 2025-01-01.
    expect(await coachIdOf(replyToD.id)).toBeNull();
    expect(await coachIdOf(afterReturn.id)).toBe(coachC.id);
    expect(await coachSees(coachC, client.id)).not.toContain("X reply to D");
    expect(await coachSees(coachC, client.id)).toContain("X reply after C returned");
  });

  it("12. refuses to attribute when the coaching context is resolutionRequired", async () => {
    const coach = await makeCoach("BfCoach12");
    const client = await makeClient("BfClient12");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    const relationship = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    // The sticky state reconcileCoachingContextForClient never clears
    // (the early return is lib/activation.ts:193).
    await db.clientCoachingContext.create({
      data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: relationship.id, resolutionRequired: true, revision: 1 },
    });
    const reply = await legacyMessage(client.id, client.id, "reply while resolution required", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(reply.id)).toBeNull();
    // Pin the parity claim rather than restating the SQL: the application
    // itself refuses to name a coach for this client.
    expect((await getClientProvider(client.id)).coachId).toBeNull();
  });

  // Cases 13 (mode = AI) and 20 (mode = NONE) are the same code path: a context
  // row EXISTS, so getClientProvider skips the legacy NOT EXISTS fallback
  // (lib/queries/client-provider.ts:7-11) and `origin` never becomes "HUMAN",
  // which fails the `origin === "HUMAN"` test at :20. The migration's positive
  // context test (mode = 'HUMAN') must refuse both for the same reason. Neither
  // is redundant with case 14, where the context row IS HUMAN but names no
  // relationship.
  it.each([
    ["13", "AI"],
    ["20", "NONE"],
  ] as const)("%s. refuses to attribute when the coaching context mode is %s", async (label, mode) => {
    const coach = await makeCoach(`BfCoach${label}`);
    const client = await makeClient(`BfClient${label}`);
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await db.clientCoachingContext.create({
      data: { clientId: client.id, mode, activeCoachClientId: null, resolutionRequired: false, revision: 1 },
    });
    const reply = await legacyMessage(client.id, client.id, `reply while the context mode is ${mode}`, new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(reply.id)).toBeNull();
    expect((await getClientProvider(client.id)).coachId).toBeNull();
  });

  it("14. refuses to attribute when the context names no active relationship", async () => {
    const coach = await makeCoach("BfCoach14");
    const client = await makeClient("BfClient14");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await db.clientCoachingContext.create({
      data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: null, resolutionRequired: false, revision: 1 },
    });
    const reply = await legacyMessage(client.id, client.id, "reply with a dangling context", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(reply.id)).toBeNull();
    const provider = await getClientProvider(client.id);
    expect(provider.resolutionRequired).toBe(true);
    expect(provider.coachId).toBeNull();
  });

  it("15. attributes when the coaching context agrees — the production-shaped positive case", async () => {
    const coach = await makeCoach("BfCoach15");
    const client = await makeClient("BfClient15");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    const relationship = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    // Exactly what 20260913260000_client_coaching_context writes for a client
    // with one relationship, which is every client in production.
    await db.clientCoachingContext.create({
      data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: relationship.id, resolutionRequired: false, revision: 1 },
    });
    await legacyMessage(client.id, coach.id, "coach question 15", new Date("2026-02-03T10:00:00Z"), weekOf);
    const reply = await legacyMessage(client.id, client.id, "client reply 15", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    expect(await coachIdOf(reply.id)).toBe(coach.id);
    expect((await getClientProvider(client.id)).coachId).toBe(coach.id);
    const bodies = await coachSees(coach, client.id);
    expect(bodies).toContain("coach question 15");
    expect(bodies).toContain("client reply 15");
  });

  it("16. restores both directions for the web coach weekly view (getMessages)", async () => {
    const coach = await makeCoach("BfCoach16");
    const client = await makeClient("BfClient16");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    await legacyMessage(client.id, coach.id, "coach question 16", new Date("2026-02-03T10:00:00Z"), weekOf);
    await legacyMessage(client.id, client.id, "client reply 16", new Date("2026-02-04T10:00:00Z"), weekOf);

    await runBackfill();

    const asCoach = (await getMessages(client.id, weekOf, coach.id)).map((m) => m.body);
    expect(asCoach).toEqual(["coach question 16", "client reply 16"]);
    // The unscoped client view is unchanged by the backfill.
    const unscoped = (await getMessages(client.id, weekOf)).map((m) => m.body);
    expect(unscoped).toEqual(["coach question 16", "client reply 16"]);
  });

  it("17. moves the coach roster card's lastMessageAt onto the client's own newest reply", async () => {
    const coach = await makeCoach("BfCoach17");
    const client = await makeClient("BfClient17");
    const weekOf = new Date("2026-02-02T00:00:00Z");
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id, createdAt: new Date("2026-02-02T00:00:00Z") } });
    const coachRowAt = new Date("2026-02-03T10:00:00Z");
    const clientRowAt = new Date("2026-02-04T10:00:00Z");
    await legacyMessage(client.id, coach.id, "coach question 17", coachRowAt, weekOf);
    await legacyMessage(client.id, client.id, "client reply 17", clientRowAt, weekOf);

    // Pre-migration shape: nothing is attributed, so the card shows nothing.
    expect((await getClientProfile(coach.id, client.id))?.lastMessageAt).toBeNull();

    // After step 1 alone — the bug this ticket fixes: the newest thing the
    // coach can see is their own outgoing message.
    await runStepOne();
    expect((await getClientProfile(coach.id, client.id))?.lastMessageAt).toEqual(coachRowAt);

    // After the T-661 backfill the client's reply is the newest visible row.
    await runT661Backfill();
    expect((await getClientProfile(coach.id, client.id))?.lastMessageAt).toEqual(clientRowAt);
  });

  it("18. treats rowCreatedAt exactly equal to the other coach's last message as the conservative predecessor branch", async () => {
    // The topology test is strict `>`. This pins the one comparison most likely
    // to be relaxed to `>=` by a later editor: with `>=`, coach C's row being
    // stamped in the same transaction as the departing coach D's last message
    // would flip this client from withheld to attributed. Equality must fall
    // into the ELSE NULL branch.
    const coachC = await makeCoach("BfCoach18C");
    const coachD = await makeCoach("BfCoach18D");
    const client = await makeClient("BfClient18");
    const weekOf = new Date("2025-04-28T00:00:00Z");
    const boundary = new Date("2025-05-01T10:00:00Z");

    await db.coachClient.create({ data: { coachId: coachC.id, clientId: client.id, createdAt: boundary } });
    const departed = await db.coachClient.create({ data: { coachId: coachD.id, clientId: client.id, createdAt: new Date("2025-04-01T00:00:00Z") } });

    // D's only message, at exactly the same instant as C's relationship row.
    const dAuthored = await legacyMessage(client.id, coachD.id, "D authored at the boundary", boundary, weekOf);
    const afterBoundary = await legacyMessage(client.id, client.id, "X reply strictly after the boundary", new Date("2025-06-01T10:00:00Z"), weekOf);

    await db.coachClient.delete({ where: { id: departed.id } });

    await runBackfill();

    expect(await coachIdOf(dAuthored.id)).toBe(coachD.id);
    // rowCreatedAt == lastOtherCoachAt, so `rowCreatedAt > lastOtherCoachAt` is
    // false and startsAt is NULL — nothing is attributed for this client.
    expect(await coachIdOf(afterBoundary.id)).toBeNull();
    expect(await coachSees(coachC, client.id)).not.toContain("X reply strictly after the boundary");
  });

  it("19. withholds a purged predecessor's era even though the purge erased every trace that one existed", async () => {
    // AMENDMENT-3 PIN, the production-reachable half. Case 6 proves the widening
    // clause is gone on a clean fixture; this case proves the SPECIFIC leak it
    // opened is closed.
    //
    // Unlike case 10, the departed coach D is removed the way purgeUserAccount
    // removes one: BOTH their Message rows (lib/account-deletion/purge.ts:180)
    // and their CoachClient row (:183), inside one db.$transaction (:28).
    // Calling purgeUserAccount itself is not required here — it needs Clerk /
    // Stripe / storage doubles — so the two raw DELETEs below are used because
    // they are exactly the DB-visible outcome of those two lines.
    //
    // After the purge there is NO surviving evidence that a second coach ever
    // existed: other_coach_evidence is empty and the topology reads 'clean', not
    // 'predecessor'. That is the whole point — case 10's bare CoachClient-row
    // deletion leaves D's messages behind as evidence; a purge does not. Only the
    // ABSENCE of a widening clause keeps X's D-era replies NULL.
    //
    // THIS CASE FAILS AGAINST THE AMENDMENT-2 SQL: there, startsAt would be
    // LEAST(2025-09-01, 2025-01-05) = 2025-01-05, handing C the client's half of
    // D's conversation permanently.
    const coachC = await makeCoach("BfCoach19C");
    const coachD = await makeCoach("BfCoach19D");
    const client = await makeClient("BfClient19");
    const weekOf = new Date("2025-01-06T00:00:00Z");

    // C served X under an earlier relationship whose CoachClient row is long gone.
    const cEarliest = await legacyMessage(client.id, coachC.id, "C earliest message", new Date("2025-01-05T10:00:00Z"), weekOf);

    await db.coachClient.create({ data: { coachId: coachD.id, clientId: client.id, createdAt: new Date("2025-02-01T00:00:00Z") } });
    await legacyMessage(client.id, coachD.id, "D authored early", new Date("2025-02-10T10:00:00Z"), weekOf);
    await legacyMessage(client.id, coachD.id, "D authored late", new Date("2025-06-20T10:00:00Z"), weekOf);

    // Replies written into D's live thread, plus one after C returned.
    const inDEraEarly = await legacyMessage(client.id, client.id, "X reply into D's thread (early)", new Date("2025-03-01T10:00:00Z"), weekOf);
    const inDEraLate = await legacyMessage(client.id, client.id, "X reply into D's thread (late)", new Date("2025-05-01T10:00:00Z"), weekOf);
    const afterCReturned = await legacyMessage(client.id, client.id, "X reply after C returned", new Date("2025-09-15T10:00:00Z"), weekOf);

    // C returns: the row is re-created after D's era. This is exactly the
    // "innocent re-created row" the widening clause was written to protect.
    await db.coachClient.create({ data: { coachId: coachC.id, clientId: client.id, createdAt: new Date("2025-09-01T00:00:00Z") } });

    // Purge D — the DB-visible outcome of purge.ts:180 then :183.
    await db.$executeRawUnsafe(`DELETE FROM "Message" WHERE "senderId" = $1 OR "clientId" = $1`, coachD.id);
    await db.$executeRawUnsafe(`DELETE FROM "CoachClient" WHERE "coachId" = $1 OR "clientId" = $1`, coachD.id);

    // Post-purge preconditions, asserted first so this case cannot silently
    // degrade into case 10 (which keeps the departed coach's messages).
    expect(await db.coachClient.count({ where: { clientId: client.id } })).toBe(1);
    expect(await db.message.count({ where: { senderId: coachD.id } })).toBe(0);

    await runBackfill();

    // startsAt = rowCreatedAt = 2025-09-01, with no widening, so D's era stays
    // NULL even though nothing in the database records that D was ever there.
    expect(await coachIdOf(inDEraEarly.id)).toBeNull();
    expect(await coachIdOf(inDEraLate.id)).toBeNull();
    expect(await coachIdOf(afterCReturned.id)).toBe(coachC.id);
    expect(await coachIdOf(cEarliest.id)).toBe(coachC.id);

    expect(await coachSees(coachC, client.id)).toEqual(["C earliest message", "X reply after C returned"]);
    // D's two messages are GONE (deleted by the purge), not hidden.
    expect((await getAllMessages(client.id)).map((m) => m.body)).toEqual([
      "C earliest message",
      "X reply into D's thread (early)",
      "X reply into D's thread (late)",
      "X reply after C returned",
    ]);

    // WHAT THIS CASE DELIBERATELY DOES NOT ASSERT: that 2025-09-15 stays NULL.
    // It is attributed to C even though a since-purged coach could in principle
    // have been active after 2025-09-01 too. That is the documented residual
    // exposure — startsAt = rowCreatedAt is a FLOOR, not a proof of exclusivity
    // (see "Residual exposure" in T-661's Decision summary). rowCreatedAt is a
    // durable fact recorded about THIS relationship and is the identical bound
    // the running app already grants this coach for plan reads
    // (lib/queries/current-client-plan.ts:17-18). Tightening further means
    // attributing nothing at all, which reinstates the P0 this ticket fixes. Do
    // not "fix" this case by asserting 2025-09-15 is NULL.
  });
});
