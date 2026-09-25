-- T-996: the STEADFAST_CONSTRAINED_JSON_V1 gateway contract had no implementation
-- anywhere in either repo (see the T-996 ticket evidence). This replaces the DB-side
-- runtime-configuration guard's provider predicate with the Anthropic-direct shape
-- (`vendor`, `apiBaseUrl`, `organizationDataControlsRecordId`; `protocol`/`gatewayUrl`
-- removed) using CREATE OR REPLACE FUNCTION so the existing
-- "AiCoachLiveLaunchPacket_runtime_configuration_guard" trigger stays bound to this
-- function without being re-created. Copied verbatim from
-- prisma/migrations/20260922010000_ai_coach_governed_activation/migration.sql:183-220
-- except the provider predicate block (lines 195-196 there).
CREATE OR REPLACE FUNCTION "guard_ai_coach_live_launch_runtime_configuration"()
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
       NEW."packet"->'runtimeConfiguration'->'provider'->>'vendor' <> 'ANTHROPIC' OR
       NEW."packet"->'runtimeConfiguration'->'provider' ? 'protocol' OR
       NEW."packet"->'runtimeConfiguration'->'provider' ? 'gatewayUrl' OR
       NEW."packet"->'runtimeConfiguration'->'provider'->>'apiBaseUrl' <> 'https://api.anthropic.com' OR
       NULLIF(btrim(NEW."packet"->'runtimeConfiguration'->'provider'->>'modelIdentifier'), '') IS NULL OR
       NULLIF(btrim(NEW."packet"->'runtimeConfiguration'->'provider'->>'organizationDataControlsRecordId'), '') IS NULL OR
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
