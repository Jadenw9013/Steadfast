import { z } from "zod";
import { db } from "@/lib/db";
import { AiCoachError, jsonValue, lockAiClient } from "./access";
import { contentHash } from "./canonical-json";
import { runSnapshotSchema } from "./run-command";
import { evidenceIsCurrent } from "./evidence-snapshot";
import { requireReviewerCapacity } from "./reviewer-capacity";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
/** A manual retry never resets a terminal row, activation window, clinical
 * history, source cutoff or adjustment slot. Two linked retries are the cap. */
export async function retryManagedRun(clientId: string, runId: string, raw: unknown) {
  const input = z.object({ requestKey: z.string().uuid() }).strict().safeParse(raw);
  if (!input.success) throw new AiCoachError("VALIDATION_ERROR", "A retry request key is required.", 422);
  return db.$transaction(async tx => {
    const { context, profile } = await lockAiClient(tx, clientId);
    const key = { clientId, operation: "RUN_RETRY", requestKey: input.data.requestKey }; const inputDigest = contentHash({ runId });
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) { if (receipt.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This retry key was already used."); return receipt.result; }
    if (!isAiCoachGenerationEnabled()) throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Preparation is paused.", 503);
    const original = await tx.aiCoachRun.findFirst({ where: { id: runId, clientId } });
    if (!original) throw new AiCoachError("NOT_FOUND", "Run not found.", 404);
    const snapshot = runSnapshotSchema.safeParse(original.inputSnapshot);
    if (original.status !== "FAILED" || !snapshot.success) throw new AiCoachError("REVISION_CONFLICT", "Only a failed managed run can be retried.");
    if (original.retryGeneration >= 2) throw new AiCoachError("RATE_LIMITED", "This review has exhausted its manual retry budget.", 429);
    if (context!.revision !== original.contextRevision || profile.profileRevision !== original.profileRevision || profile.observationRevision !== original.observationRevision || profile.safetyRevision !== original.safetyRevision || profile.activePlanVersionId !== snapshot.data.baseVersionId || !await evidenceIsCurrent(tx, clientId, snapshot.data.sourceRefs) || [profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].some(p => p !== "ALLOW") || !original.activationEndsAt || original.activationEndsAt <= new Date()) throw new AiCoachError("STALE_PROPOSAL", "The saved inputs or review window changed. Request a fresh review from Home.");
    const businessKey = contentHash({ retryOf: original.id, generation: original.retryGeneration + 1 });
    let retry = await tx.aiCoachRun.findUnique({ where: { businessKey } });
    if (!retry) {
      if (await tx.aiCoachRun.count({ where: { clientId, createdAt: { gte: new Date(Date.now() - 86400000) } } }) >= 8) throw new AiCoachError("RATE_LIMITED", "The daily preparation limit has been reached.", 429);
      if (original.kind !== "REPRESENTATION") await requireReviewerCapacity(tx, clientId);
      retry = await tx.aiCoachRun.create({ data: { clientId, kind: original.kind, businessKey, contextRevision: original.contextRevision, profileRevision: original.profileRevision, observationRevision: original.observationRevision, safetyRevision: original.safetyRevision, lookbackStart: original.lookbackStart, lookbackEnd: original.lookbackEnd, snapshotCutoffAt: original.snapshotCutoffAt, activationStartsAt: original.activationStartsAt, activationEndsAt: original.activationEndsAt, retryGeneration: original.retryGeneration + 1, retryOfRunId: original.id, inputSnapshot: jsonValue(snapshot.data) } });
    }
    const result = { runId: retry.id }; await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } }); return result;
  });
}
