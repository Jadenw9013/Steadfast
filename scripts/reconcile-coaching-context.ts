/**
 * T-2059 — deploy-time ClientCoachingContext reconciliation (audit
 * RELATIONSHIP-AUDIT-2026-10-15 D1). Replaces the raw §6 UPDATE.
 *
 * For every client with a CoachClient row or a ClientCoachingContext row,
 * classifies the context (lib/maintenance/coaching-context-drift.ts) and, with
 * --apply, repairs each drifted client in its own transaction by calling the
 * shared reconcileCoachingContextForClient. Never touches a CoachClient row,
 * never changes an AI context, never writes a client that is already
 * consistent (so a second --apply changes 0 rows).
 *
 * Output is counts and client ids only: no emails, no names.
 *
 * --apply first records, in <run-dir>/coaching-context-overlap-manifest.json,
 * every client it is about to move out of STALE_RESOLUTION and every client
 * with 2+ CoachClient rows (lib/maintenance/overlap-manifest.ts). The file is
 * cumulative across applies; reattribute-message-coach.ts requires it and
 * excludes those clients. Keep one run directory per deploy.
 *
 * USAGE (DATABASE_URL from the environment, never from a .env file)
 *   DATABASE_URL=... pnpm exec tsx scripts/reconcile-coaching-context.ts            # dry run (default)
 *   DATABASE_URL=... pnpm exec tsx scripts/reconcile-coaching-context.ts --apply --confirm-db=<host>/<db> --run-dir=<dir> --init-manifest   # FIRST apply of a deploy only
 *   DATABASE_URL=... pnpm exec tsx scripts/reconcile-coaching-context.ts --apply --confirm-db=<host>/<db> --run-dir=<dir>                   # every later apply
 * Without --init-manifest the manifest must already exist in <dir> for this
 * host/db; with it, <dir> must not hold one yet.
 * Read-only SQL twin for a pre-deploy check: scripts/sql/C2b-context-drift.sql
 *
 * Exit code: 0 when the final summary has no client in a blocking state
 * (NONE_BUT_COACHED, HUMAN_POINTER_NULL, STALE_RESOLUTION) and no client
 * failed; 1 otherwise; 2 on a refused or crashed run.
 */
import { parseMaintenanceArgs } from "../lib/maintenance/cli-target";
import {
  applyCoachingContextReconciliation,
  BLOCKING_STATES,
  DRIFT_STATES,
  OK_STATES,
  scanCoachingContextDrift,
  type ContextState,
  type DriftReport,
} from "../lib/maintenance/coaching-context-drift";
import { db } from "../lib/db";
import { recordOverlapClients } from "../lib/maintenance/overlap-manifest";

function printCounts(label: string, counts: Record<ContextState, number>) {
  console.log(`\n${label}`);
  for (const state of [...DRIFT_STATES, ...OK_STATES]) console.log(`  ${state.padEnd(24)} ${counts[state]}`);
}

