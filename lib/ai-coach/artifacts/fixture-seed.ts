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

/** The five fixed artifact keys the runtime fixture set occupies, read from
 * the builder itself so they cannot drift from what it registers. */
function runtimeFixtureKeys(): string[] {
  const set = buildSyntheticArtifactSet("t1008-runtime");
  return [
    set.foodCatalog,
    set.exerciseCatalog,
    set.evidenceRegistry,
    set.escalationTemplates,
    set.policyBundle,
  ].map((artifact) => artifact.artifactKey);
}

/** Bound on re-reads after a concurrent caller wins the same version. */
const MAX_PUBLISH_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * S-30: the next version is the smallest one above the latest policy bundle
 * at which NONE of the five fixed ids exists yet. Picking only
 * `latest(policy) + 1` (the previous rule) collided with any row another
 * writer already put at a leaf key — a test fixture that pinned
 * `exercise-fixture-v1:v2`, or the leaves this function itself registered
 * before an earlier attempt failed — and then failed with P2002 on every
 * later call, because the policy row that would have advanced the counter
 * was never written.
 */
async function nextFreeRuntimeFixtureVersion(): Promise<number> {
  const prior = await db.aiCoachArtifactVersion.findFirst({
    where: { kind: "POLICY_BUNDLE", artifactKey: "policy-fixture-v1" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const floor = prior?.version ?? 0;
  const occupied = await db.aiCoachArtifactVersion.findMany({
    where: { artifactKey: { in: runtimeFixtureKeys() }, version: { gt: floor } },
    select: { version: true },
  });
  const taken = new Set(occupied.map((row) => row.version));
  let version = floor + 1;
  while (taken.has(version)) version++;
  return version;
}

export async function publishRuntimeFixtureArtifactSet(options?: {
  effectiveAt?: Date;
  expiresAt?: Date;
}): Promise<PublishedFixtureArtifact[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publishRuntimeFixtureArtifactSetAt(await nextFreeRuntimeFixtureVersion(), options);
    } catch (error) {
      // A concurrent caller took the same version between the read and the
      // insert. Re-read (the version it left behind is now occupied) and try
      // again; anything else, or exhausting the bound, is rethrown unchanged.
      if (!isUniqueViolation(error) || attempt >= MAX_PUBLISH_ATTEMPTS) throw error;
    }
  }
}

async function publishRuntimeFixtureArtifactSetAt(
  version: number,
  options?: { effectiveAt?: Date; expiresAt?: Date }
): Promise<PublishedFixtureArtifact[]> {
  const effectiveAt = options?.effectiveAt ?? new Date(Date.now() - 60_000);
  const expiresAt = options?.expiresAt ?? new Date(Date.now() + 3_600_000);

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
