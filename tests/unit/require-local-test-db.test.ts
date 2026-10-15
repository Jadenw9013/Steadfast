import { afterEach, describe, expect, it, vi } from "vitest";
import { requireLocalTestDb } from "../helpers/require-local-test-db";

describe("requireLocalTestDb", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts 127.0.0.1/steadfast_security_test", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test");
    expect(() => requireLocalTestDb()).not.toThrow();
  });

  it("accepts localhost/steadfast_migration_replay_gates_abc_1", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://jadenwong@localhost:5432/steadfast_migration_replay_gates_abc_1");
    expect(() => requireLocalTestDb()).not.toThrow();
  });

  it("rejects a .neon.tech host", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:pass@ep-cool-lab-123456.us-east-2.aws.neon.tech/steadfast_security_test"
    );
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("rejects 127.0.0.1/steadfast_prod", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://jadenwong@127.0.0.1:5432/steadfast_prod");
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("rejects an empty DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  // T-991 review round 1, MAJOR 1: pg-connection-string copies query params
  // like `host`/`hostaddr`/`port`/`options` onto the connection config and
  // only falls back to the parsed hostname if none of those are present, so
  // a `?host=` (or `?hostaddr=`) query string on an otherwise-local URL can
  // redirect the actual connection to a remote database while still passing
  // a hostname/pathname-only check. The fix is to reject any query string.
  it("rejects a local URL with a ?host= query param pointing at Neon", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:pass@127.0.0.1:5432/steadfast_security_test?host=ep-cool-lab-123456.us-east-2.aws.neon.tech&port=5432&sslmode=require"
    );
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("rejects a local URL with a ?hostaddr= query param", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:pass@127.0.0.1:5432/steadfast_security_test?hostaddr=10.0.0.1"
    );
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("rejects a local URL with an otherwise-benign ?sslmode= query param", () => {
    // No query string is accepted at all, even one that carries no host
    // override on its own: an allowlist of "safe" keys is exactly the kind
    // of check that grows one more accepted key and reopens the hole.
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test?sslmode=require"
    );
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("rejects a trailing slash after the database name", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test/");
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("rejects a bare steadfast_migration_replay_ with no suffix", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://jadenwong@127.0.0.1:5432/steadfast_migration_replay_");
    expect(() => requireLocalTestDb()).toThrow("Dedicated local test database required");
  });

  it("accepts a migration-replay suffix with dots and dashes", () => {
    // scripts/replay-prisma-migrations.sh matches on startsWith(), so a
    // human-run replay with a branch-shaped suffix (dots/dashes) must not
    // throw at import in every integration file (T-991 review round 1, MINOR
    // "widen the name charset").
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://jadenwong@127.0.0.1:5432/steadfast_migration_replay_t991-check.2026-09-24"
    );
    expect(() => requireLocalTestDb()).not.toThrow();
  });
});
