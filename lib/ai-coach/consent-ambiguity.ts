import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

/**
 * S-21 — read-only. Before this ticket shipped, `AiCoachProfile.consentedAt`
 * was written by three paths, but only `ENROLL`
 * (lib/ai-coach/client-commands.ts) records an actual consent decision —
 * it verifies `consentTextDigest` against the live release's approved
 * disclosure text before writing. `confirmIntake` (lib/ai-coach/intake.ts)
 * and the run-request fallback (lib/ai-coach/run-command.ts) also stamped
 * `consentedAt` with no consent having occurred; both writes are removed by
 * this ticket.
 *
 * Existing rows are left untouched (no backfill, no clearing — the lead's
 * decision). That leaves an ambiguity window: a row with `consentedAt` set
 * before this fix shipped, whose `ClientCoachingContext.mode` is not "AI",
 * was stamped by one of the two removed writers, not by consent. (Only
 * `ENROLL` ever sets `mode: "AI"`, and it always sets `consentedAt` in the
 * same transaction, so a genuinely-consented row always has mode "AI" by
 * the time it has a `consentedAt`.) A row with `consentedAt` set AND mode
 * "AI" is ambiguous between "consented via ENROLL" (real) and "mode reached
 * AI after a pre-fix stamp, deploy order permitting" — it cannot be told
 * apart after the fact, which is exactly why no backfill/clear was
 * attempted; this counter reports the side of the ambiguity that is
 * knowable: definitely-not-consent.
 *
 * This is a reporting helper only — nothing gates on its result. Run it
 * against a replayed/local database; the production count is Jaden's to
 * pull himself before the deploy that ships this fix.
 */
export async function countAmbiguousConsentRows(
  client: PrismaClient | Prisma.TransactionClient
): Promise<number> {
  return client.aiCoachProfile.count({
    where: {
      consentedAt: { not: null },
      OR: [{ client: { coachingContext: null } }, { client: { coachingContext: { mode: { not: "AI" } } } }],
    },
  });
}
