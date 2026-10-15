import { db } from "@/lib/db";
import { deployEnv, releaseId } from "@/lib/observability/release";
import { EXPECTED_MIGRATIONS } from "@/lib/health/expected-migrations";

export type HealthReport = {
  status: "ok" | "degraded";
  release: string;
  env: "production" | "preview" | "development";
  db: "ok" | "unreachable";
  migrations: "ok" | "dirty" | "unknown";
  migrationsApplied: number;
  migrationsExpected: number;
  checkedInMs: number;
  ts: string;
};

type MigrationLedgerRow = {
  applied: bigint | number | string;
  unfinished: bigint | number | string;
};

const CACHE_TTL_MS = 10_000;
const QUERY_TIMEOUT_MS = 2_000;

let cached: { report: HealthReport; expiresAt: number } | undefined;
let inFlight: Promise<HealthReport> | undefined;

function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.round(Date.now() - startedAt));
}

function degradedReport(startedAt: number): HealthReport {
  return {
    status: "degraded",
    release: releaseId(),
    env: deployEnv(),
    db: "unreachable",
    migrations: "unknown",
    migrationsApplied: 0,
    migrationsExpected: EXPECTED_MIGRATIONS,
    checkedInMs: elapsedSince(startedAt),
    ts: new Date().toISOString(),
  };
}

async function migrationLedger(): Promise<MigrationLedgerRow> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      db.$queryRaw<MigrationLedgerRow[]>`
        SELECT
          count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
          count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS unfinished
        FROM "_prisma_migrations"
      `,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("health query timed out")), QUERY_TIMEOUT_MS);
      }),
    ]);
    if (!result[0]) throw new Error("health query returned no ledger row");
    return result[0];
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function runHealthCheck(): Promise<HealthReport> {
  const startedAt = Date.now();
  try {
    const ledger = await migrationLedger();
    const applied = Number(ledger.applied);
    const unfinished = Number(ledger.unfinished);
    if (!Number.isSafeInteger(applied) || !Number.isSafeInteger(unfinished)) {
      return degradedReport(startedAt);
    }

    const migrations = unfinished > 0 ? "dirty" : "ok";
    const status = migrations === "ok" && applied === EXPECTED_MIGRATIONS ? "ok" : "degraded";
    return {
      status,
      release: releaseId(),
      env: deployEnv(),
      db: "ok",
      migrations,
      migrationsApplied: applied,
      migrationsExpected: EXPECTED_MIGRATIONS,
      checkedInMs: elapsedSince(startedAt),
      ts: new Date().toISOString(),
    };
  } catch {
    return degradedReport(startedAt);
  }
}

export function checkHealth(): Promise<HealthReport> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.report);
  if (inFlight) return inFlight;

  inFlight = runHealthCheck()
    .then((report) => {
      cached = { report, expiresAt: Date.now() + CACHE_TTL_MS };
      return report;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export function __resetHealthCacheForTests(): void {
  cached = undefined;
  inFlight = undefined;
}
