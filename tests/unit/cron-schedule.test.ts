import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// T-503: pins the frozen vercel.json crons array and the ai-coach-executor
// segment config. This is the guard against the three-way T-503/T-664/T-998
// collision on vercel.json — a diff that adds/reorders/renames an entry
// without updating this test is the thing this file exists to catch.

const repoRoot = process.cwd();
const vercelJsonPath = join(repoRoot, "vercel.json");

const FROZEN_CRONS = [
  { path: "/api/cron/checkin-reminders", schedule: "0 19 * * *" },
  { path: "/api/cron/ai-coach-executor", schedule: "5 * * * *" },
  { path: "/api/cron/purge-deleted-accounts", schedule: "0 4 * * *" },
];

function readVercelJson(): { crons: Array<{ path: string; schedule: string }> } {
  const raw = readFileSync(vercelJsonPath, "utf8");
  return JSON.parse(raw);
}

describe("vercel.json cron schedule (T-503 frozen config)", () => {
  it("schedules exactly the three frozen entries, in order", () => {
    const config = readVercelJson();
    expect(config.crons).toEqual(FROZEN_CRONS);
  });

  it("has no duplicate path values", () => {
    const config = readVercelJson();
    const paths = config.crons.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("every scheduled path resolves to an existing route.ts on disk that exports GET", () => {
    const config = readVercelJson();
    for (const entry of config.crons) {
      const routePath = join(repoRoot, "app", ...entry.path.split("/").filter(Boolean), "route.ts");
      expect(existsSync(routePath), `${routePath} does not exist for cron path ${entry.path}`).toBe(
        true
      );
      const source = readFileSync(routePath, "utf8");
      expect(source, `${routePath} does not export GET`).toMatch(/export\s+(async\s+)?function\s+GET\b/);
    }
  });
});

describe("app/api/cron/ai-coach-executor route segment config (T-503 frozen)", () => {
  it("declares maxDuration = 180 and runtime = nodejs", async () => {
    const route = await import("@/app/api/cron/ai-coach-executor/route");
    expect(route.maxDuration).toBe(180);
    expect(route.runtime).toBe("nodejs");
  });
});
