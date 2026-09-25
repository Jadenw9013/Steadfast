CREATE TYPE "AiNutritionSafetyOutcome" AS ENUM ('PASS', 'HOLD', 'PAUSE_REFER');

CREATE TABLE "AiNutritionSafetyDecision" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "evaluationKey" TEXT NOT NULL,
  "policyArtifactId" TEXT NOT NULL,
  "policyArtifactVersion" INTEGER NOT NULL,
  "policyArtifactDigest" TEXT NOT NULL,
  "outcome" "AiNutritionSafetyOutcome" NOT NULL,
  "reasonCodes" TEXT[] NOT NULL,
  "ruleIds" TEXT[] NOT NULL,
  "escalationTemplateIds" TEXT[] NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "sourcePlanVersionIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiNutritionSafetyDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiNutritionSafetyDecision_policy_version_positive"
    CHECK ("policyArtifactVersion" > 0),
  CONSTRAINT "AiNutritionSafetyDecision_policy_digest_sha256"
    CHECK ("policyArtifactDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiNutritionSafetyDecision_input_digest_sha256"
    CHECK ("inputDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiNutritionSafetyDecision_evaluation_key_sha256"
    CHECK ("evaluationKey" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "AiNutritionSafetyDecision_clientId_createdAt_idx"
  ON "AiNutritionSafetyDecision"("clientId", "createdAt");

CREATE INDEX "AiNutritionSafetyDecision_clientId_evaluationKey_idx"
  ON "AiNutritionSafetyDecision"("clientId", "evaluationKey");

ALTER TABLE "AiNutritionSafetyDecision"
  ADD CONSTRAINT "AiNutritionSafetyDecision_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_ai_nutrition_safety_decision_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AI nutrition safety decisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiNutritionSafetyDecision_update_guard"
BEFORE UPDATE ON "AiNutritionSafetyDecision"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_nutrition_safety_decision_update"();
