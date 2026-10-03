import { db } from "@/lib/db";
import {
  getAiCoachClientDiscoveryInTransaction,
  type AiCoachDiscoveryOffer,
} from "@/lib/ai-coach/discovery";
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
    // T-989 review MINOR 3: the guarantee below is NOT transaction isolation
    // — this `db.$transaction` sets no `isolationLevel`, so Postgres READ
    // COMMITTED applies and each statement still takes its own fresh
    // snapshot. The actual guarantee is that `getAiCoachClientDiscoveryInTransaction`
    // is handed these exact `origin`/`resolutionRequired`/`profile`/
    // `entitlement` values as arguments and never re-reads them itself (see
    // discovery.ts), so the offer cannot disagree with `origin` no matter
    // what any other row looks like by the time this runs. `origin` stays
    // the single provider authority; this only ever adds an *offer*
    // alongside a NONE result. Do not rely on "same transaction" for
    // consistency here — a future re-read of ClientCoachingContext.mode
    // inside this block would NOT be protected by it.
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
 * Deliberately does not compare `aiPreviewAvailable`/`aiDiscovery`. T-989
 * review MINOR 4: it is NOT true that those fields can only change alongside
 * `origin`/`activeCoachClientId`/`resolutionRequired` — an entitlement
 * revoked or expiring, an `AiCoachProfile` created or deleted,
 * `deactivateAiCoachLiveRelease` running, `User.isDeactivated`/`isClient`
 * flipping, or a `CoachClient` row inserted without a context update can all
 * flip the offer while those three compared fields stay identical. The
 * actual reason it is safe to leave out: the offer is a display-only field
 * whose mid-request flicker cannot return a stale plan. (S-34: the offer
 * HAS been on the wire since `/api/client/coaching-context` shipped —
 * `app/api/client/coaching-context/route.ts` spreads the whole
 * `getClientProvider` object through `aiHttp` rather than naming fields, so
 * `rg 'aiDiscovery|aiPreviewAvailable' app/api/` finding nothing there
 * proves nothing about what's on the wire. The real reason this function
 * still doesn't compare it: comparing it would spuriously 409 this
 * function's three callers' unrelated meal-plan and training reads for an
 * entitlement that merely expired or a release that merely deactivated
 * mid-request — worse, not safer.) Revisit the day a *decision* (not just a
 * display) is keyed off the offer inside one of these three callers. */
export async function isClientProviderCurrent(clientId: string, expected: Awaited<ReturnType<typeof getClientProvider>>) {
  const current = await getClientProvider(clientId);
  return !current.resolutionRequired && current.origin === expected.origin && current.revision === expected.revision && current.activeCoachClientId === expected.activeCoachClientId;
}

/** S-34: the full shape `getClientProvider` resolves to, named once so the
 * two routing predicates below and their callers share one type instead of
 * each re-deriving `Awaited<ReturnType<typeof getClientProvider>>`. */
export type ClientProviderState = Awaited<ReturnType<typeof getClientProvider>>;

/** The AI workspace replaces the client tabs only for a real provider: an
 * enrolled client, or the non-production synthetic fixture preview. A live
 * discovery *offer* is not a provider switch — mirrors iOS
 * `ClientProviderModel.phase` (steadyfast/Features/App/ClientProviderModel.swift:377-387).
 * Six guards (`app/client/layout.tsx`, `app/client/page.tsx`,
 * `app/client/plan/page.tsx`, `app/client/training/page.tsx`,
 * `app/client/meal-plan/page.tsx`, `app/client/check-in/page.tsx`) call this
 * one predicate so they cannot drift (standing rule 1). */
export function rendersAiWorkspace(p: ClientProviderState): boolean {
  return p.origin === "AI" || (p.aiPreviewAvailable && !p.aiDiscovery);
}

/** Type guard: whether `/client` should render the coaching chooser instead
 * of today's dashboard, narrowing `aiDiscovery` to non-null for the caller.
 * Structurally impossible to be true at the same time as
 * `rendersAiWorkspace` — origin "AI" excludes both this and the offer
 * (`discovery.ts`'s `HUMAN_PROVIDER_ACTIVE`/offer logic never fires for
 * origin AI), and the synthetic-preview arm of `rendersAiWorkspace` requires
 * `aiDiscovery === null`. */
export function rendersCoachingChooser(
  p: ClientProviderState
): p is ClientProviderState & { aiDiscovery: AiCoachDiscoveryOffer } {
  return !p.resolutionRequired && p.origin !== "AI" && p.aiDiscovery !== null;
}
