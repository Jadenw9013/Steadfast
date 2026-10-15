-- CreateEnum
CREATE TYPE "CoachingMode" AS ENUM ('NONE', 'HUMAN', 'AI');

-- CreateTable
CREATE TABLE "ClientCoachingContext" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mode" "CoachingMode" NOT NULL DEFAULT 'NONE',
    "activeCoachClientId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "resolutionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCoachingContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileRevision" INTEGER NOT NULL DEFAULT 0,
    "observationRevision" INTEGER NOT NULL DEFAULT 0,
    "safetyRevision" INTEGER NOT NULL DEFAULT 0,
    "reviewTimezone" TEXT,
    "activePlanVersionId" TEXT,
    "consentedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachEntitlement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AiCoachEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientCoachingContext_clientId_key" ON "ClientCoachingContext"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCoachingContext_activeCoachClientId_key" ON "ClientCoachingContext"("activeCoachClientId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachProfile_clientId_key" ON "AiCoachProfile"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachEntitlement_clientId_key" ON "AiCoachEntitlement"("clientId");

-- AddForeignKey
ALTER TABLE "ClientCoachingContext" ADD CONSTRAINT "ClientCoachingContext_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCoachingContext" ADD CONSTRAINT "ClientCoachingContext_activeCoachClientId_fkey" FOREIGN KEY ("activeCoachClientId") REFERENCES "CoachClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachProfile" ADD CONSTRAINT "AiCoachProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachEntitlement" ADD CONSTRAINT "AiCoachEntitlement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (A01/CB06): populate ClientCoachingContext for every existing
-- client from their current CoachClient state. Verified zero clients with
-- more than one CoachClient row before writing this — a client with
-- exactly one relationship gets mode=HUMAN pointed at it; a client with
-- none gets mode=NONE. If this ever runs against data where that
-- assumption no longer holds, ambiguous clients are marked
-- resolutionRequired rather than guessing which relationship is active.
INSERT INTO "ClientCoachingContext" ("id", "clientId", "mode", "activeCoachClientId", "revision", "resolutionRequired", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u.id,
  CASE WHEN counts.n = 1 THEN 'HUMAN'::"CoachingMode" ELSE 'NONE'::"CoachingMode" END,
  single."id",
  1,
  COALESCE(counts.n, 0) > 1,
  CURRENT_TIMESTAMP
FROM "User" u
LEFT JOIN (
  SELECT "clientId", count(*) AS n FROM "CoachClient" GROUP BY "clientId"
) counts ON counts."clientId" = u.id
LEFT JOIN LATERAL (
  SELECT cc."id" FROM "CoachClient" cc WHERE cc."clientId" = u.id ORDER BY cc."createdAt" ASC LIMIT 1
) single ON counts.n = 1
WHERE u."isClient" = true;
