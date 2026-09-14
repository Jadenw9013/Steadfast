ALTER TABLE "AiWorkoutSession"
  ADD COLUMN "modality" TEXT NOT NULL DEFAULT 'STRENGTH',
  ADD COLUMN "sessionInstanceId" TEXT, ADD COLUMN "prescriptionSessionId" TEXT,
  ADD COLUMN "durationMinutes" DOUBLE PRECISION,
  ADD COLUMN "resultStatus" TEXT NOT NULL DEFAULT 'REPORTED_PARTIAL',
  ADD COLUMN "painReported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "effortRating" INTEGER, ADD COLUMN "inputDigest" TEXT, ADD COLUMN "deletedAt" TIMESTAMP(3),
  ALTER COLUMN "loadKind" DROP NOT NULL;
ALTER TABLE "AiWorkoutSession" ADD CONSTRAINT "AiWorkoutSession_modality_check" CHECK ("modality" IN ('STRENGTH', 'CARDIO'));
