import { ArtifactLoadError, type ArtifactLoadRequest } from "../artifacts/repository";
import type { ArtifactReference } from "../artifacts/schema";
import { runConstrainedProviderBoundary } from "./constrained-boundary";
import { loadAnthropicConstrainedProvider } from "./anthropic-provider";

function liveArtifactRequest(
  engineVersion: string,
  artifactBindings: readonly ArtifactReference[]
): ArtifactLoadRequest {
  const policy = artifactBindings.find((binding) => binding.kind === "POLICY_BUNDLE");
  if (!policy)
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The active release has no exact server-owned policy artifact binding."
    );
  return {
    engineVersion,
    policyArtifactKey: policy.artifactKey,
    exactReferences: [...artifactBindings],
  };
}

/**
 * Deliberately not exported from a route. The final live-plan orchestrator will
 * call this server function after it has produced an authoritative candidate.
 * The policy selector is derived from the active packet, never from the caller.
 */
export async function runActiveConstrainedProviderBoundary(rawInput: unknown) {
  const { release, provider, executionPolicy } = await loadAnthropicConstrainedProvider();
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
