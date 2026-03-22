-- CreateTable
CREATE TABLE "IntakeFormTemplate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFormTemplate_coachId_key" ON "IntakeFormTemplate"("coachId");

-- AddForeignKey
ALTER TABLE "IntakeFormTemplate" ADD CONSTRAINT "IntakeFormTemplate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
