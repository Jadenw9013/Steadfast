CREATE TYPE "AiProviderBoundaryOutcome" AS ENUM (
  'VALIDATED',
  'SKIPPED_GATE',
  'FAIL_CLOSED',
  'CAUTION'
);

CREATE TABLE "AiProviderBoundaryAudit" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "promptContractVersion" TEXT NOT NULL,
  "providerConfiguration" TEXT NOT NULL,
  "boundaryOutcome" "AiProviderBoundaryOutcome" NOT NULL,
  "resultOutcome" "AiAutonomyOutcome" NOT NULL,
  "failureCode" TEXT,
  "attempts" INTEGER NOT NULL,
  "preGateDecisionId" TEXT NOT NULL,
  "finalGateDecisionId" TEXT,
  "inputSnapshot" JSONB NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "validatedOutput" JSONB,
  "outputDigest" TEXT,
  "usage" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiProviderBoundaryAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiProviderBoundaryAudit_attempts_bounded"
    CHECK ("attempts" >= 0 AND "attempts" <= 3),
  CONSTRAINT "AiProviderBoundaryAudit_input_digest_sha256"
    CHECK ("inputDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiProviderBoundaryAudit_output_digest_sha256"
    CHECK ("outputDigest" IS NULL OR "outputDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiProviderBoundaryAudit_output_consistent"
    CHECK (
      ("validatedOutput" IS NULL AND "outputDigest" IS NULL) OR
      (jsonb_typeof("validatedOutput") = 'object' AND "outputDigest" IS NOT NULL)
    ),
  CONSTRAINT "AiProviderBoundaryAudit_input_object"
    CHECK (jsonb_typeof("inputSnapshot") = 'object'),
  CONSTRAINT "AiProviderBoundaryAudit_usage_object"
    CHECK ("usage" IS NULL OR jsonb_typeof("usage") = 'object')
);

CREATE UNIQUE INDEX "AiProviderBoundaryAudit_operationId_key"
  ON "AiProviderBoundaryAudit"("operationId");

CREATE INDEX "AiProviderBoundaryAudit_clientId_createdAt_idx"
  ON "AiProviderBoundaryAudit"("clientId", "createdAt");

ALTER TABLE "AiProviderBoundaryAudit"
  ADD CONSTRAINT "AiProviderBoundaryAudit_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_ai_provider_boundary_audit_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AI provider boundary audits are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiProviderBoundaryAudit_update_guard"
BEFORE UPDATE ON "AiProviderBoundaryAudit"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_provider_boundary_audit_update"();
