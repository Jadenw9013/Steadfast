-- S-23 (adaptive energy, phase 1) — AiNutritionLog.
--
-- The generated section below is verbatim `prisma migrate diff
-- --from-config-datasource --to-schema prisma/schema.prisma --script` run
-- against a disposable local replay database at migration 79.
--
-- The CHECK constraints after it are hand-written and are the point of the
-- table: SKIPPED / NONE are first-class states, so a row must never be able to
-- claim "nothing was logged" while carrying numbers, nor claim coverage with no
-- energy value. Prisma cannot express CHECK constraints, so they are invisible
-- to `migrate diff` (same as the existing `AiWorkoutSession_modality_check`);
-- they are applied by the migration and asserted by
-- tests/integration/ai-coach-nutrition-log.test.ts.

-- CreateEnum
CREATE TYPE "AiNutritionLogSource" AS ENUM ('PLAN_AS_WRITTEN', 'PLAN_WITH_EDITS', 'MANUAL', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AiNutritionLogCompleteness" AS ENUM ('FULL', 'PARTIAL', 'NONE');

-- CreateTable
CREATE TABLE "AiNutritionLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "loggedOn" DATE NOT NULL,
    "energyKcal" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "source" "AiNutritionLogSource" NOT NULL,
    "completeness" "AiNutritionLogCompleteness" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiNutritionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiNutritionLog_clientId_loggedOn_key" ON "AiNutritionLog"("clientId", "loggedOn");

-- AddForeignKey
ALTER TABLE "AiNutritionLog" ADD CONSTRAINT "AiNutritionLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A declared "nothing was logged" day carries no numbers at all.
ALTER TABLE "AiNutritionLog"
  ADD CONSTRAINT "AiNutritionLog_none_has_no_macros"
  CHECK (
    "completeness" <> 'NONE'
    OR (
      "energyKcal" IS NULL
      AND "proteinG" IS NULL
      AND "carbsG" IS NULL
      AND "fatG" IS NULL
    )
  );

-- A day that declares any coverage carries an energy value; that value is the
-- estimator's only required input, so a FULL day without one is not storable.
ALTER TABLE "AiNutritionLog"
  ADD CONSTRAINT "AiNutritionLog_logged_has_energy"
  CHECK ("completeness" = 'NONE' OR "energyKcal" IS NOT NULL);

-- "The client says they did not log" and "the client declares no coverage" are
-- the same statement; they may not disagree inside one row.
ALTER TABLE "AiNutritionLog"
  ADD CONSTRAINT "AiNutritionLog_skipped_is_none"
  CHECK (("source" = 'SKIPPED') = ("completeness" = 'NONE'));

-- Energy and macro mass are never negative.
ALTER TABLE "AiNutritionLog"
  ADD CONSTRAINT "AiNutritionLog_nonnegative"
  CHECK (
    ("energyKcal" IS NULL OR "energyKcal" >= 0)
    AND ("proteinG" IS NULL OR "proteinG" >= 0)
    AND ("carbsG" IS NULL OR "carbsG" >= 0)
    AND ("fatG" IS NULL OR "fatG" >= 0)
  );
