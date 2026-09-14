import { z } from "zod";
import { db } from "@/lib/db";
import { AiCoachError, lockAiClient } from "./access";
import { contentHash } from "./canonical-json";
import { invalidateForEvidence } from "./evidence";
const schema = z.object({ requestKey: z.string().uuid(), kind: z.enum(["CHECK_IN", "SESSION"]), id: z.string().min(1).max(120), expectedRevision: z.number().int().nonnegative(), confirmed: z.literal(true) }).strict();
export async function deleteAiEvidence(clientId: string, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "Confirm the record and revision to delete.", 422);
  const { requestKey, ...input } = parsed.data; const inputDigest = contentHash(input);
  return db.$transaction(async tx => {
    await lockAiClient(tx, clientId, false);
    const key = { clientId, operation: "DELETE_EVIDENCE", requestKey };
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) { if (receipt.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This request key was already used."); return receipt.result; }
    const row = input.kind === "CHECK_IN" ? await tx.aiCheckInObservation.findFirst({ where: { clientId, id: input.id } }) : await tx.aiWorkoutSession.findFirst({ where: { clientId, id: input.id } });
    if (!row) throw new AiCoachError("NOT_FOUND", "Record not found.", 404);
    if (!row.deletedAt) {
      if (row.revision !== input.expectedRevision) throw new AiCoachError("REVISION_CONFLICT", "This record changed. Reload before deleting.");
      const tombstone = { deletedAt: new Date(), revision: { increment: 1 } };
      if (input.kind === "CHECK_IN") await tx.aiCheckInObservation.update({ where: { id: row.id }, data: { ...tombstone, payload: { deleted: true } } });
      else await tx.aiWorkoutSession.update({ where: { id: row.id }, data: { ...tombstone, reps: null, loadValue: null, loadUnit: null, loadKind: null, durationMinutes: null, painNote: null, effortNote: null, effortRating: null } });
      await invalidateForEvidence(tx, clientId, input.kind, row.id, row.occurredAt, true);
    }
    const result = { deleted: true, id: row.id };
    await tx.aiOperationReceipt.create({ data: { ...key, inputDigest, result } }); return result;
  });
}
