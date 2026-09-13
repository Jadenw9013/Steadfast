-- CreateEnum
CREATE TYPE "PlanMode" AS ENUM ('MEAL_PLAN', 'MACROS');

-- AlterTable
ALTER TABLE "CoachClient" ADD COLUMN     "planMode" "PlanMode" NOT NULL DEFAULT 'MEAL_PLAN';

-- AlterTable
ALTER TABLE "MealPlan" ADD COLUMN     "planMode" "PlanMode" NOT NULL DEFAULT 'MEAL_PLAN';

-- CreateTable
CREATE TABLE "MealMacroTarget" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "mealName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "calories" INTEGER NOT NULL DEFAULT 0,
    "protein" INTEGER NOT NULL DEFAULT 0,
    "carbs" INTEGER NOT NULL DEFAULT 0,
    "fats" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MealMacroTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealMacroTarget_mealPlanId_idx" ON "MealMacroTarget"("mealPlanId");

-- AddForeignKey
ALTER TABLE "MealMacroTarget" ADD CONSTRAINT "MealMacroTarget_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
