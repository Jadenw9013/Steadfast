-- T-841 hotfix — production data repair, preview first.
--
-- This file is documentation only. No agent runs any statement in this file.
-- Jaden runs the preview SELECTs in the Neon SQL editor, saves the output as
-- the rollback record, then uncomments and runs the UPDATEs below them.
--
-- Root cause (see board/tickets/T-841.md): the deployed backend replaced
-- `MealPlan.planExtras` wholesale on every coach save
-- (app/actions/meal-plans.ts:192-193 pre-fix,
-- app/api/coach/clients/[clientId]/meal-plan/route.ts:387 pre-fix). The
-- shipped App Store iOS build sends a `planExtras` object with only
-- `dayOverrides` whenever a plan has at least one day override — it has no
-- `metadata` (phase, start date, bodyweight, coach notes, highlighted
-- changes) and no `confidence` fields at all. So a plan authored on web with
-- that metadata, opened and saved on iOS with any day override, lost the
-- metadata and confidence permanently the moment the save completed. The
-- plan's foods/macros themselves are NOT lost — only the coach-authored
-- extras. This file is read-only reconnaissance and a documented, manual
-- repair path; it does not run automatically and is not part of the code
-- deploy.
--
-- Every query below casts "planExtras"::jsonb explicitly so it runs whether
-- the column's actual Postgres type is `json` or `jsonb` — no migration
-- created this column (it reached production via `db push`), so the repo
-- cannot prove which.
--
-- Human gate G-T841-DATA: run queries 0-6 below and paste the output into
-- board/tickets/T-841.md (or the evidence file) BEFORE deploying the code
-- fix, so the "how bad is it right now" snapshot is taken before the fix
-- stops new damage. Save query 3's output verbatim — it is the only rollback
-- record for the repair.

-- ── 0. Column type (informational; feeds T-873, nothing in this hotfix
-- depends on the answer) ─────────────────────────────────────────────────────
SELECT data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'MealPlan' AND column_name = 'planExtras';

-- ── 1. Exposure — how much coach-authored metadata still exists and is
-- therefore still at risk until the fix deploys ─────────────────────────────
SELECT p.status, count(*) AS rows,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'metadata')   AS with_metadata,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'confidence') AS with_confidence
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND (p."planExtras"::jsonb ? 'metadata' OR p."planExtras"::jsonb ? 'confidence')
GROUP BY p.status;

SELECT p.id, p."clientId", p."weekOf", p.version, p.status, p."updatedAt"
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND (p."planExtras"::jsonb ? 'metadata' OR p."planExtras"::jsonb ? 'confidence')
ORDER BY p."updatedAt" DESC;

-- ── 1b. Residual exposure — day overrides that still carry a NON-EMPTY
-- legacy `items` array. This hotfix's one-level merge protects `metadata`
-- and `confidence`, but `dayOverrides` is itself a single top-level key, so
-- an iOS save (`EditableDayOverride.toDayOverride()` hard-codes `items: nil`)
-- still replaces it wholesale on every save — see the "KNOWN GAP" paragraph
-- in lib/meal-plans/plan-extras-merge.ts. This query is the blast radius
-- still open after this hotfix deploys; it is NOT closed by this ticket and
-- T-870's scope must grow to cover `EditableDayOverride` before it is.
-- Tightened (not a `jsonb_path_exists` presence check): `items: []` and
-- `items: null` are excluded on purpose — an override that already has no
-- items, or none at all, has nothing left for an iOS save to drop, so
-- counting it would overstate the still-open blast radius.
SELECT p.status, count(*) AS rows
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND jsonb_typeof(p."planExtras"::jsonb -> 'dayOverrides') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p."planExtras"::jsonb -> 'dayOverrides') AS ov
    WHERE jsonb_typeof(ov -> 'items') = 'array'
      AND jsonb_array_length(ov -> 'items') > 0
  )
GROUP BY p.status;

