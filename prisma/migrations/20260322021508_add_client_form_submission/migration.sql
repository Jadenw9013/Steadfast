-- CreateEnum
CREATE TYPE "FormSubmissionStatus" AS ENUM ('DRAFT', 'READY_TO_SEND', 'SENT', 'SIGNED');

-- CreateTable
CREATE TABLE "ClientFormSubmission" (
    "id" TEXT NOT NULL,
    "coachingRequestId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "FormSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientFormSubmission_coachingRequestId_key" ON "ClientFormSubmission"("coachingRequestId");

-- AddForeignKey
ALTER TABLE "ClientFormSubmission" ADD CONSTRAINT "ClientFormSubmission_coachingRequestId_fkey" FOREIGN KEY ("coachingRequestId") REFERENCES "CoachingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
