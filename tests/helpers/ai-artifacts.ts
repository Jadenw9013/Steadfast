import { db } from "@/lib/db";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "@/lib/ai-coach/artifacts/schema";

function referenceOf(
  artifact: ArtifactDraftInput<SignedArtifactReviewMetadata>
): ArtifactReference {
  return {
    id: artifact.id,
    artifactKey: artifact.artifactKey,
    version: artifact.version,
    kind: artifact.kind,
    digest: artifactContentDigest(artifact),
  };
}

/**
 * Publishes a fresh version of the fixed-key synthetic runtime set. Tests use
 * a monotonically increasing version so an expired retained fixture from an
 * earlier local run never makes the current run silently fall back to an
 * unbound snapshot.
 */
export async function publishFreshRuntimeFixtureArtifacts(): Promise<ArtifactReference[]> {
  const prior = await db.aiCoachArtifactVersion.findFirst({
    where: { kind: "POLICY_BUNDLE", artifactKey: "policy-fixture-v1" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (prior?.version ?? 0) + 1;
  const built = buildSyntheticArtifactSet("t1008-runtime", version);
  const leafDrafts = [
    built.foodCatalog,
    built.exerciseCatalog,
    built.evidenceRegistry,
    built.escalationTemplates,
  ].map((source) => {
    const artifact = structuredClone(source);
    artifact.id = `${artifact.artifactKey}:v${version}`;
    artifact.version = version;
    artifact.content.version = version;
    return artifact;
  });
  const policy = structuredClone(built.policyBundle);
  policy.id = `${policy.artifactKey}:v${version}`;
  policy.version = version;
  policy.content.version = version;
  policy.dependencies = leafDrafts.map(referenceOf);

  const effectiveAt = new Date(Date.now() - 60_000);
  const expiresAt = new Date(Date.now() + 3_600_000);
  for (const artifact of [...leafDrafts, policy]) {
    await registerArtifactVersion(artifact);
    await publishArtifactVersion({
      id: artifact.id,
      effectiveAt,
      expiresAt,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
  }
  return [...leafDrafts.map(referenceOf), referenceOf(policy)].sort((a, b) =>
    a.kind.localeCompare(b.kind)
  );
}
