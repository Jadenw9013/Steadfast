import { db } from "@/lib/db";
import { observationCommandSchema, observationSchema, observationDraftSchema } from "@/lib/ai-coach/observation-contract";
import { AiCoachError, jsonValue, lockAiClient } from "@/lib/ai-coach/access";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { applyEvidenceConcern, invalidateForEvidence } from "@/lib/ai-coach/evidence";
export async function submitAiCheckIn(clientId: string, raw: unknown) {
  await applyEvidenceConcern(clientId, raw);
  const parsed = observationCommandSchema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "Invalid observation request.", 422);
  const { requestKey, ...input } = parsed.data;
  const payload = (input.submit ? observationSchema : observationDraftSchema).safeParse(input.payload);
  if (!payload.success) throw new AiCoachError("VALIDATION_ERROR", "Complete the observation fields or save a draft.", 422);
  const occurredAt = new Date(input.occurredAt);
  if (occurredAt.getTime() > Date.now() + 300000 || occurredAt.getTime() < Date.now() - 180 * 86400000) throw new AiCoachError("VALIDATION_ERROR", "Choose an observation date within the last 180 days.", 422);
  const inputDigest = contentHash(jsonValue(input));
  return db.$transaction(async tx => {
    await lockAiClient(tx, clientId);
    const key = { clientId, operation: "AI_CHECK_IN", requestKey };
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) {
      if (receipt.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This request key was used for different answers.");
      return receipt.result;
    }
    const existing = await tx.aiCheckInObservation.findUnique({ where: { clientId_clientEventId: { clientId, clientEventId: input.clientEventId } } });
    if (existing?.deletedAt) throw new AiCoachError("REVISION_CONFLICT", "This observation was deleted. Start a new report.");
    if (existing?.inputDigest === inputDigest) {
      const result = { id: existing.id, revision: existing.revision, submitted: existing.submitted };
      await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } });
      return result;
    }
    if ((existing?.revision ?? 0) !== input.expectedRevision) throw new AiCoachError("REVISION_CONFLICT", "The observation changed elsewhere. Reload before editing.");
    if (existing?.submitted && !input.submit) throw new AiCoachError("REVISION_CONFLICT", "A submitted observation must be corrected as a submission.");
    const saved = existing
      ? await tx.aiCheckInObservation.update({ where: { id: existing.id }, data: { payload: jsonValue(payload.data), occurredAt, revision: { increment: 1 }, submitted: input.submit, inputDigest } })
      : await tx.aiCheckInObservation.create({ data: { clientId, clientEventId: input.clientEventId, payload: jsonValue(payload.data), occurredAt, submitted: input.submit, inputDigest } });
    if (input.submit) await invalidateForEvidence(tx, clientId, "CHECK_IN", saved.id, occurredAt, !!existing?.submitted);
    const result = { id: saved.id, revision: saved.revision, submitted: saved.submitted };
    await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } });
    return result;
  });
}
