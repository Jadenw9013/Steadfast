import { db } from "@/lib/db";
import { purgeUserAccount } from "./purge";

export async function sweepAccountDeletions() {
  const now = new Date();
  await db.requestQuota.deleteMany({ where: { expiresAt: { lt: now } } });
  const eligible = { scheduledPurgeAt: { lte: now }, OR: [
    { status: "PENDING" as const },
    { status: "PURGING" as const, purgeStartedAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
  ] };
  const requests = await db.accountDeletionRequest.findMany({ where: eligible, take: 10, orderBy: { scheduledPurgeAt: "asc" } });
  let processed = 0, errors = 0;
  for (const request of requests) {
    if (!request.userId) continue;
    const claim = await db.accountDeletionRequest.updateMany({ where: { id: request.id, ...eligible }, data: { status: "PURGING", purgeStartedAt: now } });
    if (!claim.count) continue;
    try { await purgeUserAccount(request.userId); processed++; }
    catch (error) {
      console.error("[purge] Retry required", request.id, error);
      await db.accountDeletionRequest.updateMany({ where: { id: request.id, status: "PURGING", purgeStartedAt: now }, data: { status: "PENDING", retryCount: { increment: 1 } } });
      errors++;
    }
  }
  return { processed, errors };
}
