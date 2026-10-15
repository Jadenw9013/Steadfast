import { db } from "@/lib/db";
import { reconcileCoachingContextForClient } from "@/lib/activation";

/**
 * T-2059 (audit RELATIONSHIP-AUDIT-2026-10-15 D1) — deploy-time
 * reconciliation of `ClientCoachingContext` against the client's actual
 * `CoachClient` rows.
 *
 * The deployed `main` never read or wrote `ClientCoachingContext`, so every
 * CoachClient create or delete since the A01 backfill left the context stale.
 * The release candidate makes that table the only authority on a client's
 * coach. This module classifies every client that has a CoachClient row or a
 * context row, and repairs the drifted ones by calling the shared
 * `reconcileCoachingContextForClient` (one transaction per client). It never
 * creates, edits or deletes a CoachClient row and never changes an AI context.
 *
 * `scripts/sql/C2b-context-drift.sql` is the read-only SQL twin of
 * `classifyCoachingContext`; the integration test pins the two together.
 */

export const DRIFT_STATES = [
  "MISSING_CONTEXT",
  "NONE_BUT_COACHED",
  "HUMAN_POINTER_NULL",
  "HUMAN_POINTER_MISMATCH",
  "NONE_WITH_POINTER",
  "STALE_RESOLUTION",
] as const;
export const OK_STATES = ["HUMAN_OK", "NONE_OK", "AMBIGUOUS_WITH_CAUSE", "AI_SKIPPED"] as const;
export type DriftState = (typeof DRIFT_STATES)[number];
export type ContextState = DriftState | (typeof OK_STATES)[number];

/** The three states the release must never ship with (task acceptance). */
export const BLOCKING_STATES: readonly DriftState[] = ["NONE_BUT_COACHED", "HUMAN_POINTER_NULL", "STALE_RESOLUTION"];

export type ContextSnapshot = {
  mode: "NONE" | "HUMAN" | "AI";
  activeCoachClientId: string | null;
  resolutionRequired: boolean;
} | null;

/**
 * Pure classifier. `coachClientIds` are the client's own CoachClient row ids.
 * Mirrors what `reconcileCoachingContextForClient(..., { clearStaleResolution: true })`
 * would leave untouched (the OK states) versus rewrite (the drift states).
 */
export function classifyCoachingContext(context: ContextSnapshot, coachClientIds: readonly string[]): ContextState {
  const n = coachClientIds.length;
  if (!context) return "MISSING_CONTEXT";
  if (context.mode === "AI") return "AI_SKIPPED";
  if (context.resolutionRequired) return n > 1 ? "AMBIGUOUS_WITH_CAUSE" : "STALE_RESOLUTION";
  if (context.mode === "NONE") {
    if (n > 0) return "NONE_BUT_COACHED";
    return context.activeCoachClientId === null ? "NONE_OK" : "NONE_WITH_POINTER";
  }
  // HUMAN, not flagged.
  if (context.activeCoachClientId === null) return "HUMAN_POINTER_NULL";
  return n === 1 && context.activeCoachClientId === coachClientIds[0] ? "HUMAN_OK" : "HUMAN_POINTER_MISMATCH";
}

export function isDrift(state: ContextState): state is DriftState {
  return (DRIFT_STATES as readonly string[]).includes(state);
}

/** What the shared reconcile leaves behind for a drifted client. */
export function predictAfterState(state: ContextState, coachClientCount: number): ContextState {
  if (!isDrift(state)) return state;
  if (coachClientCount === 0) return "NONE_OK";
  if (coachClientCount === 1) return "HUMAN_OK";
  return "AMBIGUOUS_WITH_CAUSE";
}

type Snapshot = Map<string, { context: ContextSnapshot; coachClientIds: string[] }>;

