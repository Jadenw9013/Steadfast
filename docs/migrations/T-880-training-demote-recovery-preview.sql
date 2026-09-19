-- T-880 recovery preview. SELECT-only. Run against production READ-ONLY, by a human.
-- Fingerprint: only two code paths ever set TrainingProgram."publishedAt"
-- (app/actions/training-programs.ts:140 and .../training/publish/route.ts:71) and both set
-- status='PUBLISHED' in the same write. Nothing ever clears it. So status='DRAFT' AND
-- "publishedAt" IS NOT NULL is produced by the T-880 demote and by nothing else. Rows whose
-- coach has since re-published do not match, because publishing flips the status back.

-- Q1. Overall footprint of the bug.
SELECT count(*) AS demoted_rows,
       count(DISTINCT "clientId") AS clients_touched,
       min("publishedAt") AS earliest_demoted, max("publishedAt") AS latest_demoted
FROM "TrainingProgram"
WHERE status = 'DRAFT' AND "publishedAt" IS NOT NULL;

-- Q2. BLACKOUT — clients whose app and plan pages show no workout program at all right now.
SELECT count(*) AS clients_with_no_published_training
FROM (SELECT DISTINCT d."clientId"
      FROM "TrainingProgram" d
      WHERE d.status = 'DRAFT' AND d."publishedAt" IS NOT NULL) d
WHERE NOT EXISTS (SELECT 1 FROM "TrainingProgram" p
                  WHERE p."clientId" = d."clientId" AND p.status = 'PUBLISHED');

-- Q3. SILENT ROLLBACK — still have a published program, but an older one. getPublishedTrainingProgram
--     is not week-scoped, so these clients silently fell back to a previous week ("my workout
--     didn't update") instead of going blank.
SELECT d."clientId", max(d."publishedAt") AS demoted_at,
       (SELECT max(p."publishedAt") FROM "TrainingProgram" p
        WHERE p."clientId" = d."clientId" AND p.status = 'PUBLISHED') AS still_live_at
FROM "TrainingProgram" d
WHERE d.status = 'DRAFT' AND d."publishedAt" IS NOT NULL
GROUP BY d."clientId"
HAVING max(d."publishedAt") > (SELECT max(p."publishedAt") FROM "TrainingProgram" p
                               WHERE p."clientId" = d."clientId" AND p.status = 'PUBLISHED')
ORDER BY demoted_at DESC;

-- Q4. Per-row detail, so a repair or a coach-outreach list can be built by hand.
-- coach_ids is a comma-joined list rather than a LEFT JOIN "CoachClient" so a
-- dual-coached client contributes exactly one row here, not one per coach —
-- a doubled row count would misinform whoever is reading this by hand.
SELECT d.id AS program_id, d."clientId", d."weekOf", d."publishedAt" AS demoted_from,
       d."updatedAt" AS last_saved,
       (SELECT string_agg(cc."coachId", ', ') FROM "CoachClient" cc WHERE cc."clientId" = d."clientId") AS coach_ids,
       (SELECT count(*) FROM "TrainingDay" td WHERE td."programId" = d.id) AS day_count,
       EXISTS (SELECT 1 FROM "TrainingProgram" p
               WHERE p."clientId" = d."clientId" AND p.status = 'PUBLISHED') AS client_has_any_published
FROM "TrainingProgram" d
WHERE d.status = 'DRAFT' AND d."publishedAt" IS NOT NULL
ORDER BY d."publishedAt" DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR — COMMENTED OUT ON PURPOSE. DO NOT RUN. NO AGENT MAY RUN THIS.
-- This is a product decision for Jaden, not an engineering one: the demoted row's *content*
-- is the coach's post-save edit, which the coach saved but never chose to publish. Restoring
-- it publishes unreviewed content to a client. The alternative is to leave the data alone and
-- tell the affected coaches to open the program and press Publish, which is reversible and
-- keeps the coach in control. Decide before running anything.
--
-- UPDATE "TrainingProgram"
--    SET status = 'PUBLISHED'
--  WHERE status = 'DRAFT'
--    AND "publishedAt" IS NOT NULL
--    AND id IN ( /* explicit id list from Q4, never a blanket predicate */ );
-- ─────────────────────────────────────────────────────────────────────────────
