-- Add cadence configuration JSON fields to User and CoachClient
ALTER TABLE "User" ADD COLUMN "cadenceConfig" JSONB;
ALTER TABLE "CoachClient" ADD COLUMN "cadenceConfig" JSONB;
