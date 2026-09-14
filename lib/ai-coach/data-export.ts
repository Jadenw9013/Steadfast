import { db } from "@/lib/db";
import { AiCoachError } from "./access";

/** Owner-only, bounded-memory NDJSON export. No entitlement is needed to read
 * retained personal records. Each dataset is paginated; the manifest explicitly
 * describes concurrent writes rather than claiming a transaction snapshot. */
export async function* exportAiData(clientId: string, signal?: AbortSignal) {
  const startedAt = new Date();
  async function active() {
    if (signal?.aborted) throw new Error("Export cancelled");
    const owner = await db.user.findUnique({ where: { id: clientId }, select: { isDeactivated: true, isClient: true } });
    if (!owner || owner.isDeactivated || !owner.isClient) throw new AiCoachError("FORBIDDEN", "This account is unavailable.", 403);
  }
  await active();
  yield { dataset: "manifest", record: { schemaVersion: 1, startedAt: startedAt.toISOString(), format: "NDJSON", consistency: "Records are read in pages. Concurrent corrections may appear; this is not an atomic snapshot. Records created after export start are excluded where creation timestamps exist.", exclusions: ["Other clients", "Reviewer qualification records", "Internal model traces and execution errors"], completion: "A complete export ends with an end record." } };
  for (const [dataset, record] of [
    ["profile", await db.aiCoachProfile.findUnique({ where: { clientId } })],
    ["intakeDraft", await db.aiIntakeDraft.findUnique({ where: { clientId } })],
    ["coachingContext", await db.clientCoachingContext.findUnique({ where: { clientId }, select: { mode: true, revision: true, resolutionRequired: true, createdAt: true, updatedAt: true } })],
    ["entitlement", await db.aiCoachEntitlement.findUnique({ where: { clientId }, select: { grantedAt: true, expiresAt: true, revokedAt: true } })],
  ] as const) { await active(); if (record) yield { dataset, record }; }
  const where = (after?: string) => ({ clientId, createdAt: { lte: startedAt }, ...(after ? { id: { gt: after } } : {}) });
  const page = { take: 100, orderBy: { id: "asc" as const } };
  const sources: [string, (after?: string) => Promise<{ id: string }[]>][] = [
    ["observations", after => db.aiCheckInObservation.findMany({ where: where(after), ...page })],
    ["sessions", after => db.aiWorkoutSession.findMany({ where: where(after), ...page })],
    ["plans", after => db.aiPlanVersion.findMany({ where: where(after), ...page, include: { approval: { select: { approved: true, approvedHash: true, stateHash: true, rationale: true, decidedAt: true } } } })],
    ["runs", after => db.aiCoachRun.findMany({ where: where(after), ...page, select: { id: true, kind: true, status: true, contextRevision: true, profileRevision: true, observationRevision: true, safetyRevision: true, lookbackStart: true, lookbackEnd: true, snapshotCutoffAt: true, activationStartsAt: true, activationEndsAt: true, attempts: true, retryGeneration: true, retryOfRunId: true, inputSnapshot: true, resultDecision: true, resultPlanVersionId: true, resultReviewAction: true, createdAt: true, updatedAt: true } })],
    ["safetyEvents", after => db.aiSafetyDisclosureEvent.findMany({ where: { clientId, reportedAt: { lte: startedAt }, ...(after ? { id: { gt: after } } : {}) }, ...page })],
    ["adjustmentSlots", after => db.aiAdjustmentSlot.findMany({ where: { clientId, acceptedAt: { lte: startedAt }, ...(after ? { id: { gt: after } } : {}) }, ...page })],
    ["acceptanceReceipts", after => db.aiPlanAcceptanceReceipt.findMany({ where: where(after), ...page })],
    ["operationReceipts", after => db.aiOperationReceipt.findMany({ where: { ...where(after), operation: { notIn: ["REVIEW", "SAFETY_RESOLUTION"] } }, ...page })],
    ["notificationIntents", after => db.aiPlanAcceptanceOutbox.findMany({ where: where(after), ...page })],
  ];
  const counts: Record<string, number> = {};
  for (const [dataset, read] of sources) {
    let after: string | undefined; counts[dataset] = 0;
    for (;;) {
      await active(); const rows = await read(after); await active();
      for (const record of rows) { if (signal?.aborted) throw new Error("Export cancelled"); yield { dataset, record }; counts[dataset]++; }
      if (rows.length < page.take) break;
      after = rows[rows.length - 1].id;
    }
  }
  await active(); yield { dataset: "end", record: { completedAt: new Date().toISOString(), counts } };
}
