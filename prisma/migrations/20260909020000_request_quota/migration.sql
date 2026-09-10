CREATE TABLE "RequestQuota" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "RequestQuota_expiresAt_idx" ON "RequestQuota"("expiresAt");
