import type { Prisma } from "@/app/generated/prisma/client";

export async function isCurrentCoachInTransaction(
  tx: Prisma.TransactionClient,
  coachId: string,
  clientId: string
): Promise<boolean> {
  const client = await tx.user.findUnique({
    where: { id: clientId },
    select: { isClient: true, isDeactivated: true },
  });
  if (!client?.isClient || client.isDeactivated) return false;
  const context = await tx.clientCoachingContext.findUnique({
    where: { clientId },
    select: { mode: true, activeCoachClientId: true, resolutionRequired: true },
  });
  if (context) {
    if (context.mode !== "HUMAN" || context.resolutionRequired || !context.activeCoachClientId) return false;
    return !!(await tx.coachClient.findFirst({
      where: { id: context.activeCoachClientId, clientId, coachId, coach: { isCoach: true, isDeactivated: false } },
      select: { id: true },
    }));
  }
  const links = await tx.coachClient.findMany({
    where: { clientId },
    select: { coachId: true, coach: { select: { isCoach: true, isDeactivated: true } } },
    take: 2,
  });
  return links.length === 1 && links[0].coachId === coachId && links[0].coach.isCoach && !links[0].coach.isDeactivated;
}
