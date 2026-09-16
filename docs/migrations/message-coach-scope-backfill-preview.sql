-- T-661 — READ ONLY preview for the CB03 message-coach backfill.
--
-- READ ONLY. This file contains no UPDATE, INSERT, DELETE or DDL, and the whole
-- script runs inside BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK; so it
-- cannot mutate anything even by accident.
--
-- Run it on a NEON BRANCH of production, never on the production database
-- itself, and never as part of a deploy.
--
-- NEVER RUN THE MIGRATION FROM THIS FILE. The migrations are
-- prisma/migrations/20260913200000_message_coach_scope/migration.sql,
-- prisma/migrations/20260913260000_client_coaching_context/migration.sql and
-- prisma/migrations/20260915000000_message_coach_backfill_single_coach/migration.sql,
-- applied as an ordered triple by `prisma migrate deploy` only. This file exists
-- solely to size the effect before that human step (T-302 rehearsal packet).
--
-- It is written against the PRE-migration production schema, where "Message"
-- has no "coachId" column yet and "ClientCoachingContext" does not exist, so the
-- at-risk set — the rows that 20260913200000 would leave NULL — is reconstructed
-- as "senderId" = "clientId" (client-authored).
--
-- FOUR DELIBERATE DIVERGENCES from the shipped migration. The first two make
-- this preview an UPPER BOUND on what the migration will attribute: it can
-- over-estimate the gain and under-estimate the remainder, never the other way
-- round, which is the safe direction for a go/no-go. The last two are diagnostic
-- columns outside the startsAt CASE and affect no count that drives the go/no-go.
--
--   1. Condition 3 of the migration (m."coachId" IS NOT NULL AND m."coachId" <>
--      the sole coach) is reconstructed here as m."senderId" <> m."clientId" AND
--      m."senderId" <> the sole coach. On a pre-migration dataset this is
--      EXACTLY equivalent: 20260913200000 sets coachId = senderId for every row
--      where senderId <> clientId and leaves the rest NULL, and nothing else has
--      written the column yet. senderId is the only discriminator available
--      before the column exists.
--   2. Condition 2 of the migration (the "ClientCoachingContext" test) is
--      OMITTED from Q1-Q6, because that table does not exist on a raw production
--      branch and referencing a missing relation aborts the whole read-only
--      transaction. Q7 is an appendix that covers it, to be run only on a
--      rehearsal branch that already has 20260913260000 applied. Pre-migration
--      the two rules coincide anyway: 20260913260000's insert derives
--      resolutionRequired purely from COUNT(*) > 1 (which Q2 already buckets)
--      and mode = 'AI' cannot exist before the AI tables are created in the same
--      batch.
--   3. The shared CTE block carries one extra column, topology
--      ('clean' / 'successor' / 'predecessor'), which the migration does not
--      have. It is DIAGNOSTIC ONLY: it restates the startsAt CASE branch that
--      was already taken and never changes which rows any query counts. It
--      exists so Q6 can report the predecessor-survivor set separately, which is
--      the only set whose treatment changed in amendment 2. After amendment 3
--      'clean' and 'successor' produce the SAME startsAt; the two values are
--      kept apart only because they tell the reader whether other-coach evidence
--      exists at all. The startsAt CASE itself stays byte-equivalent to the
--      migration's.
--   4. (amendment 3) The shared CTE block carries a second extra column,
--      coachFirstMessageAt (MIN("createdAt") of the sole coach's own messages to
--      that client), which the migration does NOT have — the migration's
--      correlated subquery was deleted along with the widening clause. It feeds
--      exactly one Q3 column, stays_null_inside_own_coach_history, which sizes
--      what the deleted widening clause used to recover, so amendment 3's cost is
--      measurable before anything is applied. It sits outside the startsAt CASE
--      and changes no other count. IT MUST NEVER BE WIRED BACK INTO startsAt —
--      not here and not in the migration. See "THERE IS NO WIDENING CLAUSE" in
--      the migration header.
--
-- Q3, Q4 and Q6 each carry the same three-CTE block verbatim so that every query
-- is independently runnable; Q7 carries sole_relationship only.
--
-- Output is pasted into the T-302 packet: never select u.email or any other
-- contact detail, only firstName/lastName.

