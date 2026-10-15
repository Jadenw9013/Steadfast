CREATE TYPE "AiCoachLiveLaunchState" AS ENUM ('DRAFT', 'APPROVED', 'REVOKED');
CREATE TYPE "AiCoachLiveLaunchAction" AS ENUM ('APPROVE', 'REVOKE');

CREATE TABLE "AiCoachLiveLaunchPacket" (
  "id" TEXT NOT NULL,
  "packetKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "state" "AiCoachLiveLaunchState" NOT NULL DEFAULT 'DRAFT',
  "schemaVersion" INTEGER NOT NULL,
  "releaseId" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "jurisdictions" TEXT[] NOT NULL,
  "packet" JSONB NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "testOnly" BOOLEAN NOT NULL DEFAULT true,
  "effectiveAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCoachLiveLaunchPacket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiCoachLiveLaunchPacket_version_positive" CHECK ("version" > 0),
  CONSTRAINT "AiCoachLiveLaunchPacket_digest" CHECK ("contentDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiCoachLiveLaunchPacket_packet_object" CHECK (jsonb_typeof("packet") = 'object')
);

CREATE UNIQUE INDEX "AiCoachLiveLaunchPacket_releaseId_key"
  ON "AiCoachLiveLaunchPacket"("releaseId");
CREATE UNIQUE INDEX "AiCoachLiveLaunchPacket_packetKey_version_key"
  ON "AiCoachLiveLaunchPacket"("packetKey", "version");
CREATE INDEX "AiCoachLiveLaunchPacket_state_effectiveAt_expiresAt_idx"
  ON "AiCoachLiveLaunchPacket"("state", "effectiveAt", "expiresAt");

CREATE TABLE "AiCoachLiveLaunchLifecycleEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "governanceGrantId" TEXT NOT NULL,
  "packetId" TEXT NOT NULL,
  "action" "AiCoachLiveLaunchAction" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "packetDigest" TEXT NOT NULL,
  "signedApprovalIndexRef" TEXT NOT NULL,
  "incidentReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCoachLiveLaunchLifecycleEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiCoachLiveLaunchLifecycleEvent_digest" CHECK ("packetDigest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "AiCoachLiveLaunchLifecycleEvent_packetId_createdAt_idx"
  ON "AiCoachLiveLaunchLifecycleEvent"("packetId", "createdAt");
ALTER TABLE "AiCoachLiveLaunchLifecycleEvent" ADD CONSTRAINT "AiCoachLiveLaunchLifecycleEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiCoachLiveLaunchLifecycleEvent" ADD CONSTRAINT "AiCoachLiveLaunchLifecycleEvent_packetId_fkey"
  FOREIGN KEY ("packetId") REFERENCES "AiCoachLiveLaunchPacket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_ai_coach_live_launch_approval"(candidate JSONB, approved_at TIMESTAMP)
RETURNS BOOLEAN AS $$
DECLARE
  item JSONB;
BEGIN
  IF candidate::text LIKE '%REQUIRED HUMAN DECISION%' OR
     jsonb_array_length(candidate->'artifactBindings') <> 5 OR
     jsonb_array_length(candidate->'decisionRecords') <> 12 OR
     jsonb_array_length(candidate->'approvals') <> 7 OR
     jsonb_array_length(candidate->'evidence') <> 9 THEN
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
       (item->>'requirement' = 'LEGAL_SCOPE' AND NOT (
         item->'jurisdictions' @> candidate->'jurisdictions' AND
         candidate->'jurisdictions' @> item->'jurisdictions'
       )) OR
       NULLIF(item->>'recordId', '') IS NULL OR
       NULLIF(item->>'recordDigest', '') IS NULL OR
       item->'signature' IS NULL OR item->'signature' = 'null'::jsonb OR
       item->'signature'->>'digest' IS DISTINCT FROM item->>'recordDigest' OR
       NULLIF(item->>'signedAt', '') IS NULL OR
       NULLIF(item->>'expiresAt', '') IS NULL OR
       (item->>'signedAt')::timestamptz > approved_at OR
       (item->>'expiresAt')::timestamptz <= approved_at THEN
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
       (item->>'observedAt')::timestamptz > approved_at OR
       (item->>'expiresAt')::timestamptz <= approved_at THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION "guard_ai_coach_live_launch_packet"()
RETURNS TRIGGER AS $$
DECLARE
  lifecycle_action TEXT := current_setting('steadfast.ai_coach_live_launch_action', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'DRAFT' OR NEW."effectiveAt" IS NOT NULL OR NEW."expiresAt" IS NOT NULL OR
       NEW."approvedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL OR NEW."revocationReason" IS NOT NULL THEN
      RAISE EXCEPTION 'AI Coach live-launch packets may only be inserted as metadata-free drafts';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id" OR
     NEW."packetKey" IS DISTINCT FROM OLD."packetKey" OR
     NEW."version" IS DISTINCT FROM OLD."version" OR
     NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion" OR
     NEW."releaseId" IS DISTINCT FROM OLD."releaseId" OR
     NEW."engineVersion" IS DISTINCT FROM OLD."engineVersion" OR
     NEW."jurisdictions" IS DISTINCT FROM OLD."jurisdictions" OR
     NEW."packet" IS DISTINCT FROM OLD."packet" OR
     NEW."contentDigest" IS DISTINCT FROM OLD."contentDigest" OR
     NEW."testOnly" IS DISTINCT FROM OLD."testOnly" OR
     NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'AI Coach live-launch packet identity, evidence and digest are immutable';
  END IF;

  IF OLD."state" = 'DRAFT' AND NEW."state" = 'APPROVED' AND lifecycle_action = 'APPROVE' THEN
    IF NEW."testOnly" OR NEW."packet"->>'testOnly' <> 'false' OR
       NEW."packet"->>'packetId' IS DISTINCT FROM NEW."id" OR
       NEW."packet"->>'packetKey' IS DISTINCT FROM NEW."packetKey" OR
       (NEW."packet"->>'version')::integer IS DISTINCT FROM NEW."version" OR
       NEW."packet"->>'releaseId' IS DISTINCT FROM NEW."releaseId" OR
       NEW."packet"->>'engineVersion' IS DISTINCT FROM NEW."engineVersion" OR
       NEW."effectiveAt" IS NULL OR NEW."expiresAt" IS NULL OR NEW."approvedAt" IS NULL OR
       NEW."effectiveAt" > NEW."approvedAt" OR NEW."expiresAt" <= NEW."effectiveAt" OR
       NEW."revokedAt" IS NOT NULL OR NEW."revocationReason" IS NOT NULL OR
       NOT "validate_ai_coach_live_launch_approval"(NEW."packet", NEW."approvedAt") THEN
      RAISE EXCEPTION 'AI Coach live-launch approval requires a complete, current, signed, non-test packet';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'APPROVED' AND NEW."state" = 'REVOKED' AND lifecycle_action = 'REVOKE' THEN
    IF NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt" OR
       NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR
       NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR
       NEW."revokedAt" IS NULL OR NULLIF(btrim(NEW."revocationReason"), '') IS NULL THEN
      RAISE EXCEPTION 'AI Coach live-launch revocation requires immutable approval metadata and a reason';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid or unauthorized AI Coach live-launch lifecycle transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachLiveLaunchPacket_lifecycle_guard"
BEFORE INSERT OR UPDATE ON "AiCoachLiveLaunchPacket"
FOR EACH ROW EXECUTE FUNCTION "guard_ai_coach_live_launch_packet"();

CREATE FUNCTION "prevent_ai_coach_live_launch_packet_delete"()
RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'AI Coach live-launch packet versions cannot be deleted'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachLiveLaunchPacket_delete_guard"
BEFORE DELETE ON "AiCoachLiveLaunchPacket"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_live_launch_packet_delete"();

CREATE TRIGGER "AiCoachLiveLaunchLifecycleEvent_update_guard"
BEFORE UPDATE ON "AiCoachLiveLaunchLifecycleEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_append_only_update"();
