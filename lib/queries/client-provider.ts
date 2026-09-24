import { db } from "@/lib/db";
import { getAiCoachClientDiscoveryInTransaction } from "@/lib/ai-coach/discovery";
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
    // Read inside this same transaction, from the same origin/profile/
    // entitlement this call already resolved, so the offer cannot disagree
    // with `origin` on a later, separately-snapshotted read (see T-989 review
    // finding 2). `origin` stays the single provider authority; this only
    // ever adds an *offer* alongside a NONE result.
    const aiDiscovery = syntheticPreviewAvailable
      ? null
      : await getAiCoachClientDiscoveryInTransaction(tx, clientId, { origin, resolutionRequired, profile, entitlement });
    return { origin, revision: context?.revision ?? 0, resolutionRequired, activeCoachClientId: origin === "HUMAN" && !resolutionRequired ? relationship?.id ?? null : null, coachId: origin === "HUMAN" && !resolutionRequired ? relationship?.coachId ?? null : null, relationshipStartedAt: origin === "HUMAN" && !resolutionRequired ? relationship?.createdAt ?? null : null, syntheticPreviewAvailable, aiDiscovery };
  });
  const aiDiscovery = resolved.aiDiscovery?.available ? resolved.aiDiscovery.offer : null;
  return {
    origin: resolved.origin,
    revision: resolved.revision,
    resolutionRequired: resolved.resolutionRequired,
    activeCoachClientId: resolved.activeCoachClientId,
    coachId: resolved.coachId,
    relationshipStartedAt: resolved.relationshipStartedAt,
    aiPreviewAvailable: resolved.syntheticPreviewAvailable || Boolean(aiDiscovery),
    aiDiscovery,
    aiDiscoveryReasonCode: resolved.aiDiscovery?.available ? null : (resolved.aiDiscovery?.reasonCode ?? null),
  };
}

/** Recheck after dependent reads so a provider transition cannot return stale
 * instructions as a successful current-plan response.
 *
 * Deliberately does not compare `aiPreviewAvailable`/`aiDiscovery`: those are
 * an *offer*, derived every call strictly from that same call's freshly
 * resolved `origin`/`resolutionRequired` (see `getAiCoachClientDiscoveryInTransaction`),
 * never from an independent read. Any change to what the offer would be is
 * only possible via a change to `origin`, `activeCoachClientId` or
 * `resolutionRequired` first — a HUMAN-to-something-else transition already
 * flips `activeCoachClientId` to null and usually `origin` itself — so those
 * three fields already catch every case where the offer could differ. The
 * offer never gates access to actual plan/instruction data (only real
 * enrollment, via `ClientCoachingContext.mode`, does that), so a same-request
 * flicker in entitlement/release state between two calls is not a fencing
 * hazard the way a provider-identity change is. */
export async function isClientProviderCurrent(clientId: string, expected: Awaited<ReturnType<typeof getClientProvider>>) {
  const current = await getClientProvider(clientId);
  return !current.resolutionRequired && current.origin === expected.origin && current.revision === expected.revision && current.activeCoachClientId === expected.activeCoachClientId;
}
