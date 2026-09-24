import { db } from "@/lib/db";
import { getAiCoachClientDiscovery } from "@/lib/ai-coach/discovery";
/** Resolve the server's current provider. Never guess between relationships or
 * treat historical human plans as current AI instructions. Legacy accounts with
 * no context can use one unambiguous relationship until backfill is complete. */
export async function getClientProvider(clientId: string) {
  const resolved = await db.$transaction(async tx => {
    const context = await tx.clientCoachingContext.findUnique({ where: { clientId } });
    let origin = context?.mode ?? "NONE";
    let relationship = context?.activeCoachClientId ? await tx.coachClient.findFirst({ where: { id: context.activeCoachClientId, clientId }, select: { id: true, coachId: true, createdAt: true } }) : null;
    let resolutionRequired = context?.resolutionRequired ?? false;
    if (!context) {
      const legacy = await tx.coachClient.findMany({ where: { clientId }, take: 2, select: { id: true, coachId: true, createdAt: true } });
      if (legacy.length === 1) { origin = "HUMAN"; relationship = legacy[0]; }
      else if (legacy.length > 1) resolutionRequired = true;
    }
    if (origin === "HUMAN" && !relationship) resolutionRequired = true;
    const profile = await tx.aiCoachProfile.findUnique({ where: { clientId }, select: { isSynthetic: true } });
    const entitlement = await tx.aiCoachEntitlement.findUnique({ where: { clientId }, select: { revokedAt: true, expiresAt: true } });
    const syntheticPreviewAvailable = !resolutionRequired && origin !== "HUMAN" && process.env.NODE_ENV !== "production" && process.env.AI_COACH_FIXTURE_MODE === "true" && profile?.isSynthetic === true && !!entitlement && !entitlement.revokedAt && (!entitlement.expiresAt || entitlement.expiresAt > new Date());
    return { origin, revision: context?.revision ?? 0, resolutionRequired, activeCoachClientId: origin === "HUMAN" && !resolutionRequired ? relationship?.id ?? null : null, coachId: origin === "HUMAN" && !resolutionRequired ? relationship?.coachId ?? null : null, relationshipStartedAt: origin === "HUMAN" && !resolutionRequired ? relationship?.createdAt ?? null : null, syntheticPreviewAvailable };
  });
  const discovery = resolved.syntheticPreviewAvailable
    ? null
    : await getAiCoachClientDiscovery(clientId);
  const aiDiscovery = discovery?.available ? discovery.offer : null;
  return {
    origin: resolved.origin,
    revision: resolved.revision,
    resolutionRequired: resolved.resolutionRequired,
    activeCoachClientId: resolved.activeCoachClientId,
    coachId: resolved.coachId,
    relationshipStartedAt: resolved.relationshipStartedAt,
    aiPreviewAvailable: resolved.syntheticPreviewAvailable || Boolean(aiDiscovery),
    aiDiscovery,
    aiDiscoveryReasonCode: discovery?.available ? null : (discovery?.reasonCode ?? null),
  };
}

/** Recheck after dependent reads so a provider transition cannot return stale
 * instructions as a successful current-plan response. */
export async function isClientProviderCurrent(clientId: string, expected: Awaited<ReturnType<typeof getClientProvider>>) {
  const current = await getClientProvider(clientId);
  return !current.resolutionRequired && current.origin === expected.origin && current.revision === expected.revision && current.activeCoachClientId === expected.activeCoachClientId;
}
