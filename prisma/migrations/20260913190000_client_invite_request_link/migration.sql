-- AlterTable
ALTER TABLE "ClientInvite" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvite_requestId_key" ON "ClientInvite"("requestId");

-- AddForeignKey
ALTER TABLE "ClientInvite" ADD CONSTRAINT "ClientInvite_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
