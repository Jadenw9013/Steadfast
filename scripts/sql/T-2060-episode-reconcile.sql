-- T-2060: CoachClientEpisode post-promotion reconcile.
--
-- Run once, right after the T-2060 code is promoted (deploy order: migrate,
-- promote, then this). Idempotent: a second run inserts 0 and updates 0 rows.
-- Also re-run it if the T-2060 code is ever reverted and redeployed.
--
-- Between `migrate deploy` and promotion the OLD code still creates and deletes
-- CoachClient rows without writing episodes. This script:
--   1. opens a BACKFILL episode for every live CoachClient row that has no open
--      episode (the migration's own backfill INSERT, repeated);
--   2. closes every open episode whose CoachClient row no longer exists
--      ("zombies"). The close time is an upper bound; a later end only makes
--      the plan-visibility rule stricter, never wider.
--   3. rewrites any plan author id whose User no longer exists to the 'purged'
--      sentinel (PURGED_PUBLISHER_ID). Only reachable if the code was reverted
--      and the OLD purge deleted an author (the column has no FK); the plan was
--      already never visible, this only removes the dead user's id;
--   4. prints a read-only verification row. Expected:
--      rows = open_episodes, rows_without_episode = 0, zombie_episodes = 0.
--      IF ANY VERIFICATION COUNT IS NON-ZERO (rows <> open_episodes, or either
--      of the last two > 0), RE-RUN THIS SCRIPT. A CoachClient delete racing
--      the first run can leave one open zombie; it fails closed (stricter) and
--      the next run closes it.
--
-- No authorship is invented here. Nothing is deleted.
BEGIN;

INSERT INTO "CoachClientEpisode" ("id","coachId","clientId","coachClientId","startedAt","source","createdAt")
SELECT gen_random_uuid()::text, cc."coachId", cc."clientId", cc."id", cc."createdAt",
       'BACKFILL'::"CoachClientEpisodeSource", now()
FROM "CoachClient" cc
WHERE NOT EXISTS (SELECT 1 FROM "CoachClientEpisode" e WHERE e."coachClientId" = cc."id" AND e."endedAt" IS NULL);

UPDATE "CoachClientEpisode" e SET "endedAt" = now(), "endReason" = 'RECONCILED'
WHERE e."endedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "CoachClient" cc WHERE cc."id" = e."coachClientId");

UPDATE "MealPlan" p SET "publishedByCoachId" = 'purged'
WHERE p."publishedByCoachId" IS NOT NULL AND p."publishedByCoachId" <> 'purged'
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = p."publishedByCoachId");

UPDATE "TrainingProgram" p SET "publishedByCoachId" = 'purged'
WHERE p."publishedByCoachId" IS NOT NULL AND p."publishedByCoachId" <> 'purged'
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = p."publishedByCoachId");

COMMIT;

SELECT
  (SELECT count(*) FROM "CoachClient") AS rows,
  (SELECT count(*) FROM "CoachClientEpisode" WHERE "endedAt" IS NULL) AS open_episodes,
  (SELECT count(*) FROM "CoachClient" cc
    WHERE NOT EXISTS (SELECT 1 FROM "CoachClientEpisode" e WHERE e."coachClientId" = cc."id" AND e."endedAt" IS NULL)
  ) AS rows_without_episode,
  (SELECT count(*) FROM "CoachClientEpisode" e
    WHERE e."endedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "CoachClient" cc WHERE cc."id" = e."coachClientId")
  ) AS zombie_episodes;
