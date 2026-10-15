-- DropIndex
DROP INDEX "ExerciseResult_clientId_exerciseName_programDay_setNumber_w_key";

-- AlterTable
ALTER TABLE "ExerciseResult" ADD COLUMN     "sessionDate" TEXT NOT NULL DEFAULT '';

-- Backfill (CB08): only 11 rows existed in the reviewed database at
-- migration time. Multiple genuinely-distinct sessions that previously
-- collided on (clientId, exerciseName, programDay, setNumber, weekOf) had
-- already been silently overwritten by the upsert bug this migration
-- fixes going forward — that history cannot be recovered. For the rows
-- that do exist, sessionDate is derived from createdAt converted to the
-- owning client's stored timezone (falling back to the same
-- America/Los_Angeles default the application code uses), which is an
-- honest record of when that specific row was created, not a guess.
UPDATE "ExerciseResult" er
SET "sessionDate" = to_char(
  er."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE COALESCE(u."timezone", 'America/Los_Angeles'),
  'YYYY-MM-DD'
)
FROM "User" u
WHERE u."id" = er."clientId";

-- CreateIndex
CREATE INDEX "ExerciseResult_clientId_weekOf_idx" ON "ExerciseResult"("clientId", "weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseResult_clientId_exerciseName_programDay_setNumber_s_key" ON "ExerciseResult"("clientId", "exerciseName", "programDay", "setNumber", "sessionDate");
