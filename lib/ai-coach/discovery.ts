import type { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { isAiCoachEnrollmentEnabled } from "@/lib/flags/ai-coach";
import {
  assertActiveAiCoachLiveReleaseReady,
  assertActiveAiCoachLiveReleaseReadyInTransaction,
  type ActiveAiCoachLiveRelease,
} from "./live-launch/repository";

export type AiCoachDiscoveryOffer = {
  releaseId: string;
  configurationId: string;
  configurationVersion: number;
  locale: string;
  serviceLabel: string;
  headline: string;
  summary: string;
  informationHeading: string;
  disclosureParagraphs: string[];
  consentLabel: string;
  confirmLabel: string;
  privacyNoticeLabel: string;
  continueLabel: string;
  humanCoachLabel: string;
  eligibilitySummary: string;
  privacyNoticeVersion: string;
  privacyNoticeUrl: string;
  pricing: { productConfigurationId: string; displayText: string } | null;
};

function mapReleaseToOffer(release: ActiveAiCoachLiveRelease): AiCoachDiscoveryOffer {
  const discovery = release.runtimeConfiguration.discovery;
  return {
    releaseId: release.releaseId,
    configurationId: discovery.configurationId,
    configurationVersion: discovery.version,
    locale: discovery.locale,
    serviceLabel: discovery.serviceLabel,
    headline: discovery.headline,
    summary: discovery.summary,
    informationHeading: discovery.informationHeading,
    disclosureParagraphs: [...discovery.disclosureParagraphs],
    consentLabel: discovery.consentLabel,
    confirmLabel: discovery.confirmLabel,
    privacyNoticeLabel: discovery.privacyNoticeLabel,
    continueLabel: discovery.continueLabel,
    humanCoachLabel: discovery.humanCoachLabel,
    eligibilitySummary: discovery.eligibilitySummary,
    privacyNoticeVersion: discovery.privacyNoticeVersion,
    privacyNoticeUrl: discovery.privacyNoticeUrl,
    pricing: discovery.pricing,
  };
}

/** No lock, no packet join, just "is there any active release at all". This
 * runs before the locked, packet-joining verification so a caller with zero
 * AI Coach involvement (the default, flag-off state) pays for one cheap
 * indexed SELECT instead of a transaction that opens a lock, joins the
 * packet, and only exists to throw and roll back. */
async function hasActiveAiCoachLiveActivation(
  client: Prisma.TransactionClient | typeof db = db
): Promise<boolean> {
  const active = await client.aiCoachLiveActivation.findFirst({
    where: { state: "ACTIVE" },
    select: { id: true },
  });
  return active !== null;
}

/** Public-safe approved copy only. Any gate failure is indistinguishable from
 * unavailable. Two independent gates: `FEATURE_AI_COACH_ENROLLMENT` (env,
 * instantly revertible) and the governed `AiCoachLiveActivation` row (DB,
 * CLI-only). Both must be true — the env flag is a second, faster off-switch
 * on top of the DB row, never a replacement for it. */
export async function getAiCoachPublicDiscoveryOffer(): Promise<AiCoachDiscoveryOffer | null> {
  if (!isAiCoachEnrollmentEnabled()) return null;
  if (!(await hasActiveAiCoachLiveActivation())) return null;
  try {
    const release = await assertActiveAiCoachLiveReleaseReady();
    return mapReleaseToOffer(release);
  } catch {
    return null;
  }
}

/** Transaction-scoped equivalent of `getAiCoachPublicDiscoveryOffer`, used so
 * a caller that already holds a transaction (`getClientProvider`) never opens
 * a second one just to ask this question. */
async function getAiCoachPublicDiscoveryOfferInTransaction(
  tx: Prisma.TransactionClient
): Promise<AiCoachDiscoveryOffer | null> {
  if (!isAiCoachEnrollmentEnabled()) return null;
  if (!(await hasActiveAiCoachLiveActivation(tx))) return null;
  try {
    const release = await assertActiveAiCoachLiveReleaseReadyInTransaction(tx);
    return mapReleaseToOffer(release);
  } catch {
    return null;
  }
}

type AiCoachClientDiscoveryReasonCode =
  | "LIVE_RELEASE_UNAVAILABLE"
  | "ACCOUNT_INELIGIBLE"
  | "PROVIDER_RESOLUTION_REQUIRED"
  | "HUMAN_PROVIDER_ACTIVE"
  | "LIVE_PROFILE_REQUIRED"
  | "ENTITLEMENT_REQUIRED";

export type AiCoachClientDiscoveryResult =
  | { available: true; reasonCode: null; offer: AiCoachDiscoveryOffer }
  | { available: false; reasonCode: AiCoachClientDiscoveryReasonCode };

function unavailable(reasonCode: AiCoachClientDiscoveryReasonCode): AiCoachClientDiscoveryResult {
  return { available: false, reasonCode };
}

export type ResolvedProviderOriginForDiscovery = {
  origin: "NONE" | "HUMAN" | "AI";
  resolutionRequired: boolean;
  profile: { isSynthetic: boolean } | null;
  entitlement: { revokedAt: Date | null; expiresAt: Date | null } | null;
};

/**
 * Whether an AI Coach offer may be shown to this client. Takes the *already
 * resolved* origin/resolutionRequired/profile/entitlement from the same
 * transaction and the same query results `getClientProvider` used to compute
 * `origin` — it never re-queries them — so this can never disagree with
 * `origin`: a HUMAN or resolution-required client cannot see an offer no
 * matter what the release/entitlement state is. `origin` remains the single
 * provider authority; this only ever adds an *offer* on top of a NONE
 * result, read from the same snapshot.
 */
export async function getAiCoachClientDiscoveryInTransaction(
  tx: Prisma.TransactionClient,
  clientId: string,
  resolvedOrigin: ResolvedProviderOriginForDiscovery
): Promise<AiCoachClientDiscoveryResult> {
  if (resolvedOrigin.resolutionRequired) return unavailable("PROVIDER_RESOLUTION_REQUIRED");
  if (resolvedOrigin.origin === "HUMAN") return unavailable("HUMAN_PROVIDER_ACTIVE");
  const offer = await getAiCoachPublicDiscoveryOfferInTransaction(tx);
  if (!offer) return unavailable("LIVE_RELEASE_UNAVAILABLE");
  const [user, humanRelationshipCount] = await Promise.all([
    tx.user.findUnique({ where: { id: clientId }, select: { isClient: true, isDeactivated: true } }),
    tx.coachClient.count({ where: { clientId } }),
  ]);
  if (!user?.isClient || user.isDeactivated) return unavailable("ACCOUNT_INELIGIBLE");
  if (humanRelationshipCount > 0) return unavailable("HUMAN_PROVIDER_ACTIVE");
  if (!resolvedOrigin.profile || resolvedOrigin.profile.isSynthetic)
    return unavailable("LIVE_PROFILE_REQUIRED");
  if (
    !resolvedOrigin.entitlement ||
    resolvedOrigin.entitlement.revokedAt ||
    (resolvedOrigin.entitlement.expiresAt && resolvedOrigin.entitlement.expiresAt <= new Date())
  )
    return unavailable("ENTITLEMENT_REQUIRED");
  return { available: true, reasonCode: null, offer };
}
