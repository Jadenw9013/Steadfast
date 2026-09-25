-- T-987: reconcile the "accept from any verified address" acceptance rule
-- into the sprint branch's CB01 service. These three columns record, on the
-- ClientInvite row, whether the client who redeemed it did so from an
-- address other than the one the coach typed, and whether they confirmed
-- it explicitly. Additive only; nullable/defaulted so existing rows and the
-- reverted code both remain valid.
-- AlterTable
ALTER TABLE "ClientInvite" ADD COLUMN     "acceptedWithMismatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mismatchEmail" TEXT,
ADD COLUMN     "mismatchSeenAt" TIMESTAMP(3);
