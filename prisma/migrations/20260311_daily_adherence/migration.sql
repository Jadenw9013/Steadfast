-- AlterTable
ALTER TABLE "CoachClient" ADD COLUMN     "adherenceEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DailyAdherence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "workoutCompleted" BOOLEAN NOT NULL DEFAULT false,
    "workoutCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAdherence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMealCheckoff" (
    "id" TEXT NOT NULL,
    "dailyAdherenceId" TEXT NOT NULL,
    "mealNameSnapshot" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMealCheckoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyAdherence_clientId_idx" ON "DailyAdherence"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAdherence_clientId_date_key" ON "DailyAdherence"("clientId", "date");

-- CreateIndex
CREATE INDEX "DailyMealCheckoff_dailyAdherenceId_idx" ON "DailyMealCheckoff"("dailyAdherenceId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMealCheckoff_dailyAdherenceId_mealNameSnapshot_key" ON "DailyMealCheckoff"("dailyAdherenceId", "mealNameSnapshot");

-- AddForeignKey
ALTER TABLE "DailyAdherence" ADD CONSTRAINT "DailyAdherence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMealCheckoff" ADD CONSTRAINT "DailyMealCheckoff_dailyAdherenceId_fkey" FOREIGN KEY ("dailyAdherenceId") REFERENCES "DailyAdherence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
