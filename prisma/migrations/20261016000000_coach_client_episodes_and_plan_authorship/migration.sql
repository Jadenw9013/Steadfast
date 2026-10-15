-- T-2060: CoachClientEpisode history + plan authorship. Additive or relaxing only.
-- Generated with the diff workflow (web CLAUDE.md), then the raw SQL below the
-- generated block was hand-added (partial unique index, CHECK, backfill).

-- CreateEnum
CREATE TYPE "CoachClientEpisodeSource" AS ENUM ('LIVE', 'BACKFILL');

-- CreateEnum
CREATE TYPE "CoachClientEpisodeEndReason" AS ENUM ('COACH_REMOVED', 'CLIENT_LEFT', 'COACH_ACCOUNT_DELETED', 'RECONCILED');

-- AlterTable
ALTER TABLE "ClientIntake" ALTER COLUMN "coachId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MealPlan" ADD COLUMN     "publishedByCoachId" TEXT;

-- AlterTable
ALTER TABLE "TrainingProgram" ADD COLUMN     "publishedByCoachId" TEXT;

-- CreateTable
CREATE TABLE "CoachClientEpisode" (
    "id" TEXT NOT NULL,
    "coachId" TEXT,
    "clientId" TEXT NOT NULL,
    "coachClientId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "CoachClientEpisodeEndReason",
    "source" "CoachClientEpisodeSource" NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachClientEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachClientEpisode_clientId_startedAt_idx" ON "CoachClientEpisode"("clientId", "startedAt");

-- CreateIndex
CREATE INDEX "CoachClientEpisode_coachId_idx" ON "CoachClientEpisode"("coachId");

-- CreateIndex
CREATE INDEX "CoachClientEpisode_coachClientId_idx" ON "CoachClientEpisode"("coachClientId");

-- CreateIndex
CREATE INDEX "MealPlan_publishedByCoachId_idx" ON "MealPlan"("publishedByCoachId");

-- CreateIndex
CREATE INDEX "TrainingProgram_publishedByCoachId_idx" ON "TrainingProgram"("publishedByCoachId");

-- AddForeignKey
ALTER TABLE "CoachClientEpisode" ADD CONSTRAINT "CoachClientEpisode_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachClientEpisode" ADD CONSTRAINT "CoachClientEpisode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_publishedByCoachId_fkey" FOREIGN KEY ("publishedByCoachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_publishedByCoachId_fkey" FOREIGN KEY ("publishedByCoachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- (raw) At most one open episode per CoachClient row. Same pattern as
-- "MealPlan_one_published_per_client_week" (20260913220000).
CREATE UNIQUE INDEX "CoachClientEpisode_one_open_per_row" ON "CoachClientEpisode"("coachClientId") WHERE "endedAt" IS NULL;

-- (raw) An episode is either open (no end, no reason) or closed (both).
ALTER TABLE "CoachClientEpisode" ADD CONSTRAINT "CoachClientEpisode_end_pairing_check" CHECK (("endedAt" IS NULL) = ("endReason" IS NULL));

-- (raw) Backfill, facts only, idempotent: one open episode per live CoachClient
-- row, startedAt = the row's createdAt. No authorship is backfilled (pre-ship
-- authors are unknowable). scripts/sql/T-2060-episode-reconcile.sql repeats
-- this INSERT after promotion to cover rows the old code created meanwhile.
INSERT INTO "CoachClientEpisode" ("id","coachId","clientId","coachClientId","startedAt","source","createdAt")
SELECT gen_random_uuid()::text, cc."coachId", cc."clientId", cc."id", cc."createdAt",
       'BACKFILL'::"CoachClientEpisodeSource", now()
FROM "CoachClient" cc
WHERE NOT EXISTS (SELECT 1 FROM "CoachClientEpisode" e WHERE e."coachClientId" = cc."id" AND e."endedAt" IS NULL);
