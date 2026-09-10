import { db } from "@/lib/db";

/** Shared by REST and Server Actions: blocking must work on every client. */
export async function assertMessagingAllowed(senderId: string, recipientId: string) {
  const block = await db.userBlock.findFirst({
    where: { OR: [
      { blockerId: senderId, blockedId: recipientId },
      { blockerId: recipientId, blockedId: senderId },
    ] },
    select: { id: true },
  });
  if (block) throw new Error("You can't message this user.");
}
