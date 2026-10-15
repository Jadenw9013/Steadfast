ALTER TABLE "AiCoachProfile" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiCoachRun" ADD COLUMN "inputSnapshot" JSONB, ADD COLUMN "resultDecision" JSONB;
ALTER TABLE "AiPlanVersion" ADD COLUMN "reviewWindowKey" TEXT, ADD COLUMN "validationReport" JSONB, ADD COLUMN "sourceRefs" JSONB;
CREATE TABLE "AiOperationReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY, "clientId" TEXT NOT NULL, "operation" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL, "inputDigest" TEXT NOT NULL, "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiOperationReceipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiOperationReceipt_clientId_operation_requestKey_key" ON "AiOperationReceipt"("clientId", "operation", "requestKey");
