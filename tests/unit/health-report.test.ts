import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { $queryRaw: mocks.queryRaw },
}));

import {
  __resetHealthCacheForTests,
  checkHealth,
} from "@/lib/health/check";
import { EXPECTED_MIGRATIONS } from "@/lib/health/expected-migrations";
import { GET } from "@/app/api/health/route";

const HEALTH_KEYS = [
  "checkedInMs",
  "db",
  "env",
  "migrations",
  "migrationsApplied",
  "migrationsExpected",
  "release",
  "status",
  "ts",
];

function ledger(applied = EXPECTED_MIGRATIONS, unfinished = 0) {
  return [{ applied: BigInt(applied), unfinished: BigInt(unfinished) }];
}

describe("health report", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    __resetHealthCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a healthy 200 with the exact frozen key set", async () => {
    mocks.queryRaw.mockResolvedValue(ledger());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.migrations).toBe("ok");
    expect(Object.keys(body).sort()).toEqual(HEALTH_KEYS);
  });

  it("returns a redacted degraded 503 when the query rejects", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("postgresql://secret-host/private-db"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      db: "unreachable",
      migrations: "unknown",
      migrationsApplied: 0,
    });
    expect(Object.keys(body).sort()).toEqual(HEALTH_KEYS);
    expect(JSON.stringify(body)).not.toContain("secret-host");
    expect(JSON.stringify(body)).not.toContain("private-db");
  });

  it("reports an unfinished migration as dirty and degraded", async () => {
    mocks.queryRaw.mockResolvedValue(ledger(EXPECTED_MIGRATIONS, 1));

    await expect(checkHealth()).resolves.toMatchObject({
      status: "degraded",
      db: "ok",
      migrations: "dirty",
      migrationsApplied: EXPECTED_MIGRATIONS,
    });
  });

  it("degrades on an applied-count mismatch even when the ledger is otherwise clean", async () => {
    mocks.queryRaw.mockResolvedValue(ledger(EXPECTED_MIGRATIONS - 1));

    await expect(checkHealth()).resolves.toMatchObject({
      status: "degraded",
      db: "ok",
      migrations: "ok",
      migrationsApplied: EXPECTED_MIGRATIONS - 1,
    });
  });

  it("times out a stalled query after two seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    mocks.queryRaw.mockReturnValue(new Promise(() => {}));

    const pending = checkHealth();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toMatchObject({
      status: "degraded",
      db: "unreachable",
      migrations: "unknown",
      checkedInMs: 2_000,
    });
  });

  it("coalesces calls and refreshes only after the ten-second cache window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T00:00:00.000Z"));
    mocks.queryRaw.mockResolvedValue(ledger());

    await Promise.all([checkHealth(), checkHealth()]);
    await checkHealth();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_001);
    await checkHealth();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("uses local as the release when no Vercel sha is present", async () => {
    const previous = process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    vi.resetModules();
    const fresh = await import("@/lib/health/check");
    mocks.queryRaw.mockResolvedValue(ledger());
    const report = await fresh.checkHealth();
    expect(report.release).toBe("local");

    if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previous;
    vi.resetModules();
  });

  it("uses the seven-character Vercel sha prefix", async () => {
    const previous = process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = "1234567890abcdef";
    vi.resetModules();
    const fresh = await import("@/lib/health/check");
    mocks.queryRaw.mockResolvedValue(ledger());

    const report = await fresh.checkHealth();
    expect(report.release).toBe("1234567");

    if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previous;
    vi.resetModules();
  });
});
