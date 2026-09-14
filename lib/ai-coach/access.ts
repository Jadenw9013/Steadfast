import type { Prisma } from "@/app/generated/prisma/client";

export class AiCoachError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export function requireFixtureRuntime() {
  if (process.env.NODE_ENV === "production" || process.env.AI_COACH_FIXTURE_MODE !== "true") {
    throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "AI coaching is not available for live use yet.", 503);
  }
}
export async function lockAiClient(tx: Prisma.TransactionClient, clientId: string, requireAuthority = true) {
  requireFixtureRuntime();
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: clientId }, select: { isClient: true, isDeactivated: true, timezone: true } });
  if (!user?.isClient || user.isDeactivated) throw new AiCoachError("FORBIDDEN", "An active client account is required.", 403);
  await tx.$queryRaw`SELECT "id" FROM "ClientCoachingContext" WHERE "clientId" = ${clientId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AiCoachProfile" WHERE "clientId" = ${clientId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AiCoachEntitlement" WHERE "clientId" = ${clientId} FOR UPDATE`;
  const context = await tx.clientCoachingContext.findUnique({ where: { clientId } });
  const profile = await tx.aiCoachProfile.findUnique({ where: { clientId } });
  const entitlement = await tx.aiCoachEntitlement.findUnique({ where: { clientId } });
  if (!profile?.isSynthetic) throw new AiCoachError("FORBIDDEN", "This environment only supports designated synthetic test accounts.", 403);
  if (!entitlement || entitlement.revokedAt || (entitlement.expiresAt && entitlement.expiresAt <= new Date())) throw new AiCoachError("ENTITLEMENT_REQUIRED", "An active invitation is required.", 403);
  if (context?.resolutionRequired || (requireAuthority && context?.mode !== "AI")) throw new AiCoachError("REVISION_CONFLICT", "Your coaching provider has changed. Refresh to continue.");
  return { user, context, profile };
}
export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
