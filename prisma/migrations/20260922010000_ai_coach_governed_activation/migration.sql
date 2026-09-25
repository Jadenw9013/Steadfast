CREATE TYPE "AiCoachLiveActivationState" AS ENUM ('ACTIVE', 'DEACTIVATED');
CREATE TYPE "AiCoachLiveActivationAction" AS ENUM ('ACTIVATE', 'DEACTIVATE');

ALTER TABLE "AiCoachProfile"
  ADD COLUMN "consentReleaseId" TEXT,
  ADD COLUMN "consentConfigurationDigest" TEXT,
  ADD COLUMN "consentConfigurationId" TEXT,
  ADD COLUMN "consentConfigurationVersion" INTEGER,
  ADD COLUMN "consentPrivacyNoticeVersion" TEXT,
  ADD COLUMN "consentTextDigest" TEXT;

CREATE TABLE "AiCoachProviderTransitionReceipt" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "fromMode" "CoachingMode" NOT NULL,
  "fromContextRevision" INTEGER NOT NULL,
  "toMode" "CoachingMode" NOT NULL,
  "toContextRevision" INTEGER NOT NULL,
  "releaseId" TEXT NOT NULL,
  "runtimeConfigurationDigest" TEXT NOT NULL,
  "discoveryConfigurationId" TEXT NOT NULL,
  "discoveryConfigurationVersion" INTEGER NOT NULL,
  "privacyNoticeVersion" TEXT NOT NULL,
  "consentTextDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCoachProviderTransitionReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiCoachProviderTransitionReceipt_configuration_digest" CHECK ("runtimeConfigurationDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiCoachProviderTransitionReceipt_consent_digest" CHECK ("consentTextDigest" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "AiCoachProviderTransitionReceipt_clientId_createdAt_idx"
  ON "AiCoachProviderTransitionReceipt"("clientId", "createdAt");
ALTER TABLE "AiCoachProviderTransitionReceipt" ADD CONSTRAINT "AiCoachProviderTransitionReceipt_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AiCoachLiveActivation" (
  "id" TEXT NOT NULL,
  "state" "AiCoachLiveActivationState" NOT NULL,
  "packetId" TEXT NOT NULL,
  "packetDigest" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "runtimeConfigurationDigest" TEXT NOT NULL,
  "signedActivationRef" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMP(3),
  "deactivationReason" TEXT,
  CONSTRAINT "AiCoachLiveActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiCoachLiveActivation_packet_digest" CHECK ("packetDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiCoachLiveActivation_configuration_digest" CHECK ("runtimeConfigurationDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiCoachLiveActivation_revision" CHECK ("revision" >= 0)
);

CREATE UNIQUE INDEX "AiCoachLiveActivation_packetId_key" ON "AiCoachLiveActivation"("packetId");
CREATE UNIQUE INDEX "AiCoachLiveActivation_releaseId_key" ON "AiCoachLiveActivation"("releaseId");
CREATE UNIQUE INDEX "AiCoachLiveActivation_single_active_key"
  ON "AiCoachLiveActivation" ((true)) WHERE "state" = 'ACTIVE';
CREATE INDEX "AiCoachLiveActivation_state_activatedAt_idx"
  ON "AiCoachLiveActivation"("state", "activatedAt");
ALTER TABLE "AiCoachLiveActivation" ADD CONSTRAINT "AiCoachLiveActivation_packetId_fkey"
  FOREIGN KEY ("packetId") REFERENCES "AiCoachLiveLaunchPacket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AiCoachLiveActivationEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "governanceGrantId" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "packetId" TEXT NOT NULL,
  "action" "AiCoachLiveActivationAction" NOT NULL,
  "packetDigest" TEXT NOT NULL,
  "runtimeConfigurationDigest" TEXT NOT NULL,
  "signedActivationRef" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "incidentReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCoachLiveActivationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiCoachLiveActivationEvent_packet_digest" CHECK ("packetDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiCoachLiveActivationEvent_configuration_digest" CHECK ("runtimeConfigurationDigest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "AiCoachLiveActivationEvent_activationId_createdAt_idx"
  ON "AiCoachLiveActivationEvent"("activationId", "createdAt");
CREATE INDEX "AiCoachLiveActivationEvent_packetId_createdAt_idx"
  ON "AiCoachLiveActivationEvent"("packetId", "createdAt");
ALTER TABLE "AiCoachLiveActivationEvent" ADD CONSTRAINT "AiCoachLiveActivationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Correct the preserved v1 validator's JSON-operator precedence in its legal
-- jurisdiction equality check. This is a forward replacement: the historical
-- migration remains byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION "validate_ai_coach_live_launch_approval"(candidate JSONB, approved_at TIMESTAMP)
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
         (item->'jurisdictions') @> (candidate->'jurisdictions') AND
         (candidate->'jurisdictions') @> (item->'jurisdictions')
       )) OR
       NULLIF(item->>'recordId', '') IS NULL OR
       NULLIF(item->>'recordDigest', '') IS NULL OR
       item->'signature' IS NULL OR item->'signature' = 'null'::jsonb OR
       item->'signature'->>'digest' IS DISTINCT FROM item->>'recordDigest' OR
       NULLIF(item->>'signedAt', '') IS NULL OR
       NULLIF(item->>'expiresAt', '') IS NULL OR
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

-- A second DB-side check complements the original packet lifecycle trigger.
-- It cannot reproduce the application's canonical JSON hashing without adding
-- an extension, so the repository remains responsible for recomputing the
-- configuration digest. The database independently requires the exact digest
-- to be bound by every approval and evidence record before approval.
CREATE FUNCTION "guard_ai_coach_live_launch_runtime_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  item JSONB;
  configuration_digest TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."state" = 'DRAFT' AND NEW."state" = 'APPROVED' THEN
    configuration_digest := NEW."packet"->>'runtimeConfigurationDigest';
    IF NEW."packet"->'runtimeConfiguration' IS NULL OR
       NEW."packet"->'runtimeConfiguration' = 'null'::jsonb OR
       jsonb_typeof(NEW."packet"->'runtimeConfiguration') <> 'object' OR
       configuration_digest IS NULL OR configuration_digest !~ '^[a-f0-9]{64}$' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'protocol' <> 'STEADFAST_CONSTRAINED_JSON_V1' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'credentialEnvironmentVariable' <> 'AI_COACH_PROVIDER_CREDENTIAL' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'requestStorage' <> 'DISABLED' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'trainingUse' <> 'DISABLED' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'sendsDirectIdentifiers' IS DISTINCT FROM 'false' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'sendsCrossClientContext' IS DISTINCT FROM 'false' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'rawPromptOrTraceLogging' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'AI Coach live launch requires an approved constrained runtime configuration';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(NEW."packet"->'approvals') LOOP
      IF item->>'subjectConfigurationDigest' IS DISTINCT FROM configuration_digest THEN
        RAISE EXCEPTION 'AI Coach approval is not bound to the runtime configuration digest';
      END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW."packet"->'evidence') LOOP
      IF item->>'subjectConfigurationDigest' IS DISTINCT FROM configuration_digest THEN
        RAISE EXCEPTION 'AI Coach evidence is not bound to the runtime configuration digest';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR data_exception THEN
  RAISE EXCEPTION 'AI Coach runtime configuration is malformed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachLiveLaunchPacket_runtime_configuration_guard"
BEFORE UPDATE ON "AiCoachLiveLaunchPacket"
FOR EACH ROW EXECUTE FUNCTION "guard_ai_coach_live_launch_runtime_configuration"();

CREATE FUNCTION "guard_ai_coach_live_activation"()
RETURNS TRIGGER AS $$
DECLARE
  lifecycle_action TEXT := current_setting('steadfast.ai_coach_live_activation_action', true);
  packet_row "AiCoachLiveLaunchPacket"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF lifecycle_action IS DISTINCT FROM 'ACTIVATE' OR NEW."state" <> 'ACTIVE' OR
       NEW."revision" <> 0 OR NEW."deactivatedAt" IS NOT NULL OR
       NEW."deactivationReason" IS NOT NULL OR
       NULLIF(btrim(NEW."signedActivationRef"), '') IS NULL OR
       NULLIF(btrim(NEW."reasonCode"), '') IS NULL THEN
      RAISE EXCEPTION 'AI Coach live activation requires the governed activation workflow';
    END IF;
    SELECT * INTO packet_row FROM "AiCoachLiveLaunchPacket" WHERE "id" = NEW."packetId" FOR SHARE;
    IF NOT FOUND OR packet_row."state" <> 'APPROVED' OR packet_row."testOnly" OR
       packet_row."revokedAt" IS NOT NULL OR packet_row."effectiveAt" IS NULL OR
       packet_row."effectiveAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') OR
       packet_row."expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') OR
       NEW."packetDigest" IS DISTINCT FROM packet_row."contentDigest" OR
       NEW."releaseId" IS DISTINCT FROM packet_row."releaseId" OR
       NEW."runtimeConfigurationDigest" IS DISTINCT FROM packet_row."packet"->>'runtimeConfigurationDigest' THEN
      RAISE EXCEPTION 'AI Coach live activation requires the exact current approved packet';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'ACTIVE' AND NEW."state" = 'DEACTIVATED' AND lifecycle_action = 'DEACTIVATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."packetId" IS DISTINCT FROM OLD."packetId" OR
       NEW."packetDigest" IS DISTINCT FROM OLD."packetDigest" OR
       NEW."releaseId" IS DISTINCT FROM OLD."releaseId" OR
       NEW."runtimeConfigurationDigest" IS DISTINCT FROM OLD."runtimeConfigurationDigest" OR
       NEW."signedActivationRef" IS DISTINCT FROM OLD."signedActivationRef" OR
       NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode" OR
       NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" OR
       NEW."revision" <> OLD."revision" + 1 OR NEW."deactivatedAt" IS NULL OR
       NULLIF(btrim(NEW."deactivationReason"), '') IS NULL THEN
      RAISE EXCEPTION 'AI Coach live deactivation must preserve immutable activation evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid or unauthorized AI Coach live activation transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachLiveActivation_lifecycle_guard"
BEFORE INSERT OR UPDATE ON "AiCoachLiveActivation"
FOR EACH ROW EXECUTE FUNCTION "guard_ai_coach_live_activation"();

CREATE TRIGGER "AiCoachLiveActivation_delete_guard"
BEFORE DELETE ON "AiCoachLiveActivation"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_live_launch_packet_delete"();

CREATE TRIGGER "AiCoachLiveActivationEvent_update_guard"
BEFORE UPDATE ON "AiCoachLiveActivationEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_append_only_update"();
