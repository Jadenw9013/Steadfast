import type { Prisma } from "@/app/generated/prisma/client";

export class IntakeTokenError extends Error {}

export async function lockIntakePacket(tx: Prisma.TransactionClient, token: string) {
  const reference = await tx.intakePacket.findUnique({
    where: { token },
    select: { id: true, coachingRequestId: true, coachingRequest: { select: { coachProfile: { select: { userId: true } } } } },
  });
  if (!reference) throw new IntakeTokenError("Invalid link.");
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${reference.coachingRequest.coachProfile.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "CoachingRequest" WHERE "id" = ${reference.coachingRequestId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "IntakePacket" WHERE "id" = ${reference.id} FOR UPDATE`;
  const packet = await tx.intakePacket.findUnique({
    where: { token },
    include: {
      documents: {
        include: { signature: true, coachDocument: { select: { type: true, coachId: true } } },
      },
    },
  });
  if (!packet || packet.id !== reference.id) throw new IntakeTokenError("This link is no longer valid.");
  if (packet.tokenExpiresAt <= new Date()) throw new IntakeTokenError("This link has expired. Please contact your coach for a new one.");
  if (packet.submittedAt) throw new IntakeTokenError("You have already submitted this form.");
  const request = await tx.coachingRequest.findUniqueOrThrow({
    where: { id: packet.coachingRequestId },
    select: { id: true, consultationStage: true, prospectName: true, coachProfile: { select: { userId: true } } },
  });
  if (request.consultationStage === "DECLINED") throw new IntakeTokenError("This intake is no longer available. Contact your coach.");
  const coach = await tx.user.findUnique({
    where: { id: request.coachProfile.userId },
    select: { id: true, email: true, isCoach: true, isDeactivated: true },
  });
  if (!coach?.isCoach || coach.isDeactivated) throw new IntakeTokenError("This coach is unavailable.");
  return { packet, request, coach };
}
