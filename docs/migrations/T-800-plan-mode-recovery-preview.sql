-- T-800 hotfix — production data repair, preview first.
--
-- This file is documentation only. No agent runs any statement in this file.
-- Jaden runs the preview SELECTs in the Neon SQL editor, saves the output as
-- the rollback record, then uncomments and runs the UPDATEs below them.
--
-- Root cause (see board/tickets/T-800.md): a coach/client pair's
-- CoachClient.planMode was left at MACROS by a past toggle tap that never
-- visibly changed anything (see the ticket's "Confirmed mechanism"). The
-- next time the coach published from the foods editor, the new version was
-- stamped MACROS with the coach's foods in `items` and zero
-- `MealMacroTarget` rows. Both coach and client then saw the macro
-- representation of a plan that has no macros — "the plan is gone". No data
-- was destroyed; `MealPlanItem` rows are intact.
--
-- Human gate G-T800-DATA: run queries 1-3 below and paste the output into
-- board/tickets/T-800.md BEFORE deploying the code fix. Save query 1's
-- output verbatim as the rollback record.

-- ── 1. Which published plans are MACROS but have no macro targets? ─────────
-- (the broken state — rows with items > 0 AND macro_targets = 0 are
-- mislabelled foods plans and are the recovery scope below)
SELECT p.id, p."clientId", p."weekOf", p.version, p."publishedAt",
       (SELECT count(*) FROM "MealPlanItem" i WHERE i."mealPlanId" = p.id)        AS items,
       (SELECT count(*) FROM "MealMacroTarget" m WHERE m."mealPlanId" = p.id)     AS macro_targets
FROM "MealPlan" p
WHERE p.status = 'PUBLISHED' AND p."planMode" = 'MACROS'
ORDER BY p."publishedAt" DESC;

-- ── 2. Which coach-client pairs have the MACROS default set? ───────────────
SELECT "coachId", "clientId", "planMode" FROM "CoachClient" WHERE "planMode" = 'MACROS';

-- ── 3. Mislabelled DRAFT rows (same broken state, not covered by query 1) ──
SELECT p.id, p."clientId", p."weekOf", p.version,
       (SELECT count(*) FROM "MealPlanItem" i WHERE i."mealPlanId" = p.id)    AS items,
       (SELECT count(*) FROM "MealMacroTarget" m WHERE m."mealPlanId" = p.id) AS macro_targets
FROM "MealPlan" p
WHERE p.status = 'DRAFT' AND p."planMode" = 'MACROS'
ORDER BY p."createdAt" DESC;

-- ── 4. Human gate, not part of the recovery above: legacy notes/supplements-
-- only published plans that the new publish guard will now refuse to
-- re-publish. ────────────────────────────────────────────────────────────────
-- The guard added by this hotfix (lib/meal-plans/publish-guard.ts) refuses a
-- MEAL_PLAN plan with zero items, even when it carries content in
-- `supportContent` (the column iOS decodes under the name `planNotes`) or
-- `planExtras` that the client UI still renders (both web
-- `simple-meal-plan.tsx` and iOS `MealPlanView.swift`'s
-- `legacyFallbackSections`). This is the same rule team/sprint-1's
-- `lib/meal-plans/publish.ts` ships (T-102b), so the hotfix keeps it — but a
-- coach who edits the notes on one of these rows and taps Publish will now be
-- told "Add at least one food before publishing." and cannot update it. This
-- is a sizing query, not a repair: it tells Jaden the blast radius before
-- deploy. No UPDATE follows it — there is nothing to repair, only to know
-- about (code-review r1 MINOR-8 / parity-auditor r1 gap 3).
SELECT p.id, p."clientId", p."weekOf", p.version, p."publishedAt"
FROM "MealPlan" p
WHERE p.status = 'PUBLISHED'
  AND p."planMode" = 'MEAL_PLAN'
  AND (SELECT count(*) FROM "MealPlanItem" i WHERE i."mealPlanId" = p.id) = 0
  AND (
    coalesce(p."supportContent", '') <> ''
    OR p."planExtras" IS NOT NULL
  )
ORDER BY p."publishedAt" DESC;

-- ── Recovery (Jaden runs it, after saving query 1's output as the rollback
-- record; agents never run this) ────────────────────────────────────────────
--
-- Rules, corrected from the ticket's original draft:
--   * Key the CoachClient reset on BOTH columns — a client can have more
--     than one coach, and an unscoped `WHERE "clientId" = ...` would rewrite
--     another coach's setting.
--   * Reset only the (coachId, clientId) pairs that actually produced a
--     broken plan in query 1, not every row of query 2.
--   * MealPlan rows are repaired by explicit id list only — never a blanket
--     `WHERE "planMode" = 'MACROS'`.
--   * After repair, two PUBLISHED rows may exist for the same week (main has
--     no partial unique index yet). Both readers order by publishedAt desc,
--     so the newest wins — check query 1's output for duplicate
--     (clientId, weekOf) pairs before repairing to know which row is live.
--
-- UPDATE "MealPlan" SET "planMode" = 'MEAL_PLAN'
-- WHERE id IN (/* ids from query 1 (and query 3, if repairing drafts too) with items > 0 and macro_targets = 0 */);
--
-- UPDATE "CoachClient" SET "planMode" = 'MEAL_PLAN'
-- WHERE "coachId" = '<coachId>' AND "clientId" = '<clientId>';
-- (repeat per affected pair from query 1 + query 2)
