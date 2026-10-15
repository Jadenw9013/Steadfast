/**
 * S-27 — publishes the synthetic AI Coach runtime artifact set (policy
 * bundle + food catalog + exercise catalog + evidence registry + escalation
 * templates) for local development, with a long, explicit expiry.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tests/helpers/ai-artifacts.ts`'s `publishFreshRuntimeFixtureArtifacts()`
 * already builds and publishes this exact set, but it is test-only and sets
 * `expiresAt` to one hour out. A developer who reuses that helper (or copies
 * its logic) to seed a local environment gets a working environment that
 * silently reverts to `resolveRunRuntimeBinding`'s unbound-snapshot degrade
 * an hour later — the exact bug this ticket investigates (a synthetic
 * account's run writes fine, then fails at drain with no visible cause).
 *
 * This script shares the actual builder
 * (`lib/ai-coach/artifacts/fixture-seed.ts`'s `publishRuntimeFixtureArtifactSet`)
 * with that test helper (CLAUDE.md rule 1 — one implementation, not two),
 * passing a long development expiry instead of the test helper's short one.
 * The test helper's own behavior is unchanged.
 *
 * SAFETY
 * ------
 * This writes rows. It:
 *   - refuses to run when `NODE_ENV === "production"` or `VERCEL_ENV` is set;
 *   - refuses to run without an explicit `--yes` confirmation flag;
 *   - prints the target database host/port/name (never the full connection
 *     string, never a credential) before writing, so the operator can see
 *     what they are about to write to.
 * It never reads, prints or echoes `.env*` files or any secret.
 *
 * USAGE
 *   pnpm ai-coach:seed-fixtures -- --yes
 *
 * Idempotent: every run publishes a new, monotonically increasing artifact
 * version (never mutates an existing row), so running it again only
 * extends how long a currently-effective fixture set exists locally — it
 * never fails because a prior run already seeded the environment.
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"] });

import { publishRuntimeFixtureArtifactSet } from "../lib/ai-coach/artifacts/fixture-seed";

// A decade out — long enough that no ordinary local dev session, however
// long-lived, will ever see it silently expire. Deliberately not "forever":
// `resolvedRuntimeArtifactSetSchema` and the publish path both still treat
// this as a normal, time-bounded artifact.
const DEV_SEED_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function refuseOutsideDevelopment() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error(
      "ai-coach:seed-fixtures is a local development tool. Refusing to run with " +
        `NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} VERCEL_ENV=${process.env.VERCEL_ENV ?? "<unset>"}. ` +
        "It writes synthetic AI Coach artifact rows and must never touch a deployed environment."
    );
  }
}

function requireConfirmation() {
  if (!process.argv.includes("--yes")) {
    throw new Error(
      "Refusing to write without explicit confirmation. Re-run with --yes once you have " +
        "confirmed the target database printed above is the one you intend to seed."
    );
  }
}

/** Prints only the host, port and database name — never credentials, never
 * the full connection string. */
function printTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set.");
  }
  let target: string;
  try {
    const url = new URL(raw);
    target = `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    target = "<unparseable DATABASE_URL>";
  }
  console.log(`Target database: ${target}`);
}

async function main() {
  refuseOutsideDevelopment();
  printTarget();
  requireConfirmation();

  const expiresAt = new Date(Date.now() + DEV_SEED_LIFETIME_MS);
  const published = await publishRuntimeFixtureArtifactSet({ expiresAt });

  console.log(`Published ${published.length} artifacts:`);
  for (const artifact of published) {
    console.log(
      JSON.stringify({
        kind: artifact.kind,
        artifactKey: artifact.artifactKey,
        version: artifact.version,
        effectiveAt: artifact.effectiveAt.toISOString(),
        expiresAt: artifact.expiresAt.toISOString(),
      })
    );
  }
  console.log(
    "Done. These artifacts back both the FIXTURE runtime binding and any " +
      "synthetic account's run composition until the expiry above."
  );
}

void main();
