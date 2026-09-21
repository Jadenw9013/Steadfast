import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { __resetHealthCacheForTests } from "@/lib/health/check";
import { EXPECTED_MIGRATIONS } from "@/lib/health/expected-migrations";
import { db } from "@/lib/db";
import { PUBLIC_ROUTE_PATTERNS } from "@/proxy";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;
const FIXTURE_MARKER = "T-922 local integration fixture";
let ownsLedgerFixture = false;

suite("GET /api/health", () => {
  beforeAll(async () => {
    const [existing] = await db.$queryRawUnsafe<Array<{ relation: string | null; marker: string | null }>>(`
      SELECT
        to_regclass('public._prisma_migrations')::text AS relation,
        CASE
          WHEN to_regclass('public._prisma_migrations') IS NULL THEN NULL
          ELSE obj_description(to_regclass('public._prisma_migrations'), 'pg_class')
        END AS marker
    `);

    if (existing?.relation && existing.marker !== FIXTURE_MARKER) {
      return; // A real Prisma ledger belongs to the database, never to this test.
    }

    if (existing?.marker === FIXTURE_MARKER) {
      await db.$executeRawUnsafe(`DROP TABLE "_prisma_migrations"`);
    }

    await db.$executeRawUnsafe(`
      CREATE TABLE "_prisma_migrations" (
        id VARCHAR(36) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMPTZ,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT,
        rolled_back_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.$executeRawUnsafe(
      `COMMENT ON TABLE "_prisma_migrations" IS '${FIXTURE_MARKER}'`
    );
    await db.$executeRawUnsafe(`
      INSERT INTO "_prisma_migrations" (
        id, checksum, finished_at, migration_name, started_at, applied_steps_count
      )
      SELECT
        md5(number::text),
        md5(number::text) || md5(number::text),
        now(),
        't922_fixture_' || number::text,
        now(),
        1
      FROM generate_series(1, ${EXPECTED_MIGRATIONS}) AS number
    `);
    ownsLedgerFixture = true;
  });

  afterAll(async () => {
    __resetHealthCacheForTests();
    if (ownsLedgerFixture) {
      await db.$executeRawUnsafe(`DROP TABLE "_prisma_migrations"`);
    }
  });

  it("reports the real local database without leaking connection or ledger details", async () => {
    __resetHealthCacheForTests();
    const response = await GET();
    const body = await response.json();
    const encoded = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.migrations).toBe("ok");
    expect(body.migrationsApplied).toBeGreaterThan(0);

    for (const forbidden of [
      "steadfast_security_test",
      "127.0.0.1",
      "postgres",
      "prisma",
      "_prisma_migrations",
      "password",
      "DATABASE_URL",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }

    const migrationNames = readdirSync(join(process.cwd(), "prisma", "migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const migrationName of migrationNames) {
      expect(encoded).not.toContain(migrationName);
    }
  });

  it("adds only the literal health route to the existing public allowlist", () => {
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/api/health");
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/api/webhooks(.*)");
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/api/cron(.*)");
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/api/public(.*)");
    expect(PUBLIC_ROUTE_PATTERNS).not.toContain("/api/coach(.*)");
    expect(PUBLIC_ROUTE_PATTERNS).not.toContain("/api/client(.*)");
    expect(PUBLIC_ROUTE_PATTERNS).not.toContain("/api/messages(.*)");
  });
});