async function loadSnapshot(): Promise<Snapshot> {
  const [contexts, relationships] = await Promise.all([
    db.clientCoachingContext.findMany({ select: { clientId: true, mode: true, activeCoachClientId: true, resolutionRequired: true } }),
    db.coachClient.findMany({ select: { id: true, clientId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const snapshot: Snapshot = new Map();
  for (const ctx of contexts) {
    snapshot.set(ctx.clientId, {
      context: { mode: ctx.mode, activeCoachClientId: ctx.activeCoachClientId, resolutionRequired: ctx.resolutionRequired },
      coachClientIds: [],
    });
  }
  for (const rel of relationships) {
    const entry = snapshot.get(rel.clientId) ?? { context: null, coachClientIds: [] };
    entry.coachClientIds.push(rel.id);
    snapshot.set(rel.clientId, entry);
  }
  return snapshot;
}

export type ClientDrift = { clientId: string; before: ContextState; after: ContextState; coachClientCount: number };

export type DriftReport = {
  population: number;
  byState: Record<ContextState, number>;
  drifted: ClientDrift[];
  aiWithCoachClient: string[];
  /** Clients with 2+ CoachClient rows right now (overlap manifest input). */
  multiRowClientIds: string[];
};

function emptyCounts(): Record<ContextState, number> {
  return Object.fromEntries([...DRIFT_STATES, ...OK_STATES].map((s) => [s, 0])) as Record<ContextState, number>;
}

/** Read-only. Classifies every client with a CoachClient row or a context row. */
export async function scanCoachingContextDrift(): Promise<DriftReport> {
  const snapshot = await loadSnapshot();
  const byState = emptyCounts();
  const drifted: ClientDrift[] = [];
  const aiWithCoachClient: string[] = [];
  const multiRowClientIds: string[] = [];
  for (const [clientId, { context, coachClientIds }] of [...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const before = classifyCoachingContext(context, coachClientIds);
    byState[before] += 1;
    if (before === "AI_SKIPPED" && coachClientIds.length > 0) aiWithCoachClient.push(clientId);
    if (coachClientIds.length > 1) multiRowClientIds.push(clientId);
    if (isDrift(before)) {
      drifted.push({ clientId, before, after: predictAfterState(before, coachClientIds.length), coachClientCount: coachClientIds.length });
    }
  }
  return { population: snapshot.size, byState, drifted, aiWithCoachClient, multiRowClientIds };
}

export type ApplyResult =
  | { clientId: string; before: ContextState; after: ContextState; changed: boolean; error?: undefined }
  | { clientId: string; error: string; changed: false };

/**
 * Repairs every drifted client, one transaction each. Inside the transaction
 * the client's `User` row is locked (the same lock invite acceptance takes,
 * lib/activation.ts), the state is re-read and re-classified, and the shared
 * reconcile runs only if it is still drifted — so a consistent client is
 * never written and a second run changes nothing.
 *
 * A failure (lock timeout, deadlock abort, constraint) is caught per client:
 * that client's transaction rolls back, the run continues, and the failure is
 * returned so the CLI can list it and exit non-zero (review r1 finding 5).
 *
 * A client is only moved out of STALE_RESOLUTION if it is in
 * `staleClearAllowed` (already written to the overlap manifest), so a flag that
 * appears between the scan and the lock is never cleared unrecorded.
 */
export async function applyCoachingContextReconciliation(
  clientIds: readonly string[],
  /** Clients already recorded in the overlap manifest; only these may leave STALE_RESOLUTION. */
  staleClearAllowed: ReadonlySet<string>
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const clientId of clientIds) {
    try {
      const result = await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
          const read = async () => {
            const [ctx, rels] = await Promise.all([
              tx.clientCoachingContext.findUnique({ where: { clientId }, select: { mode: true, activeCoachClientId: true, resolutionRequired: true } }),
              tx.coachClient.findMany({ where: { clientId }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
            ]);
            return classifyCoachingContext(ctx, rels.map((r) => r.id));
          };
          const before = await read();
          if (!isDrift(before)) return { clientId, before, after: before, changed: false };
          if (before === "STALE_RESOLUTION" && !staleClearAllowed.has(clientId)) {
            throw new Error("became STALE_RESOLUTION after the scan and is not in the overlap manifest; rerun to record it first");
          }
          await reconcileCoachingContextForClient(tx, clientId, { clearStaleResolution: true });
          return { clientId, before, after: await read(), changed: true };
        },
        { maxWait: 10_000, timeout: 20_000 }
      );
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : String(error);
      results.push({ clientId, error: message, changed: false });
    }
  }
  return results;
}
