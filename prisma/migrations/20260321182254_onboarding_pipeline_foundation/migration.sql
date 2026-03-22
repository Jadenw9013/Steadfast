-- CreateEnum
CREATE TYPE "ConsultationStage" AS ENUM ('PENDING', 'CONSULTATION_SCHEDULED', 'CONSULTATION_DONE', 'FORMS_SENT', 'FORMS_SIGNED', 'ACTIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MARKETPLACE', 'EXTERNAL');

-- AlterTable
ALTER TABLE "CoachingRequest" ADD COLUMN "prospectPhone" TEXT,
ADD COLUMN "prospectEmailAddr" TEXT,
ADD COLUMN "consultationStage" "ConsultationStage" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "consultationDate" TIMESTAMP(3),
ADD COLUMN "source" "LeadSource" NOT NULL DEFAULT 'MARKETPLACE',
ADD COLUMN "formsToken" TEXT,
ADD COLUMN "formsTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "formsSentAt" TIMESTAMP(3),
ADD COLUMN "formsSignedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "CoachingRequest_formsToken_key" ON "CoachingRequest"("formsToken");

-- CreateIndex
CREATE INDEX "CoachingRequest_consultationStage_idx" ON "CoachingRequest"("consultationStage");
