-- AlterTable
ALTER TABLE "CoachProfile" ADD COLUMN "acceptingClients" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "result" TEXT,
    "description" TEXT,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioItem_coachProfileId_idx" ON "PortfolioItem"("coachProfileId");

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
