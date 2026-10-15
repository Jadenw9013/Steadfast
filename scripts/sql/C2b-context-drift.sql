-- T-2059 C2b: ClientCoachingContext drift (audit RELATIONSHIP-AUDIT-2026-10-15, D1).
--
-- READ-ONLY. One SELECT, no writes. Run before the push and again after
-- `scripts/reconcile-coaching-context.ts --apply`.
--
-- Each column is a count of clients (anyone with a CoachClient row or a
-- ClientCoachingContext row) in one state. The states are exactly the ones
-- lib/maintenance/coaching-context-drift.ts#classifyCoachingContext assigns,
-- and tests/integration/coaching-context-reconcile.test.ts asserts the two
-- agree on the same database. `would_change_total` is the number of clients
-- `scripts/reconcile-coaching-context.ts --apply` would rewrite.
--
-- Expected after the apply: every drift column 0. ai_skipped is reported, not
-- changed (AI flags are off in production, so expect 0).
WITH pop AS (
  SELECT "clientId" FROM "ClientCoachingContext"
  UNION
  SELECT "clientId" FROM "CoachClient"
),
rel AS (
  SELECT cc."clientId", count(*) AS n, min(cc."id") AS only_id
  FROM "CoachClient" cc
  GROUP BY cc."clientId"
),
classified AS (
  SELECT
    p."clientId",
    CASE
      WHEN ctx."clientId" IS NULL THEN 'MISSING_CONTEXT'
      WHEN ctx.mode = 'AI' THEN 'AI_SKIPPED'
      WHEN ctx."resolutionRequired" AND COALESCE(rel.n, 0) > 1 THEN 'AMBIGUOUS_WITH_CAUSE'
      WHEN ctx."resolutionRequired" THEN 'STALE_RESOLUTION'
      WHEN ctx.mode = 'NONE' AND COALESCE(rel.n, 0) > 0 THEN 'NONE_BUT_COACHED'
      WHEN ctx.mode = 'NONE' AND ctx."activeCoachClientId" IS NULL THEN 'NONE_OK'
      WHEN ctx.mode = 'NONE' THEN 'NONE_WITH_POINTER'
      WHEN ctx."activeCoachClientId" IS NULL THEN 'HUMAN_POINTER_NULL'
      WHEN COALESCE(rel.n, 0) = 1 AND ctx."activeCoachClientId" = rel.only_id THEN 'HUMAN_OK'
      ELSE 'HUMAN_POINTER_MISMATCH'
    END AS state
  FROM pop p
  LEFT JOIN "ClientCoachingContext" ctx ON ctx."clientId" = p."clientId"
  LEFT JOIN rel ON rel."clientId" = p."clientId"
)
SELECT
  count(*) FILTER (WHERE state = 'NONE_BUT_COACHED')       AS none_but_coached,
  count(*) FILTER (WHERE state = 'HUMAN_POINTER_NULL')     AS human_pointer_null,
  count(*) FILTER (WHERE state = 'STALE_RESOLUTION')       AS stale_resolution,
  count(*) FILTER (WHERE state = 'HUMAN_POINTER_MISMATCH') AS human_pointer_mismatch,
  count(*) FILTER (WHERE state = 'NONE_WITH_POINTER')      AS none_with_pointer,
  count(*) FILTER (WHERE state = 'MISSING_CONTEXT')        AS missing_context,
  count(*) FILTER (WHERE state IN ('NONE_BUT_COACHED', 'HUMAN_POINTER_NULL', 'STALE_RESOLUTION',
                                   'HUMAN_POINTER_MISMATCH', 'NONE_WITH_POINTER', 'MISSING_CONTEXT'))
                                                            AS would_change_total,
  count(*) FILTER (WHERE state = 'HUMAN_OK')               AS human_ok,
  count(*) FILTER (WHERE state = 'NONE_OK')                AS none_ok,
  count(*) FILTER (WHERE state = 'AMBIGUOUS_WITH_CAUSE')   AS ambiguous_with_cause,
  count(*) FILTER (WHERE state = 'AI_SKIPPED')             AS ai_skipped,
  count(*)                                                 AS population
FROM classified;
