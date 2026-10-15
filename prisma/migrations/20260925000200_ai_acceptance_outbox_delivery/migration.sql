-- T-502 — acceptance-notification outbox delivery state (additive only)
-- CreateEnum
CREATE TYPE "AiNotificationOutcome" AS ENUM ('DELIVERED', 'SUPPRESSED_PREFERENCE', 'SUPPRESSED_NO_DEVICE', 'SUPPRESSED_ACCOUNT_CLOSED', 'SUPPRESSED_SUPERSEDED', 'SUPPRESSED_STALE', 'ABANDONED');

-- AlterTable
ALTER TABLE "AiPlanAcceptanceOutbox" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryOutcome" "AiNotificationOutcome",
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AiPlanAcceptanceOutbox_processedAt_nextAttemptAt_idx" ON "AiPlanAcceptanceOutbox"("processedAt", "nextAttemptAt");
