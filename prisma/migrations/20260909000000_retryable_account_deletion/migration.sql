DO $$ BEGIN
  CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'PURGING', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDeactivated" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
  "id" TEXT PRIMARY KEY, "userId" TEXT UNIQUE, "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "scheduledPurgeAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3), "purgeStartedAt" TIMESTAMP(3), "purgeCompletedAt" TIMESTAMP(3),
  "deletionReason" TEXT, "roleAtRequest" TEXT NOT NULL, "clerkId" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0,
  "stripeSubscriptionCancelledAt" TIMESTAMP(3), "storageCleanedAt" TIMESTAMP(3), "clerkDeletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
-- Keep the deletion receipt without altering constraints during a purge.
ALTER TABLE "AccountDeletionRequest" DROP CONSTRAINT IF EXISTS "AccountDeletionRequest_userId_fkey";
ALTER TABLE "AccountDeletionRequest" ALTER COLUMN "userId" DROP NOT NULL;
-- Repair orphan receipts left by the legacy purge implementation.
UPDATE "AccountDeletionRequest" r SET "userId" = NULL
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = r."userId");
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
