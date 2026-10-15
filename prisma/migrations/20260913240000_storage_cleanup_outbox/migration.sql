-- CreateTable
CREATE TABLE "StorageCleanupOutbox" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "StorageCleanupOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageCleanupOutbox_processedAt_idx" ON "StorageCleanupOutbox"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageCleanupOutbox_bucket_storagePath_key" ON "StorageCleanupOutbox"("bucket", "storagePath");
