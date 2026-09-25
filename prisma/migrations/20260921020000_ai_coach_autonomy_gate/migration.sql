CREATE TYPE "AiAutonomyOutcome" AS ENUM (
  'APPROVE_AUTOMATICALLY',
  'HOLD',
  'FOCUSED_CLARIFICATION',
  'PAUSE_REFER'
);

CREATE TABLE "AiAutonomyGateDecision" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "evaluationKey" TEXT NOT NULL,
  "outcome" "AiAutonomyOutcome" NOT NULL,
  "orderedReasonCodes" TEXT[] NOT NULL,
  "ruleIds" TEXT[] NOT NULL,
  "nextActionTemplateId" TEXT NOT NULL,
  "artifactRefs" JSONB NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "validationReport" JSONB NOT NULL,
  "contextRevision" INTEGER NOT NULL,
  "profileRevision" INTEGER NOT NULL,
  "observationRevision" INTEGER NOT NULL,
  "safetyRevision" INTEGER NOT NULL,
  "nutritionSafetyDecisionId" TEXT,
  "evaluatedPlanVersionId" TEXT,
  "approvedPlanVersionId" TEXT,
  "candidatePayloadHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiAutonomyGateDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiAutonomyGateDecision_evaluation_key_sha256"
    CHECK ("evaluationKey" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiAutonomyGateDecision_input_digest_sha256"
    CHECK ("inputDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiAutonomyGateDecision_candidate_digest_sha256"
    CHECK ("candidatePayloadHash" IS NULL OR "candidatePayloadHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiAutonomyGateDecision_reason_codes_nonempty"
    CHECK (cardinality("orderedReasonCodes") > 0),
  CONSTRAINT "AiAutonomyGateDecision_template_nonempty"
    CHECK (length("nextActionTemplateId") > 0),
  CONSTRAINT "AiAutonomyGateDecision_revisions_valid"
    CHECK (
      "contextRevision" >= -1 AND
      "profileRevision" >= 0 AND
      "observationRevision" >= 0 AND
      "safetyRevision" >= 0
    ),
  CONSTRAINT "AiAutonomyGateDecision_artifact_refs_array"
    CHECK (jsonb_typeof("artifactRefs") = 'array'),
  CONSTRAINT "AiAutonomyGateDecision_source_refs_array"
    CHECK (jsonb_typeof("sourceRefs") = 'array'),
  CONSTRAINT "AiAutonomyGateDecision_input_snapshot_object"
    CHECK (jsonb_typeof("inputSnapshot") = 'object'),
  CONSTRAINT "AiAutonomyGateDecision_validation_report_object"
    CHECK (jsonb_typeof("validationReport") = 'object'),
  CONSTRAINT "AiAutonomyGateDecision_approval_candidate_consistent"
    CHECK (
      ("outcome" = 'APPROVE_AUTOMATICALLY' AND "approvedPlanVersionId" IS NOT NULL) OR
      ("outcome" <> 'APPROVE_AUTOMATICALLY' AND "approvedPlanVersionId" IS NULL)
    )
);

CREATE INDEX "AiAutonomyGateDecision_clientId_createdAt_idx"
  ON "AiAutonomyGateDecision"("clientId", "createdAt");

CREATE INDEX "AiAutonomyGateDecision_clientId_evaluationKey_idx"
  ON "AiAutonomyGateDecision"("clientId", "evaluationKey");

ALTER TABLE "AiAutonomyGateDecision"
  ADD CONSTRAINT "AiAutonomyGateDecision_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_ai_autonomy_gate_decision_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AI autonomy gate decisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiAutonomyGateDecision_update_guard"
BEFORE UPDATE ON "AiAutonomyGateDecision"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_autonomy_gate_decision_update"();
