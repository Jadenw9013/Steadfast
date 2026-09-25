CREATE TYPE "AiPlanActivationOutcome" AS ENUM ('ACCEPTED', 'REJECTED');
CREATE TYPE "AiCoachOperationalScope" AS ENUM (
  'GENERATION', 'PROVIDER', 'FINALIZATION', 'ACCEPTANCE', 'ARTIFACT_PUBLICATION'
);
CREATE TYPE "AiCoachArtifactLifecycleAction" AS ENUM ('PUBLISH', 'REVOKE');

CREATE TABLE "AiAutomaticPlanApproval" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "gateDecisionId" TEXT NOT NULL,
  "providerBoundaryAuditId" TEXT NOT NULL,
  "evaluationKey" TEXT NOT NULL,
  "candidatePayloadHash" TEXT NOT NULL,
  "artifactRequest" JSONB NOT NULL,
  "artifactRefs" JSONB NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "gateInput" JSONB NOT NULL,
  "providerSelection" JSONB NOT NULL,
  "stateDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAutomaticPlanApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiAutomaticPlanApproval_hashes" CHECK (
    "candidatePayloadHash" ~ '^[a-f0-9]{64}$' AND "stateDigest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "AiAutomaticPlanApproval_json" CHECK (
    jsonb_typeof("artifactRequest") = 'object' AND
    jsonb_typeof("artifactRefs") = 'array' AND
    jsonb_typeof("sourceRefs") = 'array' AND
    jsonb_typeof("gateInput") = 'object' AND
    jsonb_typeof("providerSelection") = 'object'
  )
);
CREATE UNIQUE INDEX "AiAutomaticPlanApproval_planVersionId_key" ON "AiAutomaticPlanApproval"("planVersionId");
CREATE UNIQUE INDEX "AiAutomaticPlanApproval_providerBoundaryAuditId_key" ON "AiAutomaticPlanApproval"("providerBoundaryAuditId");
CREATE INDEX "AiAutomaticPlanApproval_clientId_createdAt_idx" ON "AiAutomaticPlanApproval"("clientId", "createdAt");
ALTER TABLE "AiAutomaticPlanApproval" ADD CONSTRAINT "AiAutomaticPlanApproval_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_ai_automatic_plan_approval_insert"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "AiPlanVersion" p
    WHERE p."id" = NEW."planVersionId" AND p."clientId" = NEW."clientId"
      AND p."status" = 'PROPOSED' AND p."payloadHash" = NEW."candidatePayloadHash"
  ) OR NOT EXISTS (
    SELECT 1 FROM "AiAutonomyGateDecision" g
    WHERE g."id" = NEW."gateDecisionId" AND g."clientId" = NEW."clientId"
      AND g."outcome" = 'APPROVE_AUTOMATICALLY'
      AND g."approvedPlanVersionId" = NEW."planVersionId"
      AND g."candidatePayloadHash" = NEW."candidatePayloadHash"
      AND g."evaluationKey" = NEW."evaluationKey"
  ) OR NOT EXISTS (
    SELECT 1 FROM "AiProviderBoundaryAudit" a
    WHERE a."id" = NEW."providerBoundaryAuditId" AND a."clientId" = NEW."clientId"
      AND a."boundaryOutcome" = 'VALIDATED'
      AND a."resultOutcome" = 'APPROVE_AUTOMATICALLY'
      AND a."finalGateDecisionId" = NEW."gateDecisionId"
  ) THEN
    RAISE EXCEPTION 'automatic approval requires an exact proposed candidate, approved gate and validated provider audit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiAutomaticPlanApproval_insert_guard"
BEFORE INSERT ON "AiAutomaticPlanApproval"
FOR EACH ROW EXECUTE FUNCTION "validate_ai_automatic_plan_approval_insert"();

CREATE TABLE "AiPlanActivationAttempt" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "requestKeyDigest" TEXT NOT NULL,
  "outcome" "AiPlanActivationOutcome" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "automaticApprovalId" TEXT,
  "freshGateDecisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiPlanActivationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiPlanActivationAttempt_digest" CHECK ("requestKeyDigest" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "AiPlanActivationAttempt_clientId_createdAt_idx" ON "AiPlanActivationAttempt"("clientId", "createdAt");
CREATE INDEX "AiPlanActivationAttempt_planVersionId_createdAt_idx" ON "AiPlanActivationAttempt"("planVersionId", "createdAt");
ALTER TABLE "AiPlanActivationAttempt" ADD CONSTRAINT "AiPlanActivationAttempt_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AiCoachGovernanceGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "grantRef" TEXT NOT NULL,
  CONSTRAINT "AiCoachGovernanceGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiCoachGovernanceGrant_userId_key" ON "AiCoachGovernanceGrant"("userId");
ALTER TABLE "AiCoachGovernanceGrant" ADD CONSTRAINT "AiCoachGovernanceGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AiCoachOperationalControl" (
  "scope" "AiCoachOperationalScope" NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT true,
  "reasonCode" TEXT NOT NULL,
  "incidentReference" TEXT,
  "updatedByGrantId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiCoachOperationalControl_pkey" PRIMARY KEY ("scope")
);

CREATE TABLE "AiCoachOperationalEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "scope" "AiCoachOperationalScope" NOT NULL,
  "disabled" BOOLEAN NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "incidentReference" TEXT,
  "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCoachOperationalEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiCoachOperationalEvent_scope_createdAt_idx" ON "AiCoachOperationalEvent"("scope", "createdAt");
ALTER TABLE "AiCoachOperationalEvent" ADD CONSTRAINT "AiCoachOperationalEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AiCoachArtifactLifecycleEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "governanceGrantId" TEXT NOT NULL,
  "artifactVersionId" TEXT NOT NULL,
  "action" "AiCoachArtifactLifecycleAction" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reviewRecordId" TEXT NOT NULL,
  "incidentReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCoachArtifactLifecycleEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiCoachArtifactLifecycleEvent_artifactVersionId_createdAt_idx"
  ON "AiCoachArtifactLifecycleEvent"("artifactVersionId", "createdAt");
ALTER TABLE "AiCoachArtifactLifecycleEvent" ADD CONSTRAINT "AiCoachArtifactLifecycleEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_ai_coach_append_only_update"()
RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'AI Coach audit records are append-only'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "AiAutomaticPlanApproval_update_guard" BEFORE UPDATE ON "AiAutomaticPlanApproval"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_append_only_update"();
CREATE TRIGGER "AiPlanActivationAttempt_update_guard" BEFORE UPDATE ON "AiPlanActivationAttempt"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_append_only_update"();
CREATE TRIGGER "AiCoachOperationalEvent_update_guard" BEFORE UPDATE ON "AiCoachOperationalEvent"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_append_only_update"();
CREATE TRIGGER "AiCoachArtifactLifecycleEvent_update_guard" BEFORE UPDATE ON "AiCoachArtifactLifecycleEvent"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_append_only_update"();
