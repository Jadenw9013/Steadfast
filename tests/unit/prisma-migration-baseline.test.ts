import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const migrationsRoot = join(repoRoot, "prisma", "migrations");
const baselinePath = join(repoRoot, "prisma", "baselines", "20260915000000_legacy", "baseline.sql");
const historicalManifestPath = join(
  repoRoot,
  "prisma",
  "baselines",
  "20260915000000_legacy",
  "historical-migrations.sha256"
);
const checkInMigrationPath = join(
  migrationsRoot,
  "20260216000000_add_checkin_status",
  "migration.sql"
);
const replayScriptPath = join(repoRoot, "scripts", "replay-prisma-migrations.sh");
const cutoff = "20260915000000_message_coach_backfill_single_coach";

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function migrationDirectories() {
  return readdirSync(migrationsRoot)
    .filter((entry) => {
      const path = join(migrationsRoot, entry);
      return statSync(path).isDirectory() && existsSync(join(path, "migration.sql"));
    })
    .sort();
}

describe("legacy Prisma baseline", () => {
  it("pins the reviewed snapshot and leaves the failing historical migration unchanged", () => {
    expect(sha256(baselinePath)).toBe(
      "91fda9c79080c6829e35bf0db15f7c6e438110c10c203c46eb0376484d08a63f"
    );
    expect(sha256(checkInMigrationPath)).toBe(
      "0d96b6e9780e5e1cf7fd47f8f780af2ac58caae7e8416b138b9eb37696db544e"
    );
  });

  it("resolves exactly the reviewed legacy range and leaves forward migrations to deploy", () => {
    const migrations = migrationDirectories();
    const baselineMigrations = migrations.filter((name) => name <= cutoff);
    const forwardMigrations = migrations.filter((name) => name > cutoff);

    expect(baselineMigrations).toHaveLength(66);
    expect(baselineMigrations.at(-1)).toBe(cutoff);
    expect(forwardMigrations.length).toBeGreaterThan(0);
    expect(forwardMigrations[0]).toBe("20260921000000_ai_coach_reviewed_artifacts");

    const manifestPaths = readFileSync(historicalManifestPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/).at(-1)?.split("/").at(-2));
    expect(manifestPaths).toEqual(baselineMigrations);
  });

  it("preserves raw SQL invariants that the Prisma schema cannot model", () => {
    const baseline = readFileSync(baselinePath, "utf8");

    expect(baseline).toContain('CREATE INDEX "CheckIn_clientId_weekOf_idx"');
    expect(baseline).toContain('"MealPlan_one_published_per_client_week"');
    expect(baseline).toContain('"TrainingProgram_one_published_per_client"');
    expect(baseline).toContain('"AiWorkoutSession_modality_check"');
    expect(baseline).not.toContain('CREATE TABLE "_prisma_migrations"');
  });

  it.each([
    "postgresql://example.com/steadfast_migration_replay_forbidden",
    "postgresql://127.0.0.1/steadfast_production",
  ])("rejects an unsafe replay target before database access: %s", (databaseUrl) => {
    const result = spawnSync("bash", [replayScriptPath], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/restricted to local PostgreSQL|must start with/);
  });
});
