/**
 * Single shared fail-closed guard for integration tests: refuses to run
 * unless `DATABASE_URL` points at a local, disposable test database.
 *
 * Before T-991, 66 integration test files each hand-copied this check, hard
 * coded to exactly `127.0.0.1/steadfast_security_test`. `scripts/gates.sh`
 * now also builds a per-run disposable database named
 * `steadfast_migration_replay_<sha>_<pid>` (see
 * `scripts/replay-prisma-migrations.sh`), so the old check rejected every
 * legitimate disposable-DB run. This helper accepts both shapes and is the
 * single place either shape can ever be added to again.
 *
 * This is the stricter of the two DB-safety checks in the stack — the only
 * one that sees the resolved `DATABASE_URL` at runtime rather than the raw
 * shell text — and it is not identical to `LOCAL_DB_RE` in
 * `.claude/hooks/guard.py` (steadfast-hq repo). Known divergences, so nobody
 * assumes widening one automatically widens the other:
 *   1. Hostname casing: the WHATWG `URL` parser lowercases the host before
 *      this code ever sees it, so `LOCALHOST` resolves the same as
 *      `localhost` here. `guard.py`'s regex is a literal, case-sensitive
 *      match on the raw shell text, so it blocks `LOCALHOST` outright. Not a
 *      hole (fail-closed either way), just an asymmetry worth knowing about.
 *   2. Trailing `/` after the database name: rejected here (`$`-anchored
 *      match on `url.pathname`), accepted by `guard.py` (`\b`-terminated).
 *      This side is the stricter one; harmless.
 *   3. `$STEADFAST_TEST_DB`: `guard.py` whitelists the *unexpanded* env var
 *      name in the shell text without ever seeing (or validating) its
 *      value. This helper has no such escape hatch — it only ever validates
 *      the actual resolved `DATABASE_URL` — which is strictly safer, not a
 *      gap, but it means the two checks are validating different things at
 *      that call site.
 * No query string is accepted at all (`url.search` must be empty): a local
 * test URL never needs one, and `pg-connection-string` (which `pg.Pool`/
 * Prisma use to open the actual connection) copies query params like
 * `host`/`hostaddr`/`port`/`options` onto the connection config, overriding
 * the parsed hostname — so allowing an allowlisted param, rather than
 * rejecting the query string entirely, would have reopened the same hole
 * with extra steps the moment someone added one more accepted key.
 */
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_PATH_RE = /^\/steadfast_(?:security_test|migration_replay_[A-Za-z0-9_.-]+)$/;
const REQUIRED_MESSAGE = "Dedicated local test database required";

export function requireLocalTestDb(): void {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error(REQUIRED_MESSAGE);
  }
  if (
    !ALLOWED_HOSTS.has(url.hostname) ||
    !ALLOWED_PATH_RE.test(url.pathname) ||
    url.search !== ""
  ) {
    throw new Error(REQUIRED_MESSAGE);
  }
}