-- ── 1c. Legacy/unknown top-level keys — measures the premise behind rule 1
-- of the merge helper's doc comment (raw-value merge, not parsed). Counts
-- rows whose planExtras carries any top-level key other than metadata,
-- dayOverrides, or confidence (e.g. rules/cardio/hydration/supplements/
-- allowances). No writer in this repo puts those keys in this column today —
-- extractPlanExtras (lib/validations/meal-plan-import.ts:71-77) is the only
-- function that moves an LLM-parsed plan into planExtras, and it filters
-- down to metadata/dayOverrides/confidence before the write, regardless of
-- what lib/llm/parse-meal-plan.ts's prompt asks the model to emit upstream.
-- cardio and hydration are rule *categories* (types/meal-plan-extras.ts),
-- never top-level keys. So this query's premise rests entirely on rows
-- written before extractPlanExtras filtered this way — i.e. this is
-- unmeasured, not disproven, and it only measures how much stored data a
-- parsed merge would silently destroy, not whether any client reads it.
SELECT count(*) AS rows,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'rules')       AS with_rules,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'cardio')      AS with_cardio,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'hydration')   AS with_hydration,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'supplements') AS with_supplements,
       count(*) FILTER (WHERE p."planExtras"::jsonb ? 'allowances')  AS with_allowances,
       count(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM jsonb_object_keys(p."planExtras"::jsonb) k
           WHERE k NOT IN ('metadata', 'dayOverrides', 'confidence')
         )
       ) AS with_any_other_key
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND jsonb_typeof(p."planExtras"::jsonb) = 'object';

-- ── 2. Suspected damaged (outer bound) — DELIBERATELY OVER-COUNTS. ─────────
-- Shape: has dayOverrides, has neither metadata nor confidence. This is
-- exactly what an iOS save leaves behind, but it is NOT proof of damage: the
-- web editor's "Day Overrides" quick-start button
-- (components/coach/meal-plan/meal-plan-editor-v2.tsx:633) seeds the
-- identical `{ dayOverrides: [...] }` shape legitimately on a plan that
-- never had metadata in the first place. Do not treat this list as a repair
-- list — it is the outer bound that query 3 narrows down.
SELECT p.id, p."clientId", p."weekOf", p.version, p.status, p."updatedAt"
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND p."planExtras"::jsonb ? 'dayOverrides'
  AND NOT (p."planExtras"::jsonb ? 'metadata')
  AND NOT (p."planExtras"::jsonb ? 'confidence')
ORDER BY p."updatedAt" DESC;

