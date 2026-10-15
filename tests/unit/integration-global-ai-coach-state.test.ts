/**
 * T-2014 conformance gate.
 *
 * The cross-file lock in `tests/helpers/global-ai-coach-state.ts` only removes
 * the ordering-dependent failures if every file that touches database-wide AI
 * Coach state declares how it uses it. A file that forgets reintroduces exactly
 * the flake the ticket was filed for — and reintroduces it *silently*, because
 * the symptom only shows up under one interleaving on one machine.
 *
 * So the required set and the required mode are derived here from the test
 * sources themselves, not from a hand-maintained list that goes stale. A new
 * integration file that activates a release, wipes an AI Coach table or asserts
 * a table-wide count fails this unit test until it declares a mode.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INTEGRATION_DIR = path.join(process.cwd(), "tests", "integration");
const HELPER_PATH = path.join(process.cwd(), "tests", "helpers", "global-ai-coach-state.ts");

/**
 * A file participates in the shared AI Coach state if it is one of the AI Coach
 * integration files, or if it writes one of the tables whose rows an exclusive
 * file wipes or counts table-wide.
 */
const PARTICIPATES =
  /aiCoachReviewerGrant|aiCoachGovernanceGrant|aiCoachOperationalControl|aiCoachLiveActivation|aiPlanReviewerApproval|assignFixtureReviewer|createTestGovernanceActor|activateTestLiveRelease/;

/**
 * A file needs the state to itself if it
 *   - wipes or counts an AI Coach table with no `where` (which reaches other
 *     files' rows), or
 *   - occupies the single `AiCoachLiveActivation` row with `state = 'ACTIVE'`, or
 *   - drives one of the database-wide sweeps. `runExecutorSweep`,
 *     `reconcileExpiredRuns` and `drainAcceptanceNotifications` take no client
 *     or id filter: they claim and mutate whatever due rows exist anywhere,
 *     which both consumes another file's queued work and makes the sweep's own
 *     `claimed`/`requeued` counters depend on what else is running.
 */
const NEEDS_EXCLUSIVE: RegExp[] = [
  /\bdb\.(?:aiCoach|aiPlan|aiAutomatic|aiAutonomy)\w*\.(?:deleteMany|count|findMany)\(\)/,
  /activateTestLiveRelease|activateAiCoachLiveRelease/,
  /db\.aiCoachLiveActivation\.create/,
  /runExecutorSweep|reconcileExpiredRuns|drainAcceptanceNotifications/,
];

const DECLARATION = /lockGlobalAiCoachState\("(exclusive|shared)"\)/g;

type IntegrationFile = { name: string; source: string };

function readIntegrationFiles(): IntegrationFile[] {
  return fs
    .readdirSync(INTEGRATION_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => ({
      name,
      source: fs.readFileSync(path.join(INTEGRATION_DIR, name), "utf8"),
    }));
}

function requiredMode(file: IntegrationFile): "exclusive" | "shared" | null {
  const participates = file.name.startsWith("ai-coach-") || PARTICIPATES.test(file.source);
  if (!participates) return null;
  return NEEDS_EXCLUSIVE.some((pattern) => pattern.test(file.source)) ? "exclusive" : "shared";
}

function declaredModes(file: IntegrationFile): string[] {
  return [...file.source.matchAll(DECLARATION)].map((match) => match[1]);
}

describe("T-2014 — integration files declare how they use global AI Coach state", () => {
  const files = readIntegrationFiles();

  it("finds the integration suite (guards against the scan silently matching nothing)", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.filter((file) => requiredMode(file) !== null).length).toBeGreaterThan(20);
  });

  it("every participating file declares a mode exactly once", () => {
    const offenders = files
      .filter((file) => requiredMode(file) !== null)
      .filter((file) => declaredModes(file).length !== 1)
      .map((file) => `${file.name} (declared ${declaredModes(file).length} times, expected 1)`);
    expect(offenders).toEqual([]);
  });

  it("a file that wipes, table-wide-counts or activates declares exclusive", () => {
    const offenders = files
      .map((file) => ({ file, required: requiredMode(file), declared: declaredModes(file)[0] }))
      .filter((entry) => entry.required !== null && entry.declared !== entry.required)
      .map((entry) => `${entry.file.name}: declared ${entry.declared}, requires ${entry.required}`);
    expect(offenders).toEqual([]);
  });

  it("a file that declares a mode is one the rules actually cover", () => {
    // The reverse direction: a stray declaration on a file the rules do not
    // classify would hold the lock for no stated reason and slow the suite.
    const offenders = files
      .filter((file) => declaredModes(file).length > 0 && requiredMode(file) === null)
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("the lock name collides with no advisory-lock key production takes", () => {
    // Production takes its own advisory locks inside its own transactions. If
    // the test lock reused one of those keys, a test session holding it would
    // block the production transaction until the hook timeout instead of
    // serialising files — a hang, not an isolation fix.
    const helper = fs.readFileSync(HELPER_PATH, "utf8");
    const testKey = /const LOCK_NAME = "([^"]+)"/.exec(helper)?.[1];
    expect(testKey).toBe("steadfast.tests.ai_coach_global_state");

    const productionKeys = new Set<string>();
    const libDir = path.join(process.cwd(), "lib");
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          for (const match of fs
            .readFileSync(full, "utf8")
            .matchAll(/pg_advisory(?:_xact)?_lock(?:_shared)?\(hashtext\('([^']+)'\)\)/g)) {
            productionKeys.add(match[1]);
          }
        }
      }
    };
    walk(libDir);
    expect(productionKeys.size).toBeGreaterThan(0);
    expect([...productionKeys]).not.toContain(testKey);
  });

  it("the helper orders access without deleting rows or relaxing assertions", () => {
    // The whole point of choosing a lock over "clean up harder" is that a real
    // conflict still fails loudly. A helper that started deleting rows would
    // make the suite stop noticing collisions, which is worse than the flake.
    const helper = fs.readFileSync(HELPER_PATH, "utf8");
    expect(helper).not.toMatch(/\bdeleteMany\b|\bDELETE FROM\b|\bTRUNCATE\b/);
  });
});