BEGIN;
SET TRANSACTION READ ONLY;

-- Q1 scale
SELECT COUNT(*) AS total_messages,
       COUNT(*) FILTER (WHERE "senderId" <> "clientId") AS attributed_by_20260913200000,
       COUNT(*) FILTER (WHERE "senderId"  = "clientId") AS client_authored_at_risk,
       COUNT(*) FILTER (WHERE "senderId"  = "clientId" AND "body" LIKE '[CHECKIN:%')
         AS at_risk_checkin_messages
FROM "Message";

-- Q2 at-risk messages bucketed by the client's CURRENT CoachClient count.
-- "1 coach today" is a CANDIDATE bucket, not an eligible one: a client who once
-- had two coaches and now has one lands here. Q6 (other-coach history) and Q7
-- (coaching context) subtract from it. Do not read this bucket as the gain.
WITH cc AS (SELECT "clientId", COUNT(*) AS n FROM "CoachClient" GROUP BY "clientId")
SELECT CASE WHEN COALESCE(cc.n, 0) = 0 THEN '0 coaches — stays hidden'
            WHEN cc.n = 1 THEN '1 coach today — candidate, see Q6 and Q7'
            ELSE '2+ coaches — stays hidden' END AS bucket,
       COUNT(*) AS messages,
       COUNT(DISTINCT m."clientId") AS clients
FROM "Message" m
LEFT JOIN cc ON cc."clientId" = m."clientId"
WHERE m."senderId" = m."clientId"
GROUP BY 1 ORDER BY 1;

-- Q3 effect of the time bound, the other-coach clamp, and the topology split
WITH sole_relationship AS (
  SELECT cc."clientId"       AS "clientId",
         MIN(cc."id")        AS "coachClientId",
         MIN(cc."coachId")   AS "coachId",
         MIN(cc."createdAt") AS "rowCreatedAt"
  FROM "CoachClient" cc
  GROUP BY cc."clientId"
  HAVING COUNT(*) = 1
),
other_coach_evidence AS (
  SELECT sr."clientId"      AS "clientId",
         MAX(m."createdAt") AS "lastOtherCoachAt"
  FROM sole_relationship sr
  JOIN "Message" m
    ON m."clientId"  = sr."clientId"
   AND m."senderId" <> sr."clientId"
   AND m."senderId" <> sr."coachId"
  GROUP BY sr."clientId"
),
attribution_window AS (
  SELECT sr."clientId", sr."coachId", sr."rowCreatedAt", oce."lastOtherCoachAt",
         -- byte-equivalent to the migration's CASE (two branches, no widening)
         CASE
           WHEN oce."lastOtherCoachAt" IS NULL
             OR sr."rowCreatedAt" > oce."lastOtherCoachAt" THEN sr."rowCreatedAt"
           ELSE NULL   -- predecessor survivor: attribute nothing
         END AS "startsAt",
         -- diagnostic only (divergence 3); does not change which rows are counted
         CASE
           WHEN oce."lastOtherCoachAt" IS NULL THEN 'clean'
           WHEN sr."rowCreatedAt" > oce."lastOtherCoachAt" THEN 'successor'
           ELSE 'predecessor'
         END AS "topology",
         -- diagnostic only (divergence 4); sizes what the DELETED widening clause
         -- used to recover. Never feed this into "startsAt".
         (SELECT MIN(m2."createdAt") FROM "Message" m2
           WHERE m2."clientId" = sr."clientId" AND m2."senderId" = sr."coachId")
           AS "coachFirstMessageAt"
  FROM sole_relationship sr
  LEFT JOIN other_coach_evidence oce ON oce."clientId" = sr."clientId"
)
SELECT COUNT(*) FILTER (WHERE aw."startsAt" IS NOT NULL
                          AND m."createdAt" >= aw."startsAt"
                          AND (aw."lastOtherCoachAt" IS NULL
                               OR m."createdAt" > aw."lastOtherCoachAt"))  AS will_be_attributed,
       COUNT(*) FILTER (WHERE aw."startsAt" IS NOT NULL
                          AND m."createdAt" <  aw."startsAt")              AS stays_null_predates_relationship,
       -- amendment 3: the sub-count of the column above that the DELETED widening
       -- clause used to recover — client rows inside this coach's own message
       -- history but before the surviving relationship row date, on clients with
       -- no other-coach evidence at all (the only shape the clause ever fired on).
       -- Report this to Jaden when non-zero; it is the measured price of removing
       -- the widening, and it is recoverable by a later evidence-reviewed
       -- migration. It is NEVER a reason to re-add the clause.
       COUNT(*) FILTER (WHERE aw."topology" = 'clean'
                          AND aw."coachFirstMessageAt" IS NOT NULL
                          AND m."createdAt" <  aw."startsAt"
                          AND m."createdAt" >= aw."coachFirstMessageAt")   AS stays_null_inside_own_coach_history,
       COUNT(*) FILTER (WHERE aw."startsAt" IS NOT NULL
                          AND m."createdAt" >= aw."startsAt"
                          AND aw."lastOtherCoachAt" IS NOT NULL
                          AND m."createdAt" <= aw."lastOtherCoachAt")      AS stays_null_other_coach_window,
       -- amendment 2: the whole predecessor-survivor set, withheld entirely
       COUNT(*) FILTER (WHERE aw."topology" = 'predecessor')               AS stays_null_predecessor_topology,
       COUNT(DISTINCT m."clientId") FILTER (WHERE aw."startsAt" IS NOT NULL
                                             AND m."createdAt" < aw."startsAt")
         AS clients_with_pre_relationship_history,
       COUNT(DISTINCT m."clientId") FILTER (WHERE aw."lastOtherCoachAt" IS NOT NULL)
         AS clients_with_other_coach_history,
       COUNT(DISTINCT m."clientId") FILTER (WHERE aw."topology" = 'predecessor')
         AS clients_predecessor_topology
