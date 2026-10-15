import type { Prisma } from "@/app/generated/prisma/client";
import { AiCoachError } from "./error";

export { AiCoachError } from "./error";
export function requireFixtureRuntime() {
  if (process.env.NODE_ENV === "production" || process.env.AI_COACH_FIXTURE_MODE !== "true") {
    throw new AiCoachError(
      "TEMPORARILY_UNAVAILABLE",
      "AI coaching is not available for live use yet.",
      503
    );
  }
}
/** Lock 1 of 4 (User). Split out so `lockAiClient` can restore the exact
 * original interleave (lock 1 -> isClient/isDeactivated check -> locks 2-4)
 * that `lockAiClientRows` alone cannot express (T-995 r2 parity gap P3). */
export async function lockAiClientUserRow(
  tx: Prisma.TransactionClient,
  clientId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
}
/** Locks 2-4 of 4 (ClientCoachingContext, AiCoachProfile, AiCoachEntitlement). */
export async function lockAiClientDependentRows(
  tx: Prisma.TransactionClient,
  clientId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ClientCoachingContext" WHERE "clientId" = ${clientId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AiCoachProfile" WHERE "clientId" = ${clientId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AiCoachEntitlement" WHERE "clientId" = ${clientId} FOR UPDATE`;
}
/** All four locks, no interleaved check — for callers (lib/ai-coach/grants.ts)
 * that need the row locks without lockAiClient's isClient/isDeactivated throw. */
export async function lockAiClientRows(
  tx: Prisma.TransactionClient,
  clientId: string
): Promise<void> {
  await lockAiClientUserRow(tx, clientId);
  await lockAiClientDependentRows(tx, clientId);
}
export async function lockAiClient(
  tx: Prisma.TransactionClient,
  clientId: string,
  requireAuthority = true
) {
  await lockAiClientUserRow(tx, clientId);
  const user = await tx.user.findUnique({
    where: { id: clientId },
    select: { isClient: true, isDeactivated: true, timezone: true },
  });
  if (!user?.isClient || user.isDeactivated)
    throw new AiCoachError("FORBIDDEN", "An active client account is required.", 403);
  await lockAiClientDependentRows(tx, clientId);
  const context = await tx.clientCoachingContext.findUnique({ where: { clientId } });
  const profile = await tx.aiCoachProfile.findUnique({ where: { clientId } });
  const entitlement = await tx.aiCoachEntitlement.findUnique({ where: { clientId } });
  if (!profile) throw new AiCoachError("FORBIDDEN", "An AI Coach profile is required.", 403);
  let liveRelease = null;
  if (profile.isSynthetic) {
    requireFixtureRuntime();
  } else {
    const { assertActiveAiCoachLiveReleaseReadyInTransaction } =
      await import("./live-launch/repository");
    liveRelease = await assertActiveAiCoachLiveReleaseReadyInTransaction(tx);
  }
  if (
    !entitlement ||
    entitlement.revokedAt ||
    (entitlement.expiresAt && entitlement.expiresAt <= new Date())
  )
    throw new AiCoachError("ENTITLEMENT_REQUIRED", "An active invitation is required.", 403);
  if (context?.resolutionRequired || (requireAuthority && context?.mode !== "AI"))
    throw new AiCoachError(
      "REVISION_CONFLICT",
      "Your coaching provider has changed. Refresh to continue."
    );
  return { user, context, profile, liveRelease };
}
export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
