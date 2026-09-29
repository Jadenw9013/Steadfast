-- S-20: SINGLE_SIGNER_ACCOUNTABLE_OWNER.
--
-- No table, column, index or data change. One `CREATE OR REPLACE FUNCTION`
-- for the live-launch approval validator called by the
-- `AiCoachLiveLaunchPacket_lifecycle_guard` BEFORE UPDATE trigger, which is
-- the only path a packet row has to `state = 'APPROVED'`.
--
-- WHAT CHANGES
--
-- The approvals cardinality check moves from "exactly 7" to "1..7, with
-- exactly one NUTRITION_PROFESSIONAL and no duplicated requirement". This
-- mirrors `REQUIRED_APPROVAL_REQUIREMENTS` / `ALL_APPROVAL_REQUIREMENTS` in
-- `lib/ai-coach/live-launch/schema.ts`, which is the other half of the same
-- policy. The two must accept the same set; see that file's
-- `LIVE_LAUNCH_APPROVAL_MODE` comment for the full record of what the six
-- dropped signatures bought and what v1 therefore does without — in short,
-- legal scope review, provider privacy/security sign-off and
-- SLO/spend-limits sign-off, not legal review alone.
--
-- Recorded decision: `board/V1-SCOPE.md`, "Decision recorded: one signer"
-- (Jaden, 2026-09-27). This is a deliberate scope reduction, not a
-- workaround. Every other check in this function is unchanged and still
-- enforced on **every** approval the packet carries, required or optional:
-- a packet that does present a legal, privacy or spend signature must
-- present a complete, current, signed, correctly-bound one.
--
-- WHAT DOES NOT CHANGE, AND WHY THE TWO S-20 DEFECTS ARE NOT "FIXED" HERE
--
-- S-20 reported two defects in the validator body:
--
--   1. `item->'jurisdictions' @> candidate->'jurisdictions'` — `->` and `@>`
--      share a precedence level and are left-associative, so the clause
--      parses as `((item->'jurisdictions') @> candidate) -> 'jurisdictions'`
--      and raises 42883 `operator does not exist: boolean -> unknown`, which
--      the function's `EXCEPTION WHEN OTHERS THEN RETURN false` swallows.
--   2. `(item->>'signedAt')::timestamptz <= approved_at` — a `timestamptz`
--      compared against the naive `TIMESTAMP` parameter, resolved through the
--      session `TimeZone` (this machine's server default is
--      America/Los_Angeles, not UTC).
--
-- Both are real in `20260922000000_ai_coach_live_launch_readiness`, and
-- neither has ever been live: `20260922010000_ai_coach_governed_activation`
-- already replaced that body with one that parenthesises both containment
-- operands and pins all six instant comparisons to `AT TIME ZONE 'UTC'`.
-- The v1 text only ever exists between two migrations of the same replay.
-- Reproduced and pinned in `tests/integration/ai-coach-live-launch-sql-gate.test.ts`.
--
-- The whole function was audited for the same shape rather than only the two
-- named lines. `@>` appears exactly twice in the entire migration set (the
-- jurisdiction pair), and every other JSONB access in this body feeds a
-- comparison (`=`, `<>`, `IS DISTINCT FROM`), a cast, or a function call —
-- all of which bind *looser* than `->`/`->>` in PostgreSQL's precedence
-- table, so they cannot reassociate the way `@>` did. Both containment
-- operands are parenthesised below; leaving them so is a requirement of this
-- migration, not an accident of the previous one.

CREATE OR REPLACE FUNCTION "validate_ai_coach_live_launch_approval"(candidate JSONB, approved_at TIMESTAMP)
RETURNS BOOLEAN AS $$
DECLARE
  item JSONB;
