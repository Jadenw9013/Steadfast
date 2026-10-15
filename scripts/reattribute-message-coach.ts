/**
 * T-2059 — deploy-time Message.coachId re-attribution (audit
 * RELATIONSHIP-AUDIT-2026-10-15 D3). Replaces the two raw §6 statements.
 *
 * Runs, in one transaction, exactly:
 *   1. UPDATE "Message" SET "coachId" = "senderId" WHERE "coachId" IS NULL AND "senderId" <> "clientId"
 *   2. the T-661 DML body of 20260915000000_message_coach_backfill_single_coach,
 *      read from the migration file and pinned by sha256 to the repo baseline
 *      manifest AND to _prisma_migrations.checksum on the target.
 * Both only ever fill NULL rows, so the script is idempotent. Step 2 never
 * names a coach for a client who has had more than one (see the migration
 * header).
 *
 * REQUIRED: --manifest=<run-dir>/coaching-context-overlap-manifest.json, written
 * by `reconcile-coaching-context.ts --apply` for the same host/db. Every client
 * listed there, and every single-coach client with evidence of another coach
 * that could overlap the surviving relationship, is excluded from both steps;
 * their NULL rows stay NULL and are reported as excluded.
 *
 * Refuses while any ClientCoachingContext drift remains (step 2 reads it).
 *
 * ONE-SHOT: --apply stamps the manifest after it commits and refuses a second
 * --apply against a stamped manifest. After the apply the only NULL rows left
 * are excluded or unattributable, so a rerun can only do harm. Dry runs stay
 * allowed for verification.
 *
 * Dry run (default) executes both statements inside a transaction that is
 * always rolled back, so the counts are exactly what --apply would write and
 * nothing is committed. Output is counts only.
 *
 * USAGE (DATABASE_URL from the environment, never from a .env file)
 *   DATABASE_URL=... pnpm exec tsx scripts/reattribute-message-coach.ts --manifest=<file>
 *   DATABASE_URL=... pnpm exec tsx scripts/reattribute-message-coach.ts --manifest=<file> --apply --confirm-db=<host>/<db>
 */
import { parseMaintenanceArgs } from "../lib/maintenance/cli-target";
import { DRIFT_STATES, scanCoachingContextDrift } from "../lib/maintenance/coaching-context-drift";
import { markD3Applied, readOverlapManifest } from "../lib/maintenance/overlap-manifest";
import { reattributeMessageCoach } from "../lib/maintenance/message-coach-reattribution";
import { db } from "../lib/db";

async function main() {
  const { apply, target, confirmKey, values } = parseMaintenanceArgs(process.argv.slice(2), "reattribute-message-coach", ["--manifest"]);
  console.log(`Target database: ${target}`);
  console.log(`Mode: ${apply ? "APPLY (one transaction)" : "DRY RUN (runs inside a transaction that is rolled back)"}`);
  const manifestFile = values["--manifest"];
  if (!manifestFile) {
    throw new Error("--manifest=<run-dir>/coaching-context-overlap-manifest.json is required (written by reconcile-coaching-context.ts --apply).");
  }
  const manifest = readOverlapManifest(manifestFile, confirmKey);
  console.log(`Overlap manifest: ${manifestFile} (${manifest.clients.length} clients, updated ${manifest.updatedAt})`);
  if (manifest.d3AppliedAt) {
    console.log(`D3 --apply already ran against this manifest at ${manifest.d3AppliedAt}.`);
    if (apply) throw new Error("D3 --apply is one-shot per deploy and has already run; refusing. Dry runs remain allowed.");
  }

  const drift = await scanCoachingContextDrift();
  const driftCount = DRIFT_STATES.reduce((sum, s) => sum + drift.byState[s], 0);
  console.log(`\nClientCoachingContext drift remaining: ${driftCount}`);
  if (driftCount > 0) {
    console.log("  Step 2 depends on correct contexts. Run scripts/reconcile-coaching-context.ts --apply first.");
    await db.$disconnect();
    process.exitCode = 1;
    return;
  }

  const result = await reattributeMessageCoach({ apply, manifestClientIds: manifest.clients.map((c) => c.clientId) });
  const verb = apply ? "UPDATED" : "WOULD UPDATE";
  console.log(`\nEXCLUDED CLIENTS (both steps skipped)`);
  console.log(`  overlap manifest:                                      ${result.excludedManifestClients}`);
  console.log(`  other-coach evidence overlapping the surviving row:    ${result.excludedEvidenceClients}`);
  console.log(`\n${verb}`);
  console.log(`  step 1, coach-sent rows (coachId = senderId):          ${result.senderAttributed}`);
  console.log(`  step 2, single-coach rows (T-661 backfill, pinned):    ${result.singleCoachAttributed}`);
  console.log(`  total:                                                 ${result.senderAttributed + result.singleCoachAttributed}`);
  const u = result.unattributed;
  console.log(`\nCOULD NOT ATTRIBUTE (coachId stays NULL, ${apply ? "after apply" : "after a would-be apply"}): ${u.totalNullCoachId}`);
  console.log(`  excluded: overlap risk (manifest):                     ${u.excludedOverlapRisk}`);
  console.log(`  excluded: other-coach evidence:                        ${u.excludedOtherCoachEvidence}`);
  console.log(`  client has no CoachClient row:                         ${u.clientHasNoCoachClient}`);
  console.log(`  client has 2+ CoachClient rows:                        ${u.clientHasMultipleCoachClients}`);
  console.log(`  one CoachClient row, context does not name it:         ${u.singleCoachContextDisagrees}`);
  console.log(`  one CoachClient row, message predates the row:         ${u.singleCoachBeforeRelationshipRow}`);
  console.log(`  one CoachClient row, another coach interleaved:        ${u.singleCoachOtherCoachInterleaved}`);
  console.log("  (these stay visible in the client's own archive only; NULL is recoverable, a wrong coach is not)");
  if (apply) {
    const stamped = markD3Applied(manifestFile, confirmKey);
    console.log(`\nManifest stamped d3AppliedAt=${stamped.d3AppliedAt}; a second --apply will be refused.`);
  }
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 2;
});
