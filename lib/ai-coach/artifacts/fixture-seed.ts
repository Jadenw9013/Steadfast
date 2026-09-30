import { db } from "@/lib/db";
import { artifactContentDigest } from "./digest";
import { publishArtifactVersion, registerArtifactVersion } from "./repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "./synthetic-fixtures";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "./schema";

/**
 * S-27 — the one builder for "publish a fresh version of the fixed-key
 * synthetic runtime artifact set", shared verbatim (CLAUDE.md rule 1)
 * between:
 *   - `tests/helpers/ai-artifacts.ts`'s `publishFreshRuntimeFixtureArtifacts`,
 *     which keeps its own short (1 hour) `expiresAt` and exact prior return
 *     shape unchanged — no test moves;
 *   - `scripts/ai-coach-seed-fixtures.ts`, the local dev seed, which passes a
 *     long, explicit `expiresAt` instead. Before this file existed, the only
 *     builder set a 1 hour expiry unconditionally — a developer who reused it
 *     directly to seed a local environment got a working environment that
 *     silently reverted to the T-2041 unbound-snapshot degrade an hour later
 *     (see docs/ai-coach/14-Handoff-Status.md and board S-26/S-27).
 *
 * Always publishes a new, monotonically increasing version (never mutates an
 * existing row), so calling it again is always safe: it can only add a
 * currently-effective version, never collide with or invalidate one another
 * caller already published.
 */
export interface PublishedFixtureArtifact extends ArtifactReference {
  effectiveAt: Date;
  expiresAt: Date;
}

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

export async function publishRuntimeFixtureArtifactSet(options?: {
  effectiveAt?: Date;
  expiresAt?: Date;
}): Promise<PublishedFixtureArtifact[]> {
  const effectiveAt = options?.effectiveAt ?? new Date(Date.now() - 60_000);
  const expiresAt = options?.expiresAt ?? new Date(Date.now() + 3_600_000);

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

  for (const artifact of [...leafDrafts, policy]) {
    await registerArtifactVersion(artifact);
    await publishArtifactVersion({
      id: artifact.id,
      effectiveAt,
      expiresAt,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
  }
  return [...leafDrafts.map(referenceOf), referenceOf(policy)]
    .map((ref) => ({ ...ref, effectiveAt, expiresAt }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}
