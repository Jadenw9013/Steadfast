/**
 * S-21 (MAJOR 4, MINOR 4) — read-only. Prints the three S-21
 * consent-ambiguity counts (`lib/ai-coach/consent-ambiguity.ts`'s
 * `countConsentAmbiguity`) against whatever `DATABASE_URL` points to. Issues
 * only `SELECT`s, never writes a row.
 *
 * SAFETY
 * ------
 * Mirrors `scripts/ai-coach-seed-fixtures.ts`'s guard: it refuses to run
 * when `NODE_ENV === "production"` or `VERCEL_ENV` is set (an agent's or
 * CI's environment, never a human operator's own Mac), and prints only the
 * target database's host, port and name (never a credential or the full
 * connection string) before querying, so the operator can see what they are
 * about to read before trusting the numbers.
 *
 * Agents (and this script, run by one) must never point this at Neon/
 * production — every `SECURITY_INTEGRATION=1` run and every ad hoc
 * invocation an agent makes is against a disposable `steadfast_migration_
 * replay_*` database it creates and drops itself, same as every other gate
 * in this repo. The one exception is Jaden: the production counts this
 * ticket's ambiguity windows describe are his to pull, and running this
 * script by hand against production — two read-only `SELECT`s, nothing
 * else — is the sanctioned way to take them. Nobody else runs this against
 * Neon, and this script does not know or enforce which human is typing the
 * command; that boundary is a standing rule (steadfast-hq CLAUDE.md), not a
 * runtime check this file can make.
 *
 * USAGE
 *   pnpm ai-coach:consent-ambiguity
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"] });

import { db } from "../lib/db";
import { countConsentAmbiguity } from "../lib/ai-coach/consent-ambiguity";

function refuseOutsideDevelopment() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error(
      "ai-coach:consent-ambiguity must not run inside a deployed process. Refusing to run with " +
        `NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} VERCEL_ENV=${process.env.VERCEL_ENV ?? "<unset>"}. ` +
        "Run this from a local machine (an agent's replayed test database, or Jaden's own Mac if the " +
        "production numbers are wanted)."
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

  const counts = await countConsentAmbiguity(db);
  console.log(JSON.stringify(counts, null, 2));
  console.log(
    "stampedWithNoEnrollmentReceipt: consentedAt is set, on or after 2026-09-23 (the day the " +
      "enrolment receipt write landed, commit 3b9eb3e), and no AiCoachProviderTransitionReceipt " +
      "exists for that client — stamped by confirm or run-request with no enrolment receipt, never " +
      "by a consent decision."
  );
  console.log(
    "preReceiptEraStampUnclassifiable: consentedAt is set, before 2026-09-23, and no receipt " +
      "exists for that client — unclassifiable from this data alone. ENROLL wrote consentedAt with " +
      "no receipt, no digest check and no synthetic distinction before that date, so a real consent " +
      "taken then looks identical to a pre-fix stamp. This is NOT reported as \"never consented\"."
  );
  console.log(
    "consentedAtPredatesEarliestReceipt: consentedAt is set, a receipt exists, but consentedAt is " +
      "more than one second earlier than that client's earliest receipt — a real consent, but the " +
      "recorded timestamp is the pre-round-2-fix confirm-intake stamp, not the actual consent moment " +
      "(receipt.createdAt)."
  );
}

void main();
