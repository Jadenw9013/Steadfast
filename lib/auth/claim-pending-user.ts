import { db } from "@/lib/db";

export async function claimPendingUser(input: {
  id: string;
  pendingClerkId: string;
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
}) {
  if (!input.pendingClerkId.startsWith("pending_")) return null;
  await db.user.updateMany({
    where: { id: input.id, clerkId: input.pendingClerkId, isDeactivated: false },
    data: { clerkId: input.clerkId, firstName: input.firstName, lastName: input.lastName },
  });
  const claimed = await db.user.findUnique({ where: { clerkId: input.clerkId } });
  return claimed?.id === input.id && !claimed.isDeactivated ? claimed : null;
}
