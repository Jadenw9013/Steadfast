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

/**
 * `asCoachId`: when set, scopes results to this specific coach's
 * conversation with the client — pass the requesting coach's own id.
 * Omit only for the client's own view of their full archive (CB03).
 * Coach surfaces must call getCoachThread() instead of passing this
 * directly, so the scope cannot be forgotten.
 */
export async function getAllMessages(clientId: string, asCoachId?: string) {
  return db.message.findMany({
    where: { clientId, ...(asCoachId ? { coachId: asCoachId } : {}) },
    orderBy: { createdAt: "asc" },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, activeRole: true },
      },
    },
  });
}

/**
 * CB03 — the coach-facing entry point for a full DM thread (all weeks).
 * `coachId` is required: a coach surface cannot accidentally read the
 * client's whole archive, which is what
 * app/coach/clients/[clientId]/messages/page.tsx did before T-672.
 * Delegates so the filter has exactly one implementation.
 */
export async function getCoachThread(clientId: string, coachId: string) {
  return getAllMessages(clientId, coachId);
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
