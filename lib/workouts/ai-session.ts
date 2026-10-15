import { z } from "zod";
import { db } from "@/lib/db";
import { AiCoachError, lockAiClient } from "@/lib/ai-coach/access";
import { sessionCommandSchema } from "@/lib/ai-coach/session-contract";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { applyEvidenceConcern, invalidateForEvidence } from "@/lib/ai-coach/evidence";
export async function submitAiSession(clientId: string, raw: unknown) {
  const concern = z.object({ requestKey: z.string().uuid(), painReported: z.literal(true) }).passthrough().safeParse(raw);
  if (concern.success) await applyEvidenceConcern(clientId, { requestKey: concern.data.requestKey, payload: { safetyChanged: "YES" } });
  const parsed = sessionCommandSchema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "Check the activity fields, load type, and completion status.", 422);
  const { requestKey, expectedRevision, ...input } = parsed.data;
  const occurredAt = new Date(input.occurredAt);
  if (occurredAt.getTime() > Date.now() + 300000 || occurredAt.getTime() < Date.now() - 180 * 86400000) throw new AiCoachError("VALIDATION_ERROR", "Choose an activity date within the last 180 days.", 422);
  const inputDigest = contentHash({ ...input, expectedRevision });
  return db.$transaction(async tx => {
    const { profile } = await lockAiClient(tx, clientId);
    const key = { clientId, operation: "AI_SESSION", requestKey };
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) {
      if (receipt.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This request key was used for different activity.");
      return receipt.result;
    }
    const plan = await tx.aiPlanVersion.findFirst({ where: { id: input.planVersionId, clientId, acceptedAt: { not: null } } });
    const payload = planPayloadSchema.safeParse(plan?.payload);
    if (!payload.success) throw new AiCoachError("NOT_FOUND", "Accepted plan not found.", 404);
    const matches = input.modality === "STRENGTH"
      ? payload.data.strength.some(s => s.sessionId === input.prescriptionSessionId && s.exercises.some(e => e.exerciseId === input.exerciseId))
      : payload.data.cardio.some(s => s.sessionId === input.prescriptionSessionId && s.exerciseId === input.exerciseId);
    if (!matches) throw new AiCoachError("VALIDATION_ERROR", "This activity does not belong to the selected plan session.", 422);
    const existing = await tx.aiWorkoutSession.findUnique({ where: { clientId_clientEventId: { clientId, clientEventId: input.clientEventId } } });
    if (existing?.deletedAt) throw new AiCoachError("REVISION_CONFLICT", "This activity was deleted. Start a new record.");
    if (existing?.inputDigest === inputDigest) {
      const result = { id: existing.id, revision: existing.revision };
      await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } }); return result;
    }
    if ((existing?.revision ?? 0) !== expectedRevision) throw new AiCoachError("REVISION_CONFLICT", "This activity changed elsewhere. Reload before editing.");
    if (existing && ["planVersionId", "prescriptionSessionId", "exerciseId", "sessionInstanceId", "modality", "setIndex"].some(k => existing[k as keyof typeof existing] !== input[k as keyof typeof input])) throw new AiCoachError("REVISION_CONFLICT", "A correction cannot move activity into another workout or set.");
    const other = await tx.aiWorkoutSession.findFirst({ where: { clientId, sessionInstanceId: input.sessionInstanceId, deletedAt: null } });
    if (other && (other.planVersionId !== input.planVersionId || other.prescriptionSessionId !== input.prescriptionSessionId)) throw new AiCoachError("REVISION_CONFLICT", "This workout instance belongs to a different prescription.");
    const duplicateSet = await tx.aiWorkoutSession.findFirst({ where: { clientId, sessionInstanceId: input.sessionInstanceId, exerciseId: input.exerciseId, setIndex: input.setIndex, deletedAt: null, clientEventId: { not: input.clientEventId } } });
    if (duplicateSet) throw new AiCoachError("REVISION_CONFLICT", "This set was already recorded. Correct the existing record.");
    const data = { ...input, occurredAt, timezone: profile.reviewTimezone ?? "UTC", inputDigest };
    const saved = existing ? await tx.aiWorkoutSession.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.aiWorkoutSession.create({ data: { ...data, clientId, revision: 1 } });
    await invalidateForEvidence(tx, clientId, "SESSION", saved.id, occurredAt, !!existing);
    const result = { id: saved.id, revision: saved.revision };
    await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } }); return result;
  });
}
