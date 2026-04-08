import { db } from "@/lib/db";

export async function getMessages(clientId: string, weekOf: Date) {
  return db.message.findMany({
    where: { clientId, weekOf },
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
