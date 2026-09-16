-- T-661 — improve the CB03 message backfill before it ever reaches production.
--
-- 20260913200000_message_coach_scope attributes only coach-authored messages
-- (UPDATE "Message" SET "coachId" = "senderId" WHERE "senderId" != "clientId").
-- Every message a client ever wrote keeps coachId = NULL, and every coach-facing
-- reader filters on coachId (app/api/messages/route.ts:74,
-- app/api/coach/clients/[clientId]/messages/route.ts:48,73,
-- lib/queries/messages.ts:12, lib/queries/client-profile.ts:51). Applying that
-- alone permanently hides every client reply from every coach.
--
-- This migration attributes the subset that is unambiguous by evidence already
-- in the database. It names a coach only when ALL THREE of these hold, and the
-- result is a strict subset of what getClientProvider
-- (lib/queries/client-provider.ts:5-22) would name for the same client, never a
-- superset:
--
--   1. Exactly one "CoachClient" row exists for the client today.
--      getClientProvider's legacy branch (:11-15) treats that as the one
--      unambiguous relationship; 2+ rows are resolutionRequired and 0 rows name
--      nobody.
--   2. The client's "ClientCoachingContext" agrees, or does not exist at all.
--      getClientProvider reads the context FIRST (:7-10) and only falls back to
--      the CoachClient count when there is no context row, so the CoachClient
--      count alone is NOT the rule the application applies.
--      20260913260000_client_coaching_context inserts a context row for every
--      isClient user and sorts before this migration, so in production this is
--      the governing test. resolutionRequired is sticky
--      (reconcileCoachingContextForClient, lib/activation.ts:191-193, returns
--      early and never clears it) and mode can be 'AI' while a CoachClient row
--      still exists (lib/ai-coach/client-commands.ts:84 sets 'AI'; a later
--      assignment via app/actions/coach-client.ts:33,78 or
--      app/api/coach/clients/[clientId]/route.ts:128 hits that same early
--      return). In both states every application read refuses to name a coach
--      for a client who has exactly one CoachClient row, so this migration must
--      refuse too. The positive test below (mode = 'HUMAN', NOT
--      resolutionRequired, activeCoachClientId = that row) is exactly the state
--      in which getClientProvider returns a non-null coachId.
--   3. No other coach's conversation exists in the client's message history —
--      or, if one does, the surviving relationship provably started after it.
--      "CoachClient" rows are hard-deleted on disconnect, so today's row count
--      says nothing about who the client talked to last year. After
--      20260913200000's sender-based UPDATE has run, any "Message" row for this
--      client with coachId IS NOT NULL AND coachId <> the surviving coach is
--      durable proof a second coach's conversation existed. Without a clamp, a
--      client whose second coach's row was deleted, or who left and returned to
--      the same coach, would hand the surviving coach the client's half of the
--      other coach's thread, permanently. When that proof is present there are
--      exactly two topologies and they are NOT treated the same:
--
--        CLEAN SUCCESSOR — rowCreatedAt > lastOtherCoachAt. The surviving
--        relationship began after every trace of the other coach, so
--        createdAt >= rowCreatedAt is a real evidence-backed lower bound (it
--        strictly implies the > lastOtherCoachAt clamp, which is kept anyway as
--        a second guard). Attribute from rowCreatedAt forward — the same bound
--        the no-evidence case uses, so the CASE has two branches, not three.
--
--        PREDECESSOR SURVIVOR — rowCreatedAt <= lastOtherCoachAt. The surviving
--        coach's row predates the other coach's activity, so >= rowCreatedAt is
--        vacuous and the ONLY remaining guard would be > lastOtherCoachAt. That
--        guard cannot tell "the other coach is gone, the client is now writing
--        to the survivor" apart from "the other coach went quiet for a week and
--        the client is still replying into their thread": on every signal this
--        database holds (sender, the survivor's row date, the survivor's own
--        last message, the departed coach's last message) the two rows are
--        identical. Separating them needs an elapsed-time heuristic, which is a
--        guess, not evidence. So attribute NOTHING for these clients: startsAt
--        is NULL and every client-authored row stays coachId = NULL, visible
--        only in the client's own archive. Preview query Q6 reports this set
--        separately so the withheld volume is known before anything is applied.
--
-- Attribution is bounded to the period the relationship demonstrably existed, so
-- a successor coach cannot inherit the client's half of a predecessor's
-- conversation (CB03: "a provider switch does not authorize sharing prior
-- private messages"). The bound is EXACTLY CoachClient."createdAt" — which is
-- the same value getClientProvider returns as relationshipStartedAt
-- (lib/queries/client-provider.ts:20) and the same bound the application already
-- applies to a HUMAN coach's plan reads (lib/queries/current-client-plan.ts:17-18,
-- publishedAt: { gte: provider.relationshipStartedAt! }). The migration's time
-- bound and the app's own relationship-scoped read bound are one expression.
--
-- THERE IS NO WIDENING CLAUSE, AND ONE MUST NOT BE ADDED BACK. An earlier
-- revision of this file pulled startsAt back to LEAST(rowCreatedAt, this coach's
-- own earliest message to this client) whenever condition 3 found no other-coach
-- evidence, to protect a client whose CoachClient row was re-created. That is
-- unsound: "no surviving evidence of another coach" is NOT "no other coach was
-- there". Two ways the evidence is empty while a predecessor genuinely existed:
--   * ACCOUNT PURGE. purgeUserAccount deletes a departed coach's own Message
--     rows (lib/account-deletion/purge.ts:180) AND their CoachClient row (:183).
--     The client's own replies survive with coachId NULL and no trace of who
--     they were written to. The widening clause then reached back to the
--     surviving coach's earliest message and swept the departed coach's entire
--     era into the survivor's attribution, permanently.
--   * A PREDECESSOR WHO NEVER WROTE. Same emptiness, no purge required.
-- A senderId-based "no third party in the widened span" guard does not fix this.
-- After step 1 it detects strictly nothing the coachId test above misses (step 1
-- sets coachId = senderId for every row with senderId <> clientId), and neither
-- test survives a purge, which deletes the rows themselves.
-- The accepted cost: a client whose CoachClient row was re-created for the SAME
-- coach after a gap loses the pre-re-creation history to NULL. From what remains
-- in these tables that case is indistinguishable from erased coach churn, so it
-- is withheld. Preview Q3 sizes it before anything is applied.
--
-- Anything older than the bound, and anything at or before another coach's last
-- message, stays coachId = NULL and remains visible only in the client's own
-- archive (getAllMessages is never coach-filtered). Clients with 0 or 2+
-- CoachClient rows, an AI / resolutionRequired context, or the predecessor-
-- survivor topology in condition 3, stay NULL entirely.
-- NULL is recoverable by a later migration; a wrong non-NULL attribution is not.
--
-- Ordering is load-bearing and hard, not advisory: 20260913200000 must have run
-- (condition 3 reads the coachId it writes, and this migration only fills what
-- is still NULL) and 20260913260000 must have run (this file references
-- "ClientCoachingContext"; if that relation is missing the statement aborts
-- rather than silently skipping the check). prisma migrate deploy applies
-- migrations in filename order, which is exactly that order.
--
-- Idempotent: only rows with coachId IS NULL are ever written.

-- >>> T-661 BACKFILL — executed verbatim by tests/integration/message-coach-backfill.test.ts >>>
WITH sole_relationship AS (
  SELECT
    cc."clientId"       AS "clientId",
    MIN(cc."id")        AS "coachClientId",
    MIN(cc."coachId")   AS "coachId",
    MIN(cc."createdAt") AS "rowCreatedAt"
  FROM "CoachClient" cc
  GROUP BY cc."clientId"
  HAVING COUNT(*) = 1
),
unambiguous_relationship AS (
  SELECT sr.*
  FROM sole_relationship sr
  WHERE EXISTS (
          SELECT 1
            FROM "ClientCoachingContext" ctx
           WHERE ctx."clientId"            = sr."clientId"
             AND ctx."mode"                = 'HUMAN'::"CoachingMode"
             AND ctx."resolutionRequired"  = false
             AND ctx."activeCoachClientId" = sr."coachClientId"
        )
     OR NOT EXISTS (
          SELECT 1
            FROM "ClientCoachingContext" ctx
           WHERE ctx."clientId" = sr."clientId"
        )
),
other_coach_evidence AS (
  SELECT
    ur."clientId"      AS "clientId",
    MAX(m."createdAt") AS "lastOtherCoachAt"
  FROM unambiguous_relationship ur
  JOIN "Message" m
    ON m."clientId" = ur."clientId"
   AND m."coachId" IS NOT NULL
   AND m."coachId" <> ur."coachId"
  GROUP BY ur."clientId"
),
attribution_window AS (
  SELECT
    ur."clientId",
    ur."coachId",
    oce."lastOtherCoachAt",
    CASE
      -- No other coach in the history, or CLEAN SUCCESSOR (the surviving
      -- relationship provably began after the other coach's last trace; strict
      -- >, so a tie falls to the conservative branch below). Both bound at the
      -- relationship row date. There is no widening: see the header. Do not
      -- reintroduce LEAST(...) or any subquery over this coach's own messages.
      WHEN oce."lastOtherCoachAt" IS NULL
        OR ur."rowCreatedAt" > oce."lastOtherCoachAt" THEN ur."rowCreatedAt"
      -- PREDECESSOR SURVIVOR: no evidence-backed lower bound exists. NULL
      -- startsAt attributes nothing for this client (see condition 3 above).
      ELSE NULL
    END AS "startsAt"
  FROM unambiguous_relationship ur
  LEFT JOIN other_coach_evidence oce ON oce."clientId" = ur."clientId"
)
UPDATE "Message" m
SET "coachId" = aw."coachId"
FROM attribution_window aw
WHERE m."clientId"  = aw."clientId"
  AND m."coachId"   IS NULL
  AND aw."startsAt" IS NOT NULL
  AND m."createdAt" >= aw."startsAt"
  AND (aw."lastOtherCoachAt" IS NULL OR m."createdAt" > aw."lastOtherCoachAt");
-- <<< T-661 BACKFILL <<<
