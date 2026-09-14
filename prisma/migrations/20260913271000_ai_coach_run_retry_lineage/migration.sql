-- AlterTable
ALTER TABLE "AiCoachRun" ADD COLUMN     "retryOfRunId" TEXT;

-- AddForeignKey
ALTER TABLE "AiCoachRun" ADD CONSTRAINT "AiCoachRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "AiCoachRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
