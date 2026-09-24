import { db } from "@/lib/db";
import { assertActiveAiCoachLiveReleaseReady } from "./live-launch/repository";

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

/** Public-safe approved copy only. Any gate failure is indistinguishable from unavailable. */
export async function getAiCoachPublicDiscoveryOffer(): Promise<AiCoachDiscoveryOffer | null> {
  try {
    const release = await assertActiveAiCoachLiveReleaseReady();
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
  } catch {
    return null;
  }
}

export async function getAiCoachClientDiscovery(clientId: string) {
  const offer = await getAiCoachPublicDiscoveryOffer();
  if (!offer) return { available: false as const, reasonCode: "LIVE_RELEASE_UNAVAILABLE" as const };
  const [user, context, profile, entitlement, humanRelationshipCount] = await Promise.all([
    db.user.findUnique({
      where: { id: clientId },
      select: { isClient: true, isDeactivated: true },
    }),
    db.clientCoachingContext.findUnique({ where: { clientId } }),
    db.aiCoachProfile.findUnique({ where: { clientId }, select: { isSynthetic: true } }),
    db.aiCoachEntitlement.findUnique({ where: { clientId } }),
    db.coachClient.count({ where: { clientId } }),
  ]);
  if (!user?.isClient || user.isDeactivated)
    return { available: false as const, reasonCode: "ACCOUNT_INELIGIBLE" as const };
  if (context?.resolutionRequired)
    return { available: false as const, reasonCode: "PROVIDER_RESOLUTION_REQUIRED" as const };
  if (context?.mode === "HUMAN" || humanRelationshipCount > 0)
    return { available: false as const, reasonCode: "HUMAN_PROVIDER_ACTIVE" as const };
  if (!profile || profile.isSynthetic)
    return { available: false as const, reasonCode: "LIVE_PROFILE_REQUIRED" as const };
  if (
    !entitlement ||
    entitlement.revokedAt ||
    (entitlement.expiresAt && entitlement.expiresAt <= new Date())
  )
    return { available: false as const, reasonCode: "ENTITLEMENT_REQUIRED" as const };
  return { available: true as const, reasonCode: null, offer };
}
