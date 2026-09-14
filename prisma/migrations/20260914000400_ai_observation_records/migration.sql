CREATE TABLE "AiCheckInObservation" (
  "id" TEXT NOT NULL PRIMARY KEY, "clientId" TEXT NOT NULL, "clientEventId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL, "payload" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "submitted" BOOLEAN NOT NULL DEFAULT false, "inputDigest" TEXT NOT NULL, "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiCheckInObservation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiCheckInObservation_clientId_clientEventId_key" ON "AiCheckInObservation"("clientId", "clientEventId");
CREATE INDEX "AiCheckInObservation_clientId_occurredAt_idx" ON "AiCheckInObservation"("clientId", "occurredAt");