FROM "Message" m
JOIN attribution_window aw ON aw."clientId" = m."clientId"
WHERE m."senderId" = m."clientId";

-- Q4 messages gained per affected coach (clamp applied — this is the real gain)
WITH sole_relationship AS (
  SELECT cc."clientId"       AS "clientId",
         MIN(cc."id")        AS "coachClientId",
         MIN(cc."coachId")   AS "coachId",
         MIN(cc."createdAt") AS "rowCreatedAt"
  FROM "CoachClient" cc
  GROUP BY cc."clientId"
  HAVING COUNT(*) = 1
),
other_coach_evidence AS (
  SELECT sr."clientId"      AS "clientId",
         MAX(m."createdAt") AS "lastOtherCoachAt"
  FROM sole_relationship sr
  JOIN "Message" m
    ON m."clientId"  = sr."clientId"
   AND m."senderId" <> sr."clientId"
   AND m."senderId" <> sr."coachId"
  GROUP BY sr."clientId"
),
attribution_window AS (
  SELECT sr."clientId", sr."coachId", sr."rowCreatedAt", oce."lastOtherCoachAt",
         -- byte-equivalent to the migration's CASE (two branches, no widening)
         CASE
           WHEN oce."lastOtherCoachAt" IS NULL
             OR sr."rowCreatedAt" > oce."lastOtherCoachAt" THEN sr."rowCreatedAt"
           ELSE NULL   -- predecessor survivor: attribute nothing
         END AS "startsAt",
         -- diagnostic only (divergence 3); does not change which rows are counted
         CASE
           WHEN oce."lastOtherCoachAt" IS NULL THEN 'clean'
           WHEN sr."rowCreatedAt" > oce."lastOtherCoachAt" THEN 'successor'
           ELSE 'predecessor'
         END AS "topology",
         -- diagnostic only (divergence 4); sizes what the DELETED widening clause
         -- used to recover. Never feed this into "startsAt".
         (SELECT MIN(m2."createdAt") FROM "Message" m2
           WHERE m2."clientId" = sr."clientId" AND m2."senderId" = sr."coachId")
           AS "coachFirstMessageAt"
  FROM sole_relationship sr
  LEFT JOIN other_coach_evidence oce ON oce."clientId" = sr."clientId"
)
SELECT aw."coachId", u."firstName", u."lastName",
       COUNT(*) AS messages_gained,
       COUNT(DISTINCT m."clientId") AS clients_affected,
       MIN(m."createdAt") AS oldest_restored,
       MAX(m."createdAt") AS newest_restored
