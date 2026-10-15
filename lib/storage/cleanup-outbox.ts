import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";
import { isBucketMissing } from "@/lib/supabase/meal-plan-storage";

export interface StorageCleanupEntry {
  bucket: string;
  storagePath: string;
  reason: string;
}

/**
 * Durably records that a storage object should be deleted. Call this
 * BEFORE (or in the same transaction as) unlinking the database row that
 * referenced it — once no row references a path, nothing else in the
 * codebase can discover it needs deleting. Safe to call for a path already
 * enqueued (idempotent via the bucket+storagePath unique constraint).
 */
export async function enqueueStorageCleanup(entries: StorageCleanupEntry[]): Promise<void> {
  const unique = entries.filter((e) => e.storagePath);
  if (unique.length === 0) return;
  await db.$transaction(
    unique.map((e) =>
      db.storageCleanupOutbox.upsert({
        where: { bucket_storagePath: { bucket: e.bucket, storagePath: e.storagePath } },
        create: { bucket: e.bucket, storagePath: e.storagePath, reason: e.reason },
        update: {},
      })
    )
  );
}

/** Prisma create/upsert ops for enqueueing cleanup inside a caller's own transaction array. */
export function enqueueStorageCleanupOps(entries: StorageCleanupEntry[]) {
  return entries
    .filter((e) => e.storagePath)
    .map((e) =>
      db.storageCleanupOutbox.upsert({
        where: { bucket_storagePath: { bucket: e.bucket, storagePath: e.storagePath } },
        create: { bucket: e.bucket, storagePath: e.storagePath, reason: e.reason },
        update: {},
      })
    );
}

const MAX_ATTEMPTS = 5;

/**
 * Claims a batch of unprocessed outbox rows and attempts to delete their
 * storage objects. A row already gone from storage counts as processed
 * (isBucketMissing/not-found is not a failure — the goal is the object not
 * existing, and it doesn't). Failures increment attempts/lastError and stay
 * unprocessed for the next sweep, up to MAX_ATTEMPTS.
 */
export async function processStorageCleanupOutbox(limit = 200): Promise<{ processed: number; failed: number; abandoned: number }> {
  const rows = await db.storageCleanupOutbox.findMany({
    where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  let failed = 0;
  const supabase = createServiceClient();

  const byBucket = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byBucket.get(row.bucket) ?? [];
    list.push(row);
    byBucket.set(row.bucket, list);
  }

  for (const [bucket, bucketRows] of byBucket) {
    for (let i = 0; i < bucketRows.length; i += 100) {
      const batch = bucketRows.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(batch.map((r) => r.storagePath));
      if (!error || isBucketMissing(error.message)) {
        await db.storageCleanupOutbox.updateMany({
          where: { id: { in: batch.map((r) => r.id) } },
          data: { processedAt: new Date() },
        });
        processed += batch.length;
      } else {
        await db.$transaction(
          batch.map((r) =>
            db.storageCleanupOutbox.update({
              where: { id: r.id },
              data: { attempts: { increment: 1 }, lastError: error.message.slice(0, 1000) },
            })
          )
        );
        failed += batch.length;
      }
    }
  }

  const abandoned = await db.storageCleanupOutbox.count({ where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } } });

  return { processed, failed, abandoned };
}
