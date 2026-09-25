import { runConstrainedProviderBoundary } from "./constrained-boundary";
import { loadApprovedConstrainedGatewayProvider } from "./live-gateway";
import { liveArtifactRequest } from "../runtime-binding";

/**
 * Deliberately not exported from a route. The final live-plan orchestrator will
 * call this server function after it has produced an authoritative candidate.
 * The policy selector is derived from the active packet, never from the caller.
 */
export async function runActiveConstrainedProviderBoundary(rawInput: unknown) {
  const { release, provider, executionPolicy } = await loadApprovedConstrainedGatewayProvider();
  const request = liveArtifactRequest(release.engineVersion, release.artifactBindings);
  return runConstrainedProviderBoundary(request, rawInput, provider, {
    promptContractVersion: release.runtimeConfiguration.providerBoundary.promptContractVersion,
    languageProvenance: "CURRENT_CLIENT_VALIDATED",
    preferenceIds: release.runtimeConfiguration.providerBoundary.allowedPreferenceIds,
    clarificationIds: release.runtimeConfiguration.providerBoundary.allowedClarificationIds,
    limitations: release.runtimeConfiguration.providerBoundary.limitations,
    providerConfiguration: `${release.runtimeConfiguration.provider.configurationId}@${release.runtimeConfiguration.provider.version}:${release.runtimeConfigurationDigest}`,
    executionPolicy,
  });
}
