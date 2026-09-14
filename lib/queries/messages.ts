import { db } from "@/lib/db";

/**
 * `asCoachId`: when set, scopes results to this specific coach's
 * conversation with the client — pass the requesting coach's own id.
 * Omit only for the client's own view of their full archive (CB03 — a
 * successor or second coach must never see a predecessor's conversation;
 * the client keeps everything).
 */
export async function getMessages(clientId: string, weekOf: Date, asCoachId?: string) {
  return db.message.findMany({
    where: { clientId, weekOf, ...(asCoachId ? { coachId: asCoachId } : {}) },
    orderBy: { createdAt: "asc" },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, activeRole: true },
      },
    },
  });
}

export async function getAllMessages(clientId: string) {
  return db.message.findMany({
    where: { clientId },
    orderBy: { createdAt: "asc" },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, activeRole: true },
      },
    },
  });
}

export async function hasUnreadMessages(
  clientId: string,
  weekOf: Date,
  coachId: string
) {
  // "Unread" = any message from the client (not sent by the coach)
  const count = await db.message.count({
    where: {
      clientId,
      weekOf,
      senderId: { not: coachId },
    },
  });
  return count > 0;
}
