CREATE TYPE "AiCoachArtifactKind" AS ENUM (
  'POLICY_BUNDLE',
  'FOOD_CATALOG',
  'EXERCISE_CATALOG',
  'EVIDENCE_REGISTRY',
  'ESCALATION_TEMPLATES'
);

CREATE TYPE "AiCoachArtifactState" AS ENUM ('DRAFT', 'PUBLISHED', 'REVOKED');

CREATE TABLE "AiCoachArtifactVersion" (
  "id" TEXT NOT NULL,
  "artifactKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "kind" "AiCoachArtifactKind" NOT NULL,
  "state" "AiCoachArtifactState" NOT NULL DEFAULT 'DRAFT',
  "schemaVersion" INTEGER NOT NULL,
  "engineVersions" TEXT[] NOT NULL,
  "dependencies" JSONB NOT NULL,
  "content" JSONB NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "synthetic" BOOLEAN NOT NULL,
  "reviewMetadata" JSONB NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiCoachArtifactVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiCoachArtifactVersion_positive_version" CHECK ("version" > 0),
  CONSTRAINT "AiCoachArtifactVersion_sha256_digest" CHECK ("contentDigest" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "AiCoachArtifactVersion_kind_artifactKey_version_key"
  ON "AiCoachArtifactVersion"("kind", "artifactKey", "version");

CREATE INDEX "AiCoachArtifactVersion_kind_artifactKey_state_effectiveAt_idx"
  ON "AiCoachArtifactVersion"("kind", "artifactKey", "state", "effectiveAt");

CREATE FUNCTION "enforce_ai_coach_artifact_insert"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."state" <> 'DRAFT'
     OR NEW."effectiveAt" IS NOT NULL
     OR NEW."expiresAt" IS NOT NULL
     OR NEW."publishedAt" IS NOT NULL
     OR NEW."revokedAt" IS NOT NULL
     OR NEW."revocationReason" IS NOT NULL THEN
    RAISE EXCEPTION 'AI Coach artifact versions must be inserted as DRAFT without publication or revocation metadata';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachArtifactVersion_insert_guard"
BEFORE INSERT ON "AiCoachArtifactVersion"
FOR EACH ROW EXECUTE FUNCTION "enforce_ai_coach_artifact_insert"();

CREATE FUNCTION "enforce_ai_coach_artifact_lifecycle"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."artifactKey", NEW."version", NEW."kind",
    NEW."schemaVersion", NEW."engineVersions", NEW."dependencies",
    NEW."content", NEW."contentDigest", NEW."synthetic",
    NEW."reviewMetadata", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."artifactKey", OLD."version", OLD."kind",
    OLD."schemaVersion", OLD."engineVersions", OLD."dependencies",
    OLD."content", OLD."contentDigest", OLD."synthetic",
    OLD."reviewMetadata", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'AI Coach artifact identity, content, compatibility, review metadata and digest are immutable';
  END IF;

  IF OLD."state" = 'DRAFT' AND NEW."state" = 'PUBLISHED' THEN
    IF current_setting('steadfast.ai_coach_artifact_lifecycle_action', true) IS DISTINCT FROM 'PUBLISH'
       OR NEW."publishedAt" IS NULL OR NEW."effectiveAt" IS NULL OR NEW."expiresAt" IS NULL
       OR NEW."expiresAt" <= NEW."effectiveAt" OR NEW."revokedAt" IS NOT NULL
       OR NEW."revocationReason" IS NOT NULL THEN
      RAISE EXCEPTION 'published AI Coach artifacts require validated repository publication and a valid effective/expiry window';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'PUBLISHED' AND NEW."state" = 'REVOKED' THEN
    IF current_setting('steadfast.ai_coach_artifact_lifecycle_action', true) IS DISTINCT FROM 'REVOKE'
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
       OR NEW."revokedAt" IS NULL OR NEW."revocationReason" IS NULL
       OR length(btrim(NEW."revocationReason")) = 0 THEN
      RAISE EXCEPTION 'revoked AI Coach artifacts require validated repository revocation, an immutable publication window and a reason';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid AI Coach artifact lifecycle transition from % to %', OLD."state", NEW."state";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachArtifactVersion_lifecycle_guard"
BEFORE UPDATE ON "AiCoachArtifactVersion"
FOR EACH ROW EXECUTE FUNCTION "enforce_ai_coach_artifact_lifecycle"();

CREATE FUNCTION "prevent_ai_coach_artifact_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AI Coach artifact versions are retained; revoke instead of deleting';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachArtifactVersion_delete_guard"
BEFORE DELETE ON "AiCoachArtifactVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_artifact_delete"();
