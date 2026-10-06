/**
 * S-21 (MAJOR 4) — read-only. Prints the two S-21 consent-ambiguity counts
 * (`lib/ai-coach/consent-ambiguity.ts`'s `countConsentAmbiguity`) against
 * whatever `DATABASE_URL` points to. Never writes anything.
 *
 * SAFETY
 * ------
 * Mirrors `scripts/ai-coach-seed-fixtures.ts`'s guard even though this
 * script never writes a row: it still refuses to run when
 * `NODE_ENV === "production"` or `VERCEL_ENV` is set, and prints only the
 * target database's host, port and name (never a credential or the full
 * connection string) before querying, so the operator can see what they are
 * about to read before trusting the numbers.
 *
 * USAGE
 *   pnpm ai-coach:consent-ambiguity
 *
 * Point `DATABASE_URL` at a replayed/local test database, never Neon.
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"] });

import { db } from "../lib/db";
import { countConsentAmbiguity } from "../lib/ai-coach/consent-ambiguity";

function refuseOutsideDevelopment() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error(
      "ai-coach:consent-ambiguity must not run against a deployed environment. Refusing to run with " +
        `NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} VERCEL_ENV=${process.env.VERCEL_ENV ?? "<unset>"}. ` +
        "Point DATABASE_URL at a replayed/local test database and run this locally."
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
    "stampedWithNoEnrollmentReceipt: consentedAt is set but no AiCoachProviderTransitionReceipt " +
      "exists for that client — stamped by confirm or run-request with no enrolment receipt, never " +
      "by a consent decision."
  );
  console.log(
    "consentedAtPredatesEarliestReceipt: consentedAt is set and earlier than that client's " +
      "earliest enrolment receipt — a real consent, but the recorded timestamp is the pre-fix " +
      "confirm-intake stamp, not the actual consent moment (receipt.createdAt)."
  );
}

void main();
