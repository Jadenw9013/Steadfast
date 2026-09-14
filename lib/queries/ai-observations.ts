import { db } from "@/lib/db";
import { lockAiClient } from "@/lib/ai-coach/access";
export async function getAiObservations(clientId: string) {
  return db.$transaction(async tx => {
    await lockAiClient(tx, clientId, false);
    return tx.aiCheckInObservation.findMany({ where: { clientId, deletedAt: null }, orderBy: { occurredAt: "desc" }, take: 90, select: { id: true, clientEventId: true, occurredAt: true, payload: true, revision: true, submitted: true } });
  });
}
