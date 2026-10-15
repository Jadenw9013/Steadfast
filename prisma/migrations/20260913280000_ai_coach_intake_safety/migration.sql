-- CreateEnum
CREATE TYPE "AiSafetyDisposition" AS ENUM ('CLEAR', 'CLARIFY', 'RESTRICTED', 'REFER', 'URGENT');

-- CreateEnum
CREATE TYPE "AiDomainPermission" AS ENUM ('ALLOW', 'HOLD_ONLY', 'PAUSED');

-- AlterTable
ALTER TABLE "AiCoachProfile" ADD COLUMN     "cardioPermission" "AiDomainPermission" NOT NULL DEFAULT 'ALLOW',
ADD COLUMN     "confirmedIntake" JSONB,
ADD COLUMN     "nutritionPermission" "AiDomainPermission" NOT NULL DEFAULT 'ALLOW',
ADD COLUMN     "safetyDisposition" "AiSafetyDisposition" NOT NULL DEFAULT 'CLEAR',
ADD COLUMN     "strengthPermission" "AiDomainPermission" NOT NULL DEFAULT 'ALLOW';

-- CreateTable
CREATE TABLE "AiIntakeDraft" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiIntakeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSafetyDisclosureEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "structuredAnswers" JSONB NOT NULL,
    "dispositionAfter" "AiSafetyDisposition" NOT NULL,
    "nutritionPermissionAfter" "AiDomainPermission" NOT NULL,
    "strengthPermissionAfter" "AiDomainPermission" NOT NULL,
    "cardioPermissionAfter" "AiDomainPermission" NOT NULL,
    "safetyRevisionAfter" INTEGER NOT NULL,

    CONSTRAINT "AiSafetyDisclosureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiIntakeDraft_clientId_key" ON "AiIntakeDraft"("clientId");

-- CreateIndex
CREATE INDEX "AiSafetyDisclosureEvent_clientId_reportedAt_idx" ON "AiSafetyDisclosureEvent"("clientId", "reportedAt");

-- AddForeignKey
ALTER TABLE "AiIntakeDraft" ADD CONSTRAINT "AiIntakeDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSafetyDisclosureEvent" ADD CONSTRAINT "AiSafetyDisclosureEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