BEGIN
  IF candidate::text LIKE '%REQUIRED HUMAN DECISION%' OR
     jsonb_array_length(candidate->'artifactBindings') <> 5 OR
     jsonb_array_length(candidate->'decisionRecords') <> 12 OR
     jsonb_array_length(candidate->'approvals') NOT BETWEEN 1 AND 7 OR
     jsonb_array_length(candidate->'evidence') <> 9 THEN
    RETURN false;
  END IF;

  -- SINGLE_SIGNER_ACCOUNTABLE_OWNER: exactly one accountable signature, the
  -- NUTRITION_PROFESSIONAL one every decision record below binds to, plus at
  -- most one of each optional requirement. The distinct-count check is what
  -- keeps this in step with the TypeScript evaluator, whose Zod schema
  -- rejects a duplicated `requirement`; without it, seven copies of the same
  -- approval would satisfy the cardinality bound here and fail there.
  IF (SELECT count(*) FROM jsonb_array_elements(candidate->'approvals') value
       WHERE value->>'requirement' = 'NUTRITION_PROFESSIONAL') <> 1 OR
     (SELECT count(DISTINCT value->>'requirement')
        FROM jsonb_array_elements(candidate->'approvals') value)
       <> jsonb_array_length(candidate->'approvals') THEN
    RETURN false;
  END IF;

  IF (SELECT count(DISTINCT value->>'kind') FROM jsonb_array_elements(candidate->'artifactBindings')) <> 5 OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(candidate->'artifactBindings') value
       WHERE value->>'kind' NOT IN ('POLICY_BUNDLE', 'FOOD_CATALOG', 'EXERCISE_CATALOG', 'EVIDENCE_REGISTRY', 'ESCALATION_TEMPLATES')
     ) THEN
    RETURN false;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(candidate->'decisionRecords') LOOP
    IF item->>'status' NOT IN ('APPROVED', 'APPROVED_WITH_LIMITS') OR
       item->>'requiredHumanDecision' IS NOT NULL OR
       NULLIF(item->>'recordId', '') IS NULL OR
       NULLIF(item->>'recordDigest', '') IS NULL OR
       NULLIF(item->>'approvalId', '') IS NULL OR
       NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(candidate->'approvals') approval
         WHERE approval->>'approvalId' = item->>'approvalId'
           AND approval->>'requirement' = 'NUTRITION_PROFESSIONAL'
       ) THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(candidate->'approvals') LOOP
    IF item->>'status' <> 'APPROVED' OR
       item->>'requiredHumanDecision' IS NOT NULL OR
       item->'reviewer' IS NULL OR item->'reviewer' = 'null'::jsonb OR
       NULLIF(item->>'scope', '') IS NULL OR
       item->>'subjectReleaseId' IS DISTINCT FROM candidate->>'releaseId' OR
       jsonb_array_length(item->'subjectArtifactDigests') <> 5 OR
       EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(item->'subjectArtifactDigests') digest
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(candidate->'artifactBindings') artifact
           WHERE artifact->>'digest' = digest
         )
       ) OR
       -- Parenthesised on purpose: `->` and `@>` share a precedence level and
       -- are left-associative (S-20 defect 1). Never remove these brackets.
       (item->>'requirement' = 'LEGAL_SCOPE' AND NOT (
         (item->'jurisdictions') @> (candidate->'jurisdictions') AND
         (candidate->'jurisdictions') @> (item->'jurisdictions')
       )) OR
       NULLIF(item->>'recordId', '') IS NULL OR
       NULLIF(item->>'recordDigest', '') IS NULL OR
       item->'signature' IS NULL OR item->'signature' = 'null'::jsonb OR
       item->'signature'->>'digest' IS DISTINCT FROM item->>'recordDigest' OR
       NULLIF(item->>'signedAt', '') IS NULL OR
       NULLIF(item->>'expiresAt', '') IS NULL OR
       -- `AT TIME ZONE 'UTC'` on purpose: `approved_at` is a naive TIMESTAMP
       -- carrying the UTC wall clock Prisma writes into the `TIMESTAMP(3)`
       -- column, so the timestamptz side must be reduced to UTC explicitly
       -- rather than through the session TimeZone (S-20 defect 2).
       ((item->>'signedAt')::timestamptz AT TIME ZONE 'UTC') > approved_at OR
       ((item->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') <= approved_at THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(candidate->'evidence') LOOP
    IF item->>'status' <> 'PASSED' OR
       item->>'requiredHumanDecision' IS NOT NULL OR
       item->>'subjectRevision' IS DISTINCT FROM candidate->>'releaseId' OR
       NULLIF(item->>'recordId', '') IS NULL OR
       NULLIF(item->>'recordDigest', '') IS NULL OR
       item->'attestation' IS NULL OR item->'attestation' = 'null'::jsonb OR
       item->'attestation'->>'digest' IS DISTINCT FROM item->>'recordDigest' OR
       NULLIF(item->>'observedAt', '') IS NULL OR
       NULLIF(item->>'expiresAt', '') IS NULL OR
       ((item->>'observedAt')::timestamptz AT TIME ZONE 'UTC') > approved_at OR
       ((item->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') <= approved_at THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