-- ── 3. Provably damaged AND RECOVERABLE — the actionable list. ─────────────
-- Self-joins query 2's rows against any OLDER MealPlan row (donor.version <
-- damaged.version) for the same (clientId, weekOf) — any status — whose
-- planExtras carries metadata or confidence. Bounded to strictly older
-- versions: a sibling created AFTER the damaged row cannot be the version
-- the damaged draft forked from, so treating it as a donor would misrepresent
-- an unrelated later value as "the source this row lost" (see HONESTY
-- below). Works because production deletes nothing (createDraftMealPlan
-- always inserts a new row) and the deployed publish path does not supersede
-- (T-660's supersede-on-publish is sprint-only), so the PUBLISHED row a
-- damaged draft derives from is still sitting in the table, at a lower
-- version, as the donor.
--
-- `metadata` and `confidence` are ranked in SEPARATE CTEs, each against its
-- own best donor. A single ranking over the combined donor set (both
-- earlier drafts of this file) can let a candidate carrying only
-- `confidence` outrank a candidate carrying `metadata`, so the metadata
-- donor for a row is never surfaced even though one exists — silent
-- under-recovery. Splitting the ranking per field means a damaged row can
-- recover `metadata` from one donor and `confidence` from a different donor,
-- and each field's absence in the output is only ever "no donor exists",
-- never "a donor existed but lost the tie".
--
-- SAVE THIS OUTPUT VERBATIM BEFORE RUNNING ANY REPAIR. It is the only
-- rollback record: the pre-repair damaged values are gone (see the honesty
-- note at the bottom of this file), so this query's output — which donor
-- was copied onto which damaged row, per field — is the sole record of what
-- the repair did.
--
-- TIE-BREAK (applied independently within each field's ranking): a damaged
-- row can have several eligible donor siblings for the same field (e.g.
-- three older draft versions of the same week all carrying metadata). This
-- picks exactly one donor per damaged row per field, deterministically:
-- highest `version` first, then most recent `updatedAt`, then `id` as a
-- final tiebreaker so the choice never depends on scan order. Other donors
-- for the same damaged row/field are NOT shown here — they existed once but
-- are not surfaced as alternatives.
--
-- HONESTY: the donor value is copied from a *different*, OLDER MealPlan row,
-- not recovered from the damaged row itself. It is the best available
-- approximation of what was overwritten (the coach may have made further
-- edits between authoring the donor version and the destructive save), not
-- proof of the exact original value. A version created AFTER the damaged row
-- is NEVER used as a donor, even when one exists and even when it carries
-- metadata/confidence (e.g. a later draft the coach rebuilt from scratch) —
-- a row whose only eligible donors are newer is not "recoverable" by this
-- query's definition and surfaces in query 4 instead, with no donor
-- candidate at all rather than a misleading later one. Once the repair
-- UPDATE runs, the copied value is written into the damaged row and becomes
-- indistinguishable from data that was never lost — there is no marker
-- recording that a given row's metadata/confidence was reconstructed rather
-- than original.
WITH damaged AS (
  SELECT p.id, p."clientId", p."weekOf", p.version, p.status, p."updatedAt", p."planExtras"::jsonb AS extras
  FROM "MealPlan" p
  WHERE p."planExtras" IS NOT NULL
    AND p."planExtras"::jsonb ? 'dayOverrides'
    AND NOT (p."planExtras"::jsonb ? 'metadata')
    AND NOT (p."planExtras"::jsonb ? 'confidence')
),
ranked_metadata_donors AS (
  SELECT
    d.id                                     AS damaged_id,
    donor.id                                 AS donor_id,
    donor.status                             AS donor_status,
    donor.version                            AS donor_version,
    donor."updatedAt"                        AS donor_updated_at,
    donor."planExtras"::jsonb -> 'metadata'  AS donor_metadata,
    row_number() OVER (
      PARTITION BY d.id
      ORDER BY donor.version DESC, donor."updatedAt" DESC, donor.id DESC
    ) AS rank
  FROM damaged d
  JOIN "MealPlan" donor
    ON donor."clientId" = d."clientId"
   AND donor."weekOf" = d."weekOf"
   AND donor.id <> d.id
   AND donor.version < d.version
   AND donor."planExtras" IS NOT NULL
   AND donor."planExtras"::jsonb ? 'metadata'
),
ranked_confidence_donors AS (
  SELECT
    d.id                                       AS damaged_id,
    donor.id                                   AS donor_id,
    donor.status                               AS donor_status,
    donor.version                              AS donor_version,
    donor."updatedAt"                          AS donor_updated_at,
    donor."planExtras"::jsonb -> 'confidence'  AS donor_confidence,
    row_number() OVER (
      PARTITION BY d.id
      ORDER BY donor.version DESC, donor."updatedAt" DESC, donor.id DESC
    ) AS rank
  FROM damaged d
  JOIN "MealPlan" donor
    ON donor."clientId" = d."clientId"
   AND donor."weekOf" = d."weekOf"
   AND donor.id <> d.id
   AND donor.version < d.version
   AND donor."planExtras" IS NOT NULL
   AND donor."planExtras"::jsonb ? 'confidence'
)
SELECT
  d.id             AS damaged_id,
  d.status         AS damaged_status,
  d.version        AS damaged_version,
  d."updatedAt"    AS damaged_updated_at,
  md.donor_id      AS metadata_donor_id,
  md.donor_status  AS metadata_donor_status,
  md.donor_version AS metadata_donor_version,
  md.donor_metadata,
  cd.donor_id      AS confidence_donor_id,
  cd.donor_status  AS confidence_donor_status,
  cd.donor_version AS confidence_donor_version,
  cd.donor_confidence
FROM damaged d
LEFT JOIN ranked_metadata_donors   md ON md.damaged_id = d.id AND md.rank = 1
LEFT JOIN ranked_confidence_donors cd ON cd.damaged_id = d.id AND cd.rank = 1
WHERE md.donor_id IS NOT NULL OR cd.donor_id IS NOT NULL
ORDER BY d."updatedAt" DESC;

-- ── 4. Provably damaged AND UNRECOVERABLE. ──────────────────────────────────
-- The exact complement of query 3: query 2 rows with no OLDER sibling
-- version (donor.version < damaged.version) carrying metadata/confidence
-- for the same (clientId, weekOf). Bounded the same way query 3 is, so
-- together queries 3 and 4 exhaustively partition query 2's rows — a row
-- with only a NEWER sibling carrying metadata/confidence lands here, not in
-- query 3 (see query 3's HONESTY note on why a newer sibling is never used
-- as a donor). Emits row age so Jaden can judge whether a Neon point-in-time
-- branch taken before the destructive save is even inside the project's
-- history retention window before spending time on it. Expect this set to be
-- non-empty — metadata authored on a draft that was never published, with no
-- older sibling version, and destroyed outside retention, is gone with no
-- recovery path.
SELECT p.id, p."clientId", p."weekOf", p.version, p.status, p."updatedAt",
       now() - p."updatedAt" AS age
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND p."planExtras"::jsonb ? 'dayOverrides'
  AND NOT (p."planExtras"::jsonb ? 'metadata')
  AND NOT (p."planExtras"::jsonb ? 'confidence')
  AND NOT EXISTS (
    SELECT 1 FROM "MealPlan" donor
    WHERE donor."clientId" = p."clientId"
      AND donor."weekOf" = p."weekOf"
      AND donor.id <> p.id
      AND donor.version < p.version
      AND donor."planExtras" IS NOT NULL
      AND (donor."planExtras"::jsonb ? 'metadata' OR donor."planExtras"::jsonb ? 'confidence')
  )
ORDER BY p."updatedAt" ASC;

-- ── 5. Blast radius — who to tell. This drives a real customer email —
-- derive it from the SAME recoverable/unrecoverable partition queries 3 and
-- 4 use, not a fourth independent copy of the shape predicate. Previously
-- this query re-implemented "has dayOverrides, no metadata, no confidence"
-- on its own — identical to query 2's DELIBERATELY OVER-COUNTING predicate
-- (see query 2's comment) — so any future tightening of what counts as
-- "damaged" in queries 3/4 would silently NOT be reflected here. `recoverable`
-- and `unrecoverable` below are exact copies of query 3's/4's donor-existence
-- checks; their union is by construction every row that also satisfies query
-- 2's predicate, so on today's schema this returns the same client set query
-- 2 would — this does not by itself rule out the quick-start false positive
-- query 2 documents (a plan that legitimately never had metadata still has
-- no donor and lands in `unrecoverable`), but it removes the drift risk of a
-- fifth, independently-maintained predicate copy going out of sync with the
-- repair queries above it. ─────────────────────────────────────────────────
WITH damaged AS (
  SELECT p.id, p."clientId", p."weekOf", p.version
  FROM "MealPlan" p
  WHERE p."planExtras" IS NOT NULL
    AND p."planExtras"::jsonb ? 'dayOverrides'
    AND NOT (p."planExtras"::jsonb ? 'metadata')
    AND NOT (p."planExtras"::jsonb ? 'confidence')
),
recoverable AS (
  SELECT d.id, d."clientId"
  FROM damaged d
  WHERE EXISTS (
    SELECT 1 FROM "MealPlan" donor
    WHERE donor."clientId" = d."clientId"
      AND donor."weekOf" = d."weekOf"
      AND donor.id <> d.id
      AND donor.version < d.version
      AND donor."planExtras" IS NOT NULL
      AND (donor."planExtras"::jsonb ? 'metadata' OR donor."planExtras"::jsonb ? 'confidence')
  )
),
unrecoverable AS (
  SELECT d.id, d."clientId"
  FROM damaged d
  WHERE NOT EXISTS (
    SELECT 1 FROM "MealPlan" donor
    WHERE donor."clientId" = d."clientId"
      AND donor."weekOf" = d."weekOf"
      AND donor.id <> d.id
      AND donor.version < d.version
      AND donor."planExtras" IS NOT NULL
      AND (donor."planExtras"::jsonb ? 'metadata' OR donor."planExtras"::jsonb ? 'confidence')
  )
),
damaged_clients AS (
  SELECT "clientId" FROM recoverable
  UNION
  SELECT "clientId" FROM unrecoverable
)
SELECT DISTINCT dc."clientId", cc."coachId", u.email AS coach_email
FROM damaged_clients dc
JOIN "CoachClient" cc ON cc."clientId" = dc."clientId"
JOIN "User" u ON u.id = cc."coachId";

-- ── 6. Sticky schema-invalid rows (post-fix trade-off, informational). ─────
-- Before this hotfix, a stored value that failed `planExtrasSchema` was
-- silently replaced by the next save (accidental self-healing). After this
-- hotfix, the merge preserves whatever was stored, so a row whose planExtras
-- fails validation stays invalid forever and renders as "no extras at all"
-- in every reader (they all call parsePlanExtras, which returns null on any
-- shape mismatch) — see the "KNOWN TRADE-OFF" paragraph in
-- lib/meal-plans/plan-extras-merge.ts. This is NOT a full reimplementation
-- of planExtrasSchema (that needs the zod schema, not raw SQL) — it is a
-- best-effort structural check for the failure modes this ticket surfaced:
-- a known key holding the wrong JSON type (e.g. `confidence: 0.9`, a number,
-- instead of an object).
--
-- RUN THIS AGAIN AFTER THE REPAIR UPDATEs, NOT JUST BEFORE THEM. Both save
-- call sites validate incoming payloads through `planExtrasSchema` before
-- this hotfix's merge ever runs, and the import path reuses the same
-- sub-schemas (`parsedMealPlanSchema` in lib/validations/meal-plan-import.ts
-- imports `planMetadataSchema`/`dayOverrideSchema`/`confidenceSchema`), so no
-- current product path can create a row this query catches — today the
-- likeliest producer of one is the repair itself: a hand-pasted
-- `'<donor ... literal>'::jsonb` below with a typo or wrong shape writes
-- exactly this failure mode, and post-fix that row is stuck invalid forever
-- (the self-healing this hotfix removed applied to it too). Re-running query
-- 6 after the UPDATEs, before closing gate G-T841-DATA, is the only check
-- that catches a bad paste.
SELECT p.id, p."clientId", p."weekOf", p.version, p.status, p."updatedAt"
FROM "MealPlan" p
WHERE p."planExtras" IS NOT NULL
  AND jsonb_typeof(p."planExtras"::jsonb) = 'object'
  AND (
    (p."planExtras"::jsonb ? 'metadata' AND jsonb_typeof(p."planExtras"::jsonb -> 'metadata') <> 'object')
    OR (p."planExtras"::jsonb ? 'confidence' AND jsonb_typeof(p."planExtras"::jsonb -> 'confidence') <> 'object')
    OR (p."planExtras"::jsonb ? 'dayOverrides' AND jsonb_typeof(p."planExtras"::jsonb -> 'dayOverrides') <> 'array')
  )
ORDER BY p."updatedAt" DESC;

-- ── Honest statement ─────────────────────────────────────────────────────────
-- The overwritten value itself is gone. Postgres keeps no column history for
-- `MealPlan.planExtras`, and the application writes no audit row. Recovery
-- is only possible two ways:
--   (a) Copy the metadata/confidence from an OLDER sibling MealPlan version
--       for the same (clientId, weekOf) — query 3, above. A newer sibling is
--       never used as a donor, even if one exists (see query 3's HONESTY note).
--   (b) A Neon point-in-time branch taken before the destructive save,
--       inside the project's history retention window — query 4's `age`
--       column tells you whether that window has already closed for a given
--       row.
-- Metadata authored on a draft that was never published, with no sibling
-- version, and destroyed longer ago than Neon's retention: unrecoverable.
-- There is no third option.

-- ── Recovery (Jaden runs it, after saving query 3's output as the rollback
-- record; agents never run this) ────────────────────────────────────────────
--
-- Rules (identical to T-800's repair rules, restated here):
--   * One UPDATE per row, by explicit id, pasted from query 3's output.
--     Never a blanket WHERE.
--   * Run only after query 3's output has been saved verbatim somewhere
--     durable (it is the only record of what was overwritten and what it was
--     replaced with).
--   * Shallow top-level jsonb concat only — do not attempt to merge deeper;
--     it would be inconsistent with how the application itself writes this
--     column (see lib/meal-plans/plan-extras-merge.ts).
--   * `metadata` and `confidence` for the same damaged row can come from
--     DIFFERENT donor rows (query 3 ranks each field's donor independently
--     — see query 3's comment). Read `metadata_donor_id` and
--     `confidence_donor_id` separately per row; do not assume one donor
--     supplies both fields.
--
-- TWO VARIANTS — use the one that matches query 0's `data_type`. The bare
-- `jsonb ||` expression assigns a `jsonb` value; Postgres has no implicit
-- assignment cast from `jsonb` to `json`, so on a `json` column the bare
-- variant fails loudly ("column is of type json but expression is of type
-- jsonb") rather than corrupting anything. Use variant A if query 0 reports
-- `jsonb`; use variant B (wraps the expression and casts back) if it
-- reports `json`.
--
-- Variant A — column is `jsonb`:
-- UPDATE "MealPlan"
-- SET "planExtras" = "planExtras"::jsonb || jsonb_build_object('metadata', '<donor metadata literal from query 3>'::jsonb)
-- WHERE "id" = '<damaged_id from query 3>';
--
-- Variant B — column is `json`:
-- UPDATE "MealPlan"
-- SET "planExtras" = ("planExtras"::jsonb || jsonb_build_object('metadata', '<donor metadata literal from query 3>'::jsonb))::json
-- WHERE "id" = '<damaged_id from query 3>';
--
-- -- Repeat with 'confidence' instead of 'metadata' for rows where query 3's
-- -- donor_confidence is non-null (same variant choice applies):
-- UPDATE "MealPlan"
-- SET "planExtras" = "planExtras"::jsonb || jsonb_build_object('confidence', '<donor confidence literal from query 3>'::jsonb)
-- WHERE "id" = '<damaged_id from query 3>';
--
-- UPDATE "MealPlan"
-- SET "planExtras" = ("planExtras"::jsonb || jsonb_build_object('confidence', '<donor confidence literal from query 3>'::jsonb))::json
-- WHERE "id" = '<damaged_id from query 3>';
