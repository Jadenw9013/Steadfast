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
});
