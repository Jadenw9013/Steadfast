-- CreateEnum
CREATE TYPE "CoachDocumentType" AS ENUM ('TEXT', 'FILE');

-- CreateTable
CREATE TABLE "CoachDocument" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "CoachDocumentType" NOT NULL,
    "content" TEXT,
    "filePath" TEXT,
    "fileType" TEXT,
    "fileName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakePacket" (
    "id" TEXT NOT NULL,
    "coachingRequestId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "formAnswers" JSONB,
    "coachNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakePacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakePacketDocument" (
    "id" TEXT NOT NULL,
    "intakePacketId" TEXT NOT NULL,
    "coachDocumentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IntakePacketDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignature" (
    "id" TEXT NOT NULL,
    "intakePacketDocumentId" TEXT NOT NULL,
    "coachDocumentId" TEXT NOT NULL,
    "signatureType" "SignatureType" NOT NULL,
    "signatureValue" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "DocumentSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachDocument_coachId_idx" ON "CoachDocument"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakePacket_coachingRequestId_key" ON "IntakePacket"("coachingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakePacket_token_key" ON "IntakePacket"("token");

-- CreateIndex
CREATE INDEX "IntakePacketDocument_intakePacketId_idx" ON "IntakePacketDocument"("intakePacketId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignature_intakePacketDocumentId_key" ON "DocumentSignature"("intakePacketDocumentId");

-- AddForeignKey
ALTER TABLE "CoachDocument" ADD CONSTRAINT "CoachDocument_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacket" ADD CONSTRAINT "IntakePacket_coachingRequestId_fkey" FOREIGN KEY ("coachingRequestId") REFERENCES "CoachingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacketDocument" ADD CONSTRAINT "IntakePacketDocument_intakePacketId_fkey" FOREIGN KEY ("intakePacketId") REFERENCES "IntakePacket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacketDocument" ADD CONSTRAINT "IntakePacketDocument_coachDocumentId_fkey" FOREIGN KEY ("coachDocumentId") REFERENCES "CoachDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignature" ADD CONSTRAINT "DocumentSignature_intakePacketDocumentId_fkey" FOREIGN KEY ("intakePacketDocumentId") REFERENCES "IntakePacketDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignature" ADD CONSTRAINT "DocumentSignature_coachDocumentId_fkey" FOREIGN KEY ("coachDocumentId") REFERENCES "CoachDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
