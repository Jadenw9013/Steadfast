/**
 * T-2014: cross-file mutual exclusion over the AI Coach state that is global
 * to the whole test database rather than scoped to one fixture's rows.
 *
 * ## The defect this exists for
 *
 * Vitest runs test *files* in parallel (separate worker processes) against one
 * Postgres. Several AI Coach integration files reach for state that has exactly
 * one instance per database:
 *
 *   - the sole `AiCoachLiveActivation` row with `state = 'ACTIVE'`
 *     (`lib/ai-coach/live-launch/repository.ts` refuses a second one with
 *     `LIVE_ACTIVATION_ALREADY_EXISTS`);
 *   - the five `AiCoachOperationalControl` kill switches, keyed by scope;
 *   - table-wide invariants a test asserts on purpose, e.g.
 *     `ai-coach-live-autonomy.test.ts`'s "no `AiCoachReviewerGrant` anywhere",
 *     which is deliberately unscoped so it cannot pass vacuously.
 *
 * Two files touching that state at the same moment produce failures that say
 * nothing about the code: a grant another file created, a release another file
 * activated. Measured on a clean replayed database (board/evidence/T-2014.md),
 * the same five files were 5 files / 55 tests green serially and 4 tests red in
 * parallel, so the suite's colour depended on file ordering and machine speed.
 *
 * ## What this helper does, and what it deliberately does not do
 *
 * It **orders** access. It never deletes a row, relaxes an assertion, retries,
 * or swallows an error. A file declares how it uses the global state:
 *
 *   - `"exclusive"` — it wipes, asserts table-wide, or occupies the single live
 *     release. It runs with no other declaring file alongside it.
 *   - `"shared"` — it only creates or reads its own AI Coach rows, but those
 *     rows are visible to an `"exclusive"` file's wipe or table-wide count.
 *     Shared holders still run fully in parallel with each other.
 *
 * Consequence on a *genuine* conflict — a code change that really does leave an
 * `ACTIVE` activation behind, or really does create a reviewer grant where none
 * belongs: the lock changes nothing. The next file still finds the row, still
 * throws `LIVE_ACTIVATION_ALREADY_EXISTS`, still fails the `count() === 0`
 * assertion, in the same place with the same message. Only the *concurrency*
 * artefact is removed; the invariant keeps its full strength.
 *
 * ## Implementation notes
 *
 * A session-level `pg_advisory_lock` is held for the lifetime of the file on a
 * dedicated `pg.Client`. It has to be a dedicated connection: session-level
 * advisory locks belong to the connection that took them, and Prisma hands out
 * pooled connections it may swap between queries.
 *
 * The lock name is deliberately NOT the production key
 * (`steadfast.ai_coach.live_activation`). Production takes that one inside its
 * own transaction; if a test session held the same key exclusively, the
 * production transaction would block until the test's hook timeout instead of
 * running, which would turn a test-isolation helper into a hang.
 *
 * Postgres releases every session-level advisory lock when the connection
 * closes, so a crashed or killed worker cannot strand the lock — `afterAll`
 * simply ends the client rather than issuing an unlock that could itself fail.
 */
import { Client } from "pg";
import { afterAll, beforeAll } from "vitest";
import { requireLocalTestDb } from "./require-local-test-db";

const LOCK_NAME = "steadfast.tests.ai_coach_global_state";

/**
 * Generous on purpose: this is the time a file may spend queued behind another
 * file's exclusive section, not the time any single operation takes. Vitest's
 * default `hookTimeout` is 10s, which the slowest AI Coach file exceeds on its
 * own, so the default would convert ordinary queueing into a spurious failure.
 */
const ACQUIRE_TIMEOUT_MS = 10 * 60 * 1000;

export type GlobalAiCoachStateMode = "exclusive" | "shared";

/**
 * Registers file-level `beforeAll`/`afterAll` hooks that hold the global AI
 * Coach state lock for the whole file. Call once, at module top level, next to
 * the file's `SECURITY_INTEGRATION` gate.
 *
 * No-ops when `SECURITY_INTEGRATION !== "1"`, because the file's suites are
 * `describe.skip`ped in that mode and `DATABASE_URL` may legitimately be unset.
 */
export function lockGlobalAiCoachState(mode: GlobalAiCoachStateMode): void {
  if (process.env.SECURITY_INTEGRATION !== "1") return;

  let client: Client | null = null;

  beforeAll(async () => {
    requireLocalTestDb();
    const connecting = new Client({ connectionString: process.env.DATABASE_URL });
    await connecting.connect();
    client = connecting;
    const lockFunction = mode === "exclusive" ? "pg_advisory_lock" : "pg_advisory_lock_shared";
    await connecting.query(`SELECT ${lockFunction}(hashtext($1))`, [LOCK_NAME]);
  }, ACQUIRE_TIMEOUT_MS);

  afterAll(async () => {
    const connected = client;
    client = null;
    // Ending the session releases the advisory lock; no explicit unlock, so a
    // failed test can never leave the lock held by a still-open connection.
    if (connected) await connected.end();
  }, ACQUIRE_TIMEOUT_MS);
}
