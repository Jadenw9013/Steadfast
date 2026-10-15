/**
 * T-2014: proves the cross-file lock is a real mutual exclusion rather than a
 * no-op that merely stops the suite noticing a collision.
 *
 * The conformance unit test (`tests/unit/integration-global-ai-coach-state.test.ts`)
 * proves every participating file *declares* a mode. This file proves the
 * declaration actually takes a lock in Postgres, and that the shared mode still
 * lets shared holders run together — the property that keeps the rest of the AI
 * Coach integration suite parallel instead of degenerating into
 * `--no-file-parallelism` with extra machinery.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");

/** Must match `LOCK_NAME` in tests/helpers/global-ai-coach-state.ts. */
const LOCK_NAME = "steadfast.tests.ai_coach_global_state";

suite("T-2014 global AI Coach state lock", () => {
  const opened: Client[] = [];

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    opened.push(client);
    return client;
  }

  async function tryLock(client: Client, name: string, shared: boolean): Promise<boolean> {
    const fn = shared ? "pg_try_advisory_lock_shared" : "pg_try_advisory_lock";
    const result = await client.query<{ locked: boolean }>(
      `SELECT ${fn}(hashtext($1)) AS locked`,
      [name]
    );
    return result.rows[0].locked;
  }

  afterAll(async () => {
    await Promise.all(opened.splice(0).map((client) => client.end()));
  });

  it("this file's own declaration really holds the lock", async () => {
    // This file declared `shared` above. From an independent session an
    // exclusive claim on the same key therefore cannot be granted. If
    // `lockGlobalAiCoachState` ever stopped taking the lock — an early return,
    // a swallowed connection error, a renamed key — this claim would succeed
    // and this test would fail, instead of the suite quietly going back to
    // being ordering-dependent.
    const observer = await connect();
    expect(await tryLock(observer, LOCK_NAME, false)).toBe(false);
  });

  it("shared holders do not exclude each other, exclusive holders exclude everyone", async () => {
    // Exercised on a key unique to this run so the assertions cannot be
    // perturbed by whichever other integration file happens to be running.
    const key = `steadfast.tests.t2014-semantics.${randomUUID()}`;
    const first = new Client({ connectionString: process.env.DATABASE_URL });
    const second = new Client({ connectionString: process.env.DATABASE_URL });
    await first.connect();
    await second.connect();
    const exclusive = await connect();
    try {
      expect(await tryLock(first, key, true)).toBe(true);
      expect(await tryLock(second, key, true)).toBe(true);
      expect(await tryLock(exclusive, key, false)).toBe(false);
    } finally {
      await first.end();
      await second.end();
    }
    expect(await tryLock(exclusive, key, false)).toBe(true);
  });
});