FROM "Message" m
JOIN attribution_window aw ON aw."clientId" = m."clientId"
JOIN "User" u ON u.id = aw."coachId"
WHERE m."senderId" = m."clientId"
  AND aw."startsAt" IS NOT NULL
  AND m."createdAt" >= aw."startsAt"
  AND (aw."lastOtherCoachAt" IS NULL OR m."createdAt" > aw."lastOtherCoachAt")
GROUP BY aw."coachId", u."firstName", u."lastName"
ORDER BY messages_gained DESC;

-- Q5 the ambiguous remainder, per client (what a coach will never see again)
WITH cc AS (SELECT "clientId", COUNT(*) AS n FROM "CoachClient" GROUP BY "clientId")
SELECT m."clientId", COALESCE(cc.n, 0) AS coach_count,
       COUNT(*) AS messages_staying_hidden,
       MIN(m."createdAt") AS oldest, MAX(m."createdAt") AS newest
FROM "Message" m
LEFT JOIN cc ON cc."clientId" = m."clientId"
WHERE m."senderId" = m."clientId" AND COALESCE(cc.n, 0) <> 1
GROUP BY m."clientId", cc.n
ORDER BY messages_staying_hidden DESC;

-- Q6 the cross-coach set: clients with exactly ONE CoachClient row today whose
-- message history nevertheless contains another coach's conversation. Q2 cannot
-- see these (it buckets by TODAY's row count, so they read as "1 coach —
-- eligible"), Q3's predates-relationship column cannot see them (the rows are
-- inside the window), and Q5 excludes them by definition. This is the query that
-- sizes the clamp AND the amendment-2 topology split.
--
-- topology = 'successor'   -> the surviving relationship began after the other
--   coach's last trace. Rows at or after startsAt are attributed; the balance in
--   withheld_total is what the clamp and the row-date bound protect.
-- topology = 'predecessor' -> the surviving row predates the other coach's
--   activity, so no evidence-backed lower bound exists and the ENTIRE client is
--   withheld (startsAt IS NULL). For these rows withheld_total = every
--   client-authored row and attributed = 0, by design. This column is the cost of
--   the amendment-2 decision; read it together with Q1's client_authored_at_risk.
WITH sole_relationship AS (
  SELECT cc."clientId"       AS "clientId",
         MIN(cc."id")        AS "coachClientId",
         MIN(cc."coachId")   AS "coachId",
         MIN(cc."createdAt") AS "rowCreatedAt"
  FROM "CoachClient" cc
  GROUP BY cc."clientId"
  HAVING COUNT(*) = 1
),
other_coach_evidence AS (
  SELECT sr."clientId"      AS "clientId",
         MAX(m."createdAt") AS "lastOtherCoachAt"
  FROM sole_relationship sr
  JOIN "Message" m
    ON m."clientId"  = sr."clientId"
   AND m."senderId" <> sr."clientId"
   AND m."senderId" <> sr."coachId"
  GROUP BY sr."clientId"
),
attribution_window AS (
  SELECT sr."clientId", sr."coachId", sr."rowCreatedAt", oce."lastOtherCoachAt",
         -- byte-equivalent to the migration's CASE (two branches, no widening)
         CASE
           WHEN oce."lastOtherCoachAt" IS NULL
             OR sr."rowCreatedAt" > oce."lastOtherCoachAt" THEN sr."rowCreatedAt"
           ELSE NULL   -- predecessor survivor: attribute nothing
         END AS "startsAt",
         -- diagnostic only (divergence 3); does not change which rows are counted
         CASE
           WHEN oce."lastOtherCoachAt" IS NULL THEN 'clean'
           WHEN sr."rowCreatedAt" > oce."lastOtherCoachAt" THEN 'successor'
           ELSE 'predecessor'
         END AS "topology",
         -- diagnostic only (divergence 4); sizes what the DELETED widening clause
         -- used to recover. Never feed this into "startsAt".
         (SELECT MIN(m2."createdAt") FROM "Message" m2
           WHERE m2."clientId" = sr."clientId" AND m2."senderId" = sr."coachId")
           AS "coachFirstMessageAt"
  FROM sole_relationship sr
  LEFT JOIN other_coach_evidence oce ON oce."clientId" = sr."clientId"
)
SELECT aw."clientId",
       aw."coachId" AS gaining_coach,
       aw."topology",
       aw."rowCreatedAt",
       aw."startsAt",
       aw."lastOtherCoachAt",
       (SELECT COUNT(DISTINCT x."senderId") FROM "Message" x
         WHERE x."clientId"  = aw."clientId"
           AND x."senderId" <> aw."clientId"
           AND x."senderId" <> aw."coachId")                          AS other_coach_authors,
       COUNT(*) FILTER (WHERE aw."startsAt" IS NOT NULL
                          AND m."createdAt" >= aw."startsAt"
                          AND m."createdAt" >  aw."lastOtherCoachAt")  AS attributed,
       COUNT(*) FILTER (WHERE NOT (aw."startsAt" IS NOT NULL
                                   AND m."createdAt" >= aw."startsAt"
                                   AND m."createdAt" >  aw."lastOtherCoachAt"))
                                                                      AS withheld_total,
       COUNT(*) FILTER (WHERE aw."topology" = 'predecessor')           AS withheld_predecessor_topology,
       MIN(m."createdAt") AS oldest_client_row,
       MAX(m."createdAt") AS newest_client_row
