-- T-995 — append-only provisioning history for the three AI Coach
-- permission tables (AiCoachGovernanceGrant, AiCoachReviewerGrant,
-- AiCoachEntitlement). Fully additive. `governanceGrantId` is deliberately
-- not an FK — same reasoning as AiCoachOperationalControl.updatedByGrantId
-- (schema.prisma) — purging the granting user must not block or cascade
-- into the audit row of a different user.

-- CreateEnum
CREATE TYPE "AiCoachAccessGrantType" AS ENUM ('GOVERNANCE', 'REVIEWER', 'ENTITLEMENT');

-- CreateEnum
CREATE TYPE "AiCoachAccessGrantAction" AS ENUM ('BOOTSTRAP', 'GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "AiCoachAccessGrantEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "governanceGrantId" TEXT NOT NULL,
    "grantType" "AiCoachAccessGrantType" NOT NULL,
    "action" "AiCoachAccessGrantAction" NOT NULL,
    "grantRecordId" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "clientIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "grantRef" TEXT,
    "actorRef" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCoachAccessGrantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCoachAccessGrantEvent_subjectUserId_createdAt_idx" ON "AiCoachAccessGrantEvent"("subjectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCoachAccessGrantEvent_grantType_createdAt_idx" ON "AiCoachAccessGrantEvent"("grantType", "createdAt");

-- AddForeignKey
ALTER TABLE "AiCoachAccessGrantEvent" ADD CONSTRAINT "AiCoachAccessGrantEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachAccessGrantEvent" ADD CONSTRAINT "AiCoachAccessGrantEvent_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only guard. Deviation from the frozen spec text, proven necessary
-- by a failing test (SECURITY_INTEGRATION=1 tests/integration/account-deletion.test.ts
-- "purges AI Coach records (A02/A03) on account deletion" — P0001 "AI Coach
-- audit records are append-only" raised by the shared
-- `prevent_ai_coach_append_only_update()` function against purge's own
-- `UPDATE ... SET "clientIds" = array_remove(...)` scrub line, which the
-- spec also requires verbatim): the shared trigger function blocks EVERY
-- update unconditionally, including the one purge-only `clientIds` scrub
-- this table's own spec mandates. Every other append-only table purge.ts
-- touches is DELETE-only (no PII array column to scrub), so this collision
-- is new to this table. Fixed the same way this codebase already gates a
-- single controlled write through an otherwise-blocking trigger elsewhere
-- (`current_setting('steadfast.ai_coach_live_activation_action', ...)` in
-- 20260921000000_ai_coach_reviewed_artifacts and
-- 20260922010000_ai_coach_governed_activation): a dedicated guard function
-- permits an UPDATE only when every column except `clientIds` is unchanged
-- AND the session flag `steadfast.ai_coach_access_grant_purge` is set to
-- 'true' (set only by lib/account-deletion/purge.ts, `true` = local to the
-- transaction). Every other update, and any change to any other column, is
-- still rejected with the same message. DELETE remains unrestricted.
CREATE FUNCTION "prevent_ai_coach_access_grant_event_content_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('steadfast.ai_coach_access_grant_purge', true) IS DISTINCT FROM 'true'
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId"
     OR NEW."subjectUserId" IS DISTINCT FROM OLD."subjectUserId"
     OR NEW."governanceGrantId" IS DISTINCT FROM OLD."governanceGrantId"
     OR NEW."grantType" IS DISTINCT FROM OLD."grantType"
     OR NEW."action" IS DISTINCT FROM OLD."action"
     OR NEW."grantRecordId" IS DISTINCT FROM OLD."grantRecordId"
     OR NEW."scopes" IS DISTINCT FROM OLD."scopes"
     OR NEW."domains" IS DISTINCT FROM OLD."domains"
     OR NEW."grantRef" IS DISTINCT FROM OLD."grantRef"
     OR NEW."actorRef" IS DISTINCT FROM OLD."actorRef"
     OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'AI Coach audit records are append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCoachAccessGrantEvent_update_guard" BEFORE UPDATE ON "AiCoachAccessGrantEvent"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ai_coach_access_grant_event_content_update"();
