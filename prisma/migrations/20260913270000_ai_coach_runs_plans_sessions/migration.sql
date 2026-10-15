-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('INITIAL', 'WEEKLY_REVIEW', 'REPRESENTATION');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiChangeClass" AS ENUM ('INITIAL', 'ROUTINE', 'TARGET_PRESERVING', 'PROTECTIVE');

-- CreateEnum
CREATE TYPE "AiPlanStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "AiReviewerStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiLoadKind" AS ENUM ('EXTERNAL', 'BODYWEIGHT', 'ASSISTED');

-- CreateEnum
CREATE TYPE "AiReviewAction" AS ENUM ('HOLD', 'SIMPLIFY', 'ADJUST', 'CLARIFY', 'PAUSE_REFER');

-- CreateTable
CREATE TABLE "AiCoachRun" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "businessKey" TEXT NOT NULL,
    "contextRevision" INTEGER NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "observationRevision" INTEGER NOT NULL,
    "safetyRevision" INTEGER NOT NULL,
    "lookbackStart" TIMESTAMP(3),
    "lookbackEnd" TIMESTAMP(3),
    "snapshotCutoffAt" TIMESTAMP(3),
    "activationStartsAt" TIMESTAMP(3),
    "activationEndsAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryGeneration" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "resultPlanVersionId" TEXT,
    "resultReviewAction" "AiReviewAction",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCoachRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanVersion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "status" "AiPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "changeClass" "AiChangeClass",
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "contextRevision" INTEGER NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "observationRevision" INTEGER NOT NULL,
    "safetyRevision" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "catalogVersions" JSONB NOT NULL,
    "activationStartsAt" TIMESTAMP(3),
    "activationEndsAt" TIMESTAMP(3),
    "reviewerStatus" "AiReviewerStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewerApprovalHash" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAdjustmentSlot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reviewWindowKey" TEXT NOT NULL,
    "acceptedPlanVersionId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAdjustmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachReviewerGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qualificationNote" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AiCoachReviewerGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanReviewerApproval" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "reviewerGrantId" TEXT NOT NULL,
    "approvedHash" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "rationale" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPlanReviewerApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkoutSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL,
    "reps" INTEGER,
    "loadValue" DOUBLE PRECISION,
    "loadUnit" TEXT,
    "loadKind" "AiLoadKind" NOT NULL,
    "painNote" TEXT,
    "effortNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachRun_businessKey_key" ON "AiCoachRun"("businessKey");

-- CreateIndex
CREATE INDEX "AiCoachRun_clientId_idx" ON "AiCoachRun"("clientId");

-- CreateIndex
CREATE INDEX "AiCoachRun_status_leaseExpiresAt_idx" ON "AiCoachRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AiPlanVersion_clientId_status_idx" ON "AiPlanVersion"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanVersion_clientId_version_key" ON "AiPlanVersion"("clientId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AiAdjustmentSlot_acceptedPlanVersionId_key" ON "AiAdjustmentSlot"("acceptedPlanVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiAdjustmentSlot_clientId_reviewWindowKey_key" ON "AiAdjustmentSlot"("clientId", "reviewWindowKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachReviewerGrant_userId_key" ON "AiCoachReviewerGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanReviewerApproval_planVersionId_key" ON "AiPlanReviewerApproval"("planVersionId");

-- CreateIndex
CREATE INDEX "AiWorkoutSession_clientId_occurredAt_idx" ON "AiWorkoutSession"("clientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiWorkoutSession_clientId_clientEventId_key" ON "AiWorkoutSession"("clientId", "clientEventId");

-- AddForeignKey
ALTER TABLE "AiCoachRun" ADD CONSTRAINT "AiCoachRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanVersion" ADD CONSTRAINT "AiPlanVersion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanVersion" ADD CONSTRAINT "AiPlanVersion_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAdjustmentSlot" ADD CONSTRAINT "AiAdjustmentSlot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAdjustmentSlot" ADD CONSTRAINT "AiAdjustmentSlot_acceptedPlanVersionId_fkey" FOREIGN KEY ("acceptedPlanVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachReviewerGrant" ADD CONSTRAINT "AiCoachReviewerGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanReviewerApproval" ADD CONSTRAINT "AiPlanReviewerApproval_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanReviewerApproval" ADD CONSTRAINT "AiPlanReviewerApproval_reviewerGrantId_fkey" FOREIGN KEY ("reviewerGrantId") REFERENCES "AiCoachReviewerGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkoutSession" ADD CONSTRAINT "AiWorkoutSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkoutSession" ADD CONSTRAINT "AiWorkoutSession_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

