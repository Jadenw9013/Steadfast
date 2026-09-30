import type { ArtifactReference } from "@/lib/ai-coach/artifacts/schema";
import { publishRuntimeFixtureArtifactSet } from "@/lib/ai-coach/artifacts/fixture-seed";

/**
 * Publishes a fresh version of the fixed-key synthetic runtime set. Tests use
 * a monotonically increasing version so an expired retained fixture from an
 * earlier local run never makes the current run silently fall back to an
 * unbound snapshot.
 *
 * Kept deliberately short (1 hour, the original literal): this is a
 * test-only fixture whose lifetime should never outlive a single test run.
 * S-27 lifted the builder itself into `lib/ai-coach/artifacts/fixture-seed.ts`
 * so `pnpm ai-coach:seed-fixtures` (a long-expiry *development* seed) shares
 * it instead of re-implementing it — this function's behavior and return
 * shape are unchanged, so no test that calls it moves.
 */
export async function publishFreshRuntimeFixtureArtifacts(): Promise<ArtifactReference[]> {
  const published = await publishRuntimeFixtureArtifactSet({
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return published.map((ref) => ({
    id: ref.id,
    artifactKey: ref.artifactKey,
    version: ref.version,
    kind: ref.kind,
    digest: ref.digest,
  }));
}
