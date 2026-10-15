-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "coachId" TEXT;

-- CreateIndex
CREATE INDEX "Message_clientId_coachId_idx" ON "Message"("clientId", "coachId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conservative backfill (CB03): a message NOT authored by the client was
-- authored by a coach, so its sender unambiguously identifies which
-- conversation it belongs to. A message authored BY the client is left
-- with coachId = NULL — after a coach relationship ends, CoachClient rows
-- are hard-deleted with no history, so which coach an old client-authored
-- reply was addressed to cannot be reconstructed. NULL-coachId messages
-- remain visible only in the client's own archive (getAllMessages/
-- getMessages are never coach-filtered), never surfaced to any coach.
UPDATE "Message" SET "coachId" = "senderId" WHERE "senderId" != "clientId";