function printTransitions(label: string, rows: Array<{ clientId: string; before: ContextState; after: ContextState }>) {
  console.log(`\n${label}`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.before} -> ${r.after}`;
    groups.set(key, [...(groups.get(key) ?? []), r.clientId]);
  }
  for (const [key, ids] of groups) {
    console.log(`  ${key}: ${ids.length}`);
    for (const id of ids) console.log(`    ${id}`);
  }
}

function predictedAfter(report: DriftReport): Record<ContextState, number> {
  const counts = { ...report.byState };
  for (const d of report.drifted) {
    counts[d.before] -= 1;
    counts[d.after] += 1;
  }
  return counts;
}

function printFinal(counts: Record<ContextState, number>, label: string): boolean {
  const blocking = BLOCKING_STATES.map((s) => `${s}=${counts[s]}`).join(" ");
  const remainingDrift = DRIFT_STATES.reduce((sum, s) => sum + counts[s], 0);
  const ok = BLOCKING_STATES.every((s) => counts[s] === 0) && remainingDrift === 0;
  console.log(`\nFINAL SUMMARY (${label})`);
  console.log(`  blocking states: ${blocking}`);
  console.log(`  remaining drift (all drift states): ${remainingDrift}`);
  console.log(`  ambiguous with cause (2+ CoachClient rows, left for a human): ${counts.AMBIGUOUS_WITH_CAUSE}`);
  console.log(`  AI contexts (never changed here): ${counts.AI_SKIPPED}`);
  console.log(`  RESULT: ${ok ? "OK, 0 clients in a blocking state" : "NOT OK, see counts above"}`);
  return ok;
}

async function main() {
  const { apply, target, confirmKey, values } = parseMaintenanceArgs(process.argv.slice(2), "reconcile-coaching-context", ["--run-dir"], ["--init-manifest"]);
  const initManifest = values["--init-manifest"] === "true";
  if (initManifest && !apply) throw new Error("--init-manifest only makes sense with --apply.");
  const runDir = values["--run-dir"];
  if (apply && !runDir) throw new Error("--apply needs --run-dir=<dir>: the overlap manifest for reattribute-message-coach.ts is written there.");
  console.log(`Target database: ${target}`);
  console.log(`Mode: ${apply ? "APPLY (one transaction per drifted client)" : "DRY RUN (read-only, nothing is written)"}`);

  const before = await scanCoachingContextDrift();
  console.log(`\nPopulation (clients with a CoachClient or context row): ${before.population}`);
  printCounts("BEFORE, clients per state", before.byState);
  if (before.aiWithCoachClient.length > 0) {
    console.log(`\nAI contexts that still have a CoachClient row (reported only, not changed): ${before.aiWithCoachClient.length}`);
    for (const id of before.aiWithCoachClient) console.log(`  ${id}`);
  }

  let ok: boolean;
  if (!apply) {
    printTransitions(`WOULD CHANGE (${before.drifted.length} clients, before -> after)`, before.drifted);
    const after = predictedAfter(before);
    printCounts("PREDICTED AFTER, clients per state", after);
    ok = printFinal(after, "predicted after --apply");
  } else {
    const overlap = [
      ...before.drifted.filter((d) => d.before === "STALE_RESOLUTION").map((d) => ({ clientId: d.clientId, reason: "STALE_RESOLUTION_CLEARED" as const })),
      ...before.multiRowClientIds.map((clientId) => ({ clientId, reason: "MULTIPLE_COACHCLIENT_ROWS" as const })),
    ];
    // Written BEFORE any context changes, so a crash mid-run still excludes them.
    const written = recordOverlapClients(runDir!, confirmKey, overlap, { init: initManifest });
    console.log(`\nOverlap manifest: ${written.file}`);
    console.log(`  ${written.manifest.clients.length} client(s) listed (${written.added} new this run). reattribute-message-coach.ts excludes them.`);

    const results = await applyCoachingContextReconciliation(
      before.drifted.map((d) => d.clientId),
      new Set(written.manifest.clients.filter((c) => c.reasons.includes("STALE_RESOLUTION_CLEARED")).map((c) => c.clientId))
    );
    const changed = results.flatMap((r) => (r.error === undefined && r.changed ? [r] : []));
    const failed = results.flatMap((r) => (r.error !== undefined ? [r] : []));
    printTransitions(`CHANGED (${changed.length} clients, before -> after)`, changed);
    const skipped = results.length - changed.length - failed.length;
    if (skipped > 0) console.log(`\n  ${skipped} client(s) were already consistent when locked and were not written.`);
    if (failed.length > 0) {
      console.log(`\nFAILED (${failed.length} clients, rolled back, safe to rerun)`);
      for (const f of failed) console.log(`  ${f.clientId}: ${f.error}`);
    }
    const after = await scanCoachingContextDrift();
    printCounts("AFTER (re-read from the database), clients per state", after.byState);
    ok = printFinal(after.byState, "re-read after apply") && failed.length === 0;
    if (failed.length > 0) console.log(`  RESULT: NOT OK, ${failed.length} client(s) failed`);
  }
  await db.$disconnect();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 2;
});
