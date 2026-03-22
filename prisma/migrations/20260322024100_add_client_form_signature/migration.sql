-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('TYPED', 'DRAWN');

-- CreateTable
CREATE TABLE "ClientFormSignature" (
    "id" TEXT NOT NULL,
    "coachingRequestId" TEXT NOT NULL,
    "signatureType" "SignatureType" NOT NULL,
    "signatureValue" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFormSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientFormSignature_coachingRequestId_key" ON "ClientFormSignature"("coachingRequestId");

-- AddForeignKey
ALTER TABLE "ClientFormSignature" ADD CONSTRAINT "ClientFormSignature_coachingRequestId_fkey" FOREIGN KEY ("coachingRequestId") REFERENCES "CoachingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
