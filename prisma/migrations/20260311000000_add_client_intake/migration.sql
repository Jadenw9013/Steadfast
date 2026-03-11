-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ClientIntake" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "bodyweightLbs" DOUBLE PRECISION,
    "heightInches" DOUBLE PRECISION,
    "ageYears" INTEGER,
    "gender" TEXT,
    "primaryGoal" TEXT,
    "targetTimeline" TEXT,
    "injuries" TEXT,
    "dietaryRestrictions" TEXT,
    "dietaryPreferences" TEXT,
    "currentDiet" TEXT,
    "trainingExperience" TEXT,
    "trainingDaysPerWeek" INTEGER,
    "gymAccess" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIntake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientIntake_clientId_key" ON "ClientIntake"("clientId");

-- CreateIndex
CREATE INDEX "ClientIntake_coachId_idx" ON "ClientIntake"("coachId");

-- CreateIndex
CREATE INDEX "ClientIntake_clientId_idx" ON "ClientIntake"("clientId");

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