FROM attribution_window aw
JOIN "Message" m
  ON m."clientId" = aw."clientId"
 AND m."senderId" = m."clientId"
WHERE aw."lastOtherCoachAt" IS NOT NULL
GROUP BY aw."clientId", aw."coachId", aw."topology", aw."rowCreatedAt",
         aw."startsAt", aw."lastOtherCoachAt"
ORDER BY withheld_total DESC;

ROLLBACK;

-- Q7 APPENDIX — run ONLY on a rehearsal branch where
-- 20260913260000_client_coaching_context has ALREADY been applied. On a raw
-- production branch this relation does not exist and running it aborts the whole
-- read-only transaction. It sizes condition 2 (the context test): single-coach
-- clients this migration will skip because the application itself refuses to
-- name their coach.
--
-- It carries its own BEGIN / SET TRANSACTION READ ONLY / ROLLBACK so that
-- aborting here can never affect Q1-Q6 above, which have already rolled back.

BEGIN;
SET TRANSACTION READ ONLY;

WITH sole_relationship AS (
  SELECT cc."clientId"       AS "clientId",
         MIN(cc."id")        AS "coachClientId",
         MIN(cc."coachId")   AS "coachId",
         MIN(cc."createdAt") AS "rowCreatedAt"
  FROM "CoachClient" cc
  GROUP BY cc."clientId"
  HAVING COUNT(*) = 1
)
SELECT ctx."resolutionRequired",
       ctx."mode",
       COUNT(DISTINCT sr."clientId") AS clients_skipped,
       COUNT(m.id) FILTER (WHERE m."senderId" = m."clientId") AS client_rows_staying_null
FROM sole_relationship sr
JOIN "ClientCoachingContext" ctx ON ctx."clientId" = sr."clientId"
LEFT JOIN "Message" m ON m."clientId" = sr."clientId"
-- exact NULL-safe negation of the migration's positive context test
WHERE ctx."mode" <> 'HUMAN'::"CoachingMode"
   OR ctx."resolutionRequired"
   OR ctx."activeCoachClientId" IS DISTINCT FROM sr."coachClientId"
GROUP BY 1, 2
ORDER BY clients_skipped DESC;

ROLLBACK;

