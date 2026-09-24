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
 * Keep this in lockstep with `LOCAL_DB_RE` in `.claude/hooks/guard.py`
 * (steadfast-hq repo) — that regex allows the same two path shapes
 * (`steadfast_security_test` and `steadfast_migration_replay_[A-Za-z0-9_]+`)
 * for the same reason: anything else may be a real (Neon) database. If you
 * widen one, widen the other, and say why in both places.
 */
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_PATH_RE = /^\/steadfast_(?:security_test|migration_replay_[A-Za-z0-9_]+)$/;
const REQUIRED_MESSAGE = "Dedicated local test database required";

export function requireLocalTestDb(): void {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error(REQUIRED_MESSAGE);
  }
  if (!ALLOWED_HOSTS.has(url.hostname) || !ALLOWED_PATH_RE.test(url.pathname)) {
    throw new Error(REQUIRED_MESSAGE);
  }
}
