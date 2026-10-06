import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

/**
 * S-21 — read-only. Before this ticket shipped, `AiCoachProfile.consentedAt`
 * was written by three paths, but only `ENROLL`
 * (lib/ai-coach/client-commands.ts) records an actual consent decision —
 * it verifies `consentTextDigest` against the live release's approved
 * disclosure text before writing (for a non-synthetic profile), and (as of
 * S-21 round 2) always writes an `AiCoachProviderTransitionReceipt` for that
 * decision. `confirmIntake` (lib/ai-coach/intake.ts) and the run-request
 * fallback (lib/ai-coach/run-command.ts) also stamped `consentedAt` with no
 * consent having occurred; both writes are removed by this ticket.
 *
 * Existing rows are left untouched (no backfill, no clearing — the lead's
 * decision). That leaves two distinct, *knowable* ambiguity windows — NOT
 * "consentedAt set + mode != AI" (round 1 of this ticket shipped that
 * predicate and it is false: `PAUSE` sets mode "NONE" without touching
 * `consentedAt`, and a later human-coach reconciliation
 * (lib/activation.ts's `reconcileCoachingContextForClient`) can move the
 * mode on to "HUMAN" — neither touches a genuinely-consented row's
 * `consentedAt`, so mode alone cannot tell a real past consent from a
 * stamp the two removed writers left):
 *
 * 1. `stampedWithNoEnrollmentReceipt` — a profile with `consentedAt` set but
 *    **no `AiCoachProviderTransitionReceipt` at all**. Every real consent
 *    decision (every accepted non-synthetic `ENROLL`) now writes exactly one
 *    of these receipts, unconditionally, so a row with a stamp and zero
 *    receipts was stamped by `confirmIntake` or the run-request fallback,
 *    never by consent. This is the side of the ambiguity that is knowable
 *    with certainty. (Synthetic (`isSynthetic: true`) profiles are excluded
 *    from both counts: `ENROLL`'s fixture branch never writes a receipt —
 *    by design, not by the defect this ticket fixes — so every synthetic
 *    consent would otherwise misreport as "no receipt". Synthetic rows are
 *    never real clients.)
 *
 * 2. `consentedAtPredatesEarliestReceipt` — a profile that DOES have at
 *    least one receipt, but whose `consentedAt` is earlier than that
 *    receipt's `createdAt`. Before S-21 round 2's fix, `ENROLL` preserved an
 *    already-set `consentedAt` (`?? new Date()`) across re-enrollment, and
 *    every row that enrolled while `confirmIntake` was still stamping
 *    (i.e. every pre-fix enrollment) therefore carries the *confirm*
 *    timestamp rather than the real consent moment — `receipt.createdAt`
 *    *is* the real moment, and it is always later. This half reports zero
 *    for `countAmbiguousConsentRows` under round 1's predicate (every such
 *    row has mode "AI"), which is exactly why that predicate understated
 *    the blast radius: it has real, consented clients in it.
 *
 * This is a reporting helper only — nothing on any request path calls it
 * (confirmed: no import of this module outside this file and its tests).
 * Run it against a replayed/local database via
 * `pnpm ai-coach:consent-ambiguity` (scripts/count-ambiguous-ai-consent.ts);
 * the production count is Jaden's to pull himself before the deploy that
 * ships this fix.
 */
export interface ConsentAmbiguityCounts {
  stampedWithNoEnrollmentReceipt: number;
  consentedAtPredatesEarliestReceipt: number;
}

export async function countConsentAmbiguity(
  client: PrismaClient | Prisma.TransactionClient
): Promise<ConsentAmbiguityCounts> {
  const consented = await client.aiCoachProfile.findMany({
    where: { consentedAt: { not: null }, isSynthetic: false },
    select: { clientId: true, consentedAt: true },
  });
  if (consented.length === 0) {
    return { stampedWithNoEnrollmentReceipt: 0, consentedAtPredatesEarliestReceipt: 0 };
  }
  const earliestReceipts = await client.aiCoachProviderTransitionReceipt.groupBy({
    by: ["clientId"],
    _min: { createdAt: true },
  });
  const earliestByClient = new Map<string, Date>(
    earliestReceipts
      .filter((row) => row._min.createdAt !== null)
      .map((row) => [row.clientId, row._min.createdAt as Date])
  );
  let stampedWithNoEnrollmentReceipt = 0;
  let consentedAtPredatesEarliestReceipt = 0;
  for (const row of consented) {
    const earliest = earliestByClient.get(row.clientId);
    if (!earliest) {
      stampedWithNoEnrollmentReceipt += 1;
    } else if (row.consentedAt! < earliest) {
      consentedAtPredatesEarliestReceipt += 1;
    }
  }
  return { stampedWithNoEnrollmentReceipt, consentedAtPredatesEarliestReceipt };
}