-- How to read the output (go/no-go for applying the ordered triple on Neon).
-- Stated in terms of what the shipped SQL GUARANTEES, not in terms of "no leak
-- is present":
--
-- PROCEED, NOTHING LOST. Q2's "2+ coaches" bucket is 0, Q3's
-- stays_null_predates_relationship, stays_null_other_coach_window AND
-- stays_null_predecessor_topology are all 0, and Q6 returns NO ROWS. The
-- migrations restore 100% of coach-visible history and the ambiguity policy is
-- moot.
--
-- PROCEED WITH THE LIST. Any of those is non-zero. Everything counted there
-- stays coachId = NULL: hidden from every coach, still in the client's own
-- archive. Q5 (0 / 2+ coach clients) and Q6 (single-coach clients with another
-- coach in their history) together are the exact list of clients whose coach
-- sees a shortened thread. Manual attribution for them is a separate ticket, not
-- T-661.
--
-- Q6's withheld_total is the SIZE OF THE CROSS-COACH EXPOSURE THIS DESIGN
-- PREVENTS. Every row in that column is a client message an unclamped
-- single-coach backfill would have handed to a coach who was never in that
-- conversation, permanently. It is a LOWER BOUND on that figure: it counts only
-- clients with surviving other-coach evidence, and the same exposure exists —
-- unmeasurably — wherever that evidence was erased by an account purge. A
-- non-zero value is not a defect, it is the clamp working.
--
-- Q6's withheld_predecessor_topology is THE PRICE OF AMENDMENT 2, stated
-- separately on purpose. These are clients whose surviving coach's relationship
-- row predates the other coach's activity. The database holds no signal that can
-- place a client reply on one side or the other of the departed coach's era, so
-- this design withholds all of them rather than guessing (see the topology split
-- in the migration header, condition 3). Everything in this column is
-- recoverable by a later evidence-reviewed migration; nothing wrongly written is.
--
-- Q3's stays_null_inside_own_coach_history is THE PRICE OF AMENDMENT 3, stated
-- separately for the same reason. These are client rows that sit inside the
-- surviving coach's own message history but before that coach's CoachClient row
-- date, on clients with no other-coach evidence at all — exactly what the
-- now-deleted widening clause used to recover. REPORT IT TO JADEN WHENEVER IT IS
-- NON-ZERO. It is never a reason to re-add the clause: empty other-coach
-- evidence is not proof that no other coach existed (purgeUserAccount deletes a
-- departed coach's Message rows AND their CoachClient row, and a predecessor who
-- never wrote leaves the same emptiness), so these rows are indistinguishable
-- from erased coach churn. A follow-up evidence-reviewed recovery is always
-- available for NULLs; a wrong write is not.
--
-- STOP AND ASK JADEN if Q6's summed withheld_total is a material share of
-- Q1's client_authored_at_risk, or if other_coach_authors > 1 for a meaningful
-- number of clients. That means the single-surviving-relationship assumption
-- does not describe this data set's history, and a shortened thread may be worse
-- for coaches than the current all-NULL behaviour. That is a go/no-go input for
-- T-302 — NOT a reason to change this SQL.
--
-- SEPARATELY, REPORT withheld_predecessor_topology TO JADEN WHENEVER IT IS
-- NON-ZERO, even if the totals are small. It is the one number that would
-- justify a FOLLOW-UP recovery ticket (manual or evidence-reviewed attribution
-- for those clients). It is never a reason to loosen this migration.
--
-- THE PREVIEW OVER-ESTIMATES GAINS AND UNDER-ESTIMATES THE REMAINDER because it
-- omits condition 2 (see divergence 2 in the header). Q7, on a rehearsal branch,
-- is the only place the context test is measured.
--
-- Q4's output is the change record kept for rollback reasoning: rollback of this
-- backfill is removing the coachId filter from the readers, not dropping the
-- column (coachId is additive and nullable), so Q4 documents exactly which
-- coaches gained which rows if that reasoning is ever revisited.
--
-- Q1's total_messages is the duration input for the T-302 packet: the migration
-- is a single UPDATE taking row locks on "Message" only, with no FK cascade.
