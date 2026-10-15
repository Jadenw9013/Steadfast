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
 * decision). That leaves ambiguity windows — NOT "consentedAt set + mode !=
 * AI" (round 1 of this ticket shipped that predicate and it is false:
 * `PAUSE` sets mode "NONE" without touching `consentedAt`, and a later
 * human-coach reconciliation (lib/activation.ts's
 * `reconcileCoachingContextForClient`) can move the mode on to "HUMAN" —
 * neither touches a genuinely-consented row's `consentedAt`, so mode alone
 * cannot tell a real past consent from a stamp the two removed writers
 * left) and NOT simply "no receipt" either (round 2 shipped that and it is
 * ALSO false, for a different reason — see bucket 1 below). Three buckets,
 * each a claim this module can actually stand behind:
 *
 * 1. `stampedWithNoEnrollmentReceipt` — `consentedAt` set, no receipt at
 *    all, **and `consentedAt` is on or after `RECEIPT_ERA_START`**
 *    (2026-09-23, commit `3b9eb3e`, the day the receipt write landed —
 *    `20260922010000_ai_coach_governed_activation` is the migration that
 *    created the table one day earlier). Only from this date does every
 *    accepted non-synthetic `ENROLL` write exactly one receipt, so only
 *    from this date does "zero receipts" prove the stamp came from
 *    `confirmIntake` or the run-request fallback rather than consent.
 *    Before this date, `ENROLL` (since `f309f74`, 2026-09-14) wrote
 *    `consentedAt` with no receipt, no digest check and no
 *    synthetic/live-release distinction at all
 *    (`git show 3b9eb3e^:lib/ai-coach/client-commands.ts`) — a real,
 *    non-synthetic consent decision taken in that nine-day window looks
 *    byte-identical to a pre-fix confirm/run-request stamp. This bucket is
 *    the one that is knowable with certainty.
 *
 * 2. `preReceiptEraStampUnclassifiable` — `consentedAt` set, no receipt,
 *    **and `consentedAt` is before `RECEIPT_ERA_START`**. This is reported
 *    as exactly what it is: unclassifiable from this data alone, never as
 *    "never consented". Whether any of these rows are real consents taken
 *    during the pre-receipt window is a production-ledger question — this
 *    module does not answer it, and neither does the script that prints
 *    it. That ledger is Jaden's to pull, not this code's to assume either
 *    way.
 *
 * 3. `consentedAtPredatesEarliestReceipt` — a profile that DOES have at
 *    least one receipt, but whose `consentedAt` is earlier than that
 *    receipt's `createdAt` by more than `CLOCK_SKEW_TOLERANCE_MS`. Before
 *    S-21 round 2's fix, `ENROLL` preserved an already-set `consentedAt`
 *    (`?? new Date()`) across re-enrollment, and every row that enrolled
 *    while `confirmIntake` was still stamping (i.e. every pre-round-2
 *    enrollment) therefore carries the *confirm* timestamp rather than the
 *    real consent moment — `receipt.createdAt` *is* the real moment, and it
 *    is normally later (or equal, within clock noise). The tolerance exists
 *    because `consentedAt` is a Node `new Date()` and `receipt.createdAt` is
 *    Postgres's `CURRENT_TIMESTAMP` (the transaction's start time, migration
 *    `20260922010000`) — two different clocks. A one-second gap is three
 *    orders of magnitude larger than the in-transaction elapsed time
 *    between the two reads, so skew up to a second cannot flip a genuinely
 *    fresh, correct enrollment into this bucket.
 *
 * Synthetic (`isSynthetic: true`) profiles are excluded from all three
 * buckets: `ENROLL`'s fixture branch never writes a receipt — by design,
 * not by any defect this ticket fixes — so every synthetic consent would
 * otherwise misreport as ambiguous. Synthetic rows are never real clients.
 *
 * This is a reporting helper only — nothing on any request path calls it
 * (confirmed: no import of this module outside this file and its tests).
 * Run it via `pnpm ai-coach:consent-ambiguity`
 * (scripts/count-ambiguous-ai-consent.ts) — read-only, and the only
 * sanctioned way the production numbers are taken is Jaden running it
 * himself against production; see that script's header for why agents
 * never do this themselves.
 */
/**
 * Review r3 finding 1: this is the **commit** date of `3b9eb3e`, not the date production
 * ran it. Bucket 1's certainty assumes production served `3b9eb3e` from this date; if the
 * production deploy ledger says later, raise this constant to that date — a real consent
 * stamped in the gap would otherwise be reported as certainly-not-consent.
 */
export const RECEIPT_ERA_START = new Date("2026-09-23T00:00:00.000Z");

/** See the module docblock: an app-clock (`consentedAt`) vs DB-clock
 * (`receipt.createdAt`) comparison needs slack, or ordinary clock skew
 * misclassifies a correct, same-transaction enrollment. */
export const CLOCK_SKEW_TOLERANCE_MS = 1000;

export interface ConsentAmbiguityCounts {
  stampedWithNoEnrollmentReceipt: number;
  preReceiptEraStampUnclassifiable: number;
  consentedAtPredatesEarliestReceipt: number;
}

const EMPTY_COUNTS: ConsentAmbiguityCounts = {
  stampedWithNoEnrollmentReceipt: 0,
  preReceiptEraStampUnclassifiable: 0,
  consentedAtPredatesEarliestReceipt: 0,
};

export async function countConsentAmbiguity(
  client: PrismaClient | Prisma.TransactionClient
): Promise<ConsentAmbiguityCounts> {
  const consented = await client.aiCoachProfile.findMany({
    where: { consentedAt: { not: null }, isSynthetic: false },
    select: { clientId: true, consentedAt: true },
  });
  if (consented.length === 0) {
    return { ...EMPTY_COUNTS };
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
  let preReceiptEraStampUnclassifiable = 0;
  let consentedAtPredatesEarliestReceipt = 0;
  for (const row of consented) {
    const earliest = earliestByClient.get(row.clientId);
    if (!earliest) {
      if (row.consentedAt!.getTime() >= RECEIPT_ERA_START.getTime()) {
        stampedWithNoEnrollmentReceipt += 1;
      } else {
        preReceiptEraStampUnclassifiable += 1;
      }
    } else if (earliest.getTime() - row.consentedAt!.getTime() > CLOCK_SKEW_TOLERANCE_MS) {
      consentedAtPredatesEarliestReceipt += 1;
    }
  }
  return {
    stampedWithNoEnrollmentReceipt,
    preReceiptEraStampUnclassifiable,
    consentedAtPredatesEarliestReceipt,
  };
}
