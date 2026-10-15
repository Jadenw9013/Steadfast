import { db } from "@/lib/db";
import { lockAiClient } from "@/lib/ai-coach/access";
export async function getAiSessions(clientId: string) {
  return db.$transaction(async tx => {
    await lockAiClient(tx, clientId, false);
    return tx.aiWorkoutSession.findMany({ where: { clientId, deletedAt: null, sessionInstanceId: { not: null } }, orderBy: { occurredAt: "desc" }, take: 300, select: { id: true, clientEventId: true, sessionInstanceId: true, prescriptionSessionId: true, planVersionId: true, exerciseId: true, modality: true, setIndex: true, occurredAt: true, resultStatus: true, reps: true, loadValue: true, loadUnit: true, loadKind: true, durationMinutes: true, painReported: true, effortRating: true, revision: true } });
  });
}
