import type { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * T-2060 — the recorded history of coach-client relationships.
 *
 * `CoachClient` rows are hard-deleted and unique per (coach, client), so the
 * row alone cannot say whether a client was ever coached by someone else in
 * between. Every create of a CoachClient row opens one `CoachClientEpisode` in
 * the SAME transaction, and every delete closes it in the SAME transaction.
 * The only writers of CoachClient are lib/activation.ts (open),
 * lib/coach-client/end-relationship.ts (close) and
 * lib/account-deletion/purge.ts (raw SQL close + anonymise);
 * tests/unit/coach-client-writers.test.ts pins that list.
 *
 * DB-only: no network I/O, always runs on the caller's `tx` (standing rule 5).
 * The only reader is lib/coach-client/plan-visibility.ts.
 */

type DbClient = typeof db | Prisma.TransactionClient;

export type CoachClientRowFacts = { id: string; coachId: string; clientId: string; createdAt: Date };

/** The explicit CoachClient select both writers use to obtain the row's facts. */
export const COACH_CLIENT_ROW_FACTS_SELECT = {
  id: true,
  coachId: true,
  clientId: true,
  createdAt: true,
} as const;

/**
 * Opens the LIVE episode for a CoachClient row that was just created in `tx`.
 * `startedAt` is copied from the row's own `createdAt`, never re-read or
 * re-stamped, so plan-visibility can match the episode to the provider's
 * `relationshipStartedAt` exactly.
 */
export async function openCoachClientEpisode(tx: DbClient, row: CoachClientRowFacts): Promise<void> {
  await tx.coachClientEpisode.create({
    data: {
      coachClientId: row.id,
      coachId: row.coachId,
      clientId: row.clientId,
      startedAt: row.createdAt,
      source: "LIVE",
    },
    select: { id: true },
  });
}

/**
 * Closes the open episode for a CoachClient row that was just deleted in `tx`.
 *
 * If no open episode exists (a row created by the pre-T-2060 code in the
 * migrate -> promote window, before scripts/sql/T-2060-episode-reconcile.sql
 * ran), the closed episode is created from the row's own facts with source
 * BACKFILL. Never throws for that 0-match case.
 */
export async function closeCoachClientEpisode(
  tx: DbClient,
  row: CoachClientRowFacts,
  endReason: "COACH_REMOVED" | "CLIENT_LEFT",
): Promise<void> {
  const endedAt = new Date();
  const closed = await tx.coachClientEpisode.updateMany({
    where: { coachClientId: row.id, endedAt: null },
    data: { endedAt, endReason },
  });
  if (closed.count > 0) return;
  await tx.coachClientEpisode.create({
    data: {
      coachClientId: row.id,
      coachId: row.coachId,
      clientId: row.clientId,
      startedAt: row.createdAt,
      endedAt,
      endReason,
      source: "BACKFILL",
    },
    select: { id: true },
  });
}
