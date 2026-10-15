-- AlterEnum
ALTER TYPE "MealPlanStatus" ADD VALUE 'SUPERSEDED';

-- AlterEnum
ALTER TYPE "TrainingProgramStatus" ADD VALUE 'SUPERSEDED';

-- CreateIndex
-- Verified zero existing (clientId, weekOf, version) duplicates before adding
-- this constraint (docs/ai-coach/03-Codebase-Audit.md CB04's explicit audit
-- requirement). Prevents a version-number race between concurrent draft
-- creations: the loser's insert now fails with P2002 instead of silently
-- creating a duplicate-numbered draft.
CREATE UNIQUE INDEX "MealPlan_clientId_weekOf_version_key" ON "MealPlan"("clientId", "weekOf", "version");
