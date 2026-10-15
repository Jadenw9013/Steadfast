-- AlterTable
ALTER TABLE "AiPlanVersion" ADD COLUMN     "declineReason" TEXT;

-- CreateTable
CREATE TABLE "AiPlanAcceptanceReceipt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "alreadyAccepted" BOOLEAN NOT NULL,
    "activeVersionIdAtReceiptTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPlanAcceptanceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanAcceptanceOutbox" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AiPlanAcceptanceOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanAcceptanceReceipt_clientId_requestKey_key" ON "AiPlanAcceptanceReceipt"("clientId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanAcceptanceOutbox_planVersionId_key" ON "AiPlanAcceptanceOutbox"("planVersionId");

-- AddForeignKey
ALTER TABLE "AiPlanAcceptanceReceipt" ADD CONSTRAINT "AiPlanAcceptanceReceipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanAcceptanceOutbox" ADD CONSTRAINT "AiPlanAcceptanceOutbox_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanAcceptanceOutbox" ADD CONSTRAINT "AiPlanAcceptanceOutbox_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "AiPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
