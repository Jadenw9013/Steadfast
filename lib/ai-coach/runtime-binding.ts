import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { AiCoachError, requireFixtureRuntime } from "./access";
import { ArtifactLoadError, type ArtifactLoadRequest } from "./artifacts/repository";
import type { ArtifactReference } from "./artifacts/schema";
import { SYNTHETIC_ARTIFACT_ENGINE_VERSION } from "./artifacts/synthetic-fixtures";
import type { ActiveAiCoachLiveRelease } from "./live-launch/repository";
import { ACTIVE_POLICY_VERSION } from "./policy/policy-version";
import { runConstrainedProviderBoundary } from "./provider/constrained-boundary";
import { SyntheticConstrainedProvider } from "./provider/synthetic-provider";

/**
 * T-2000 — single runtime-binding resolver. A synthetic profile resolves to
 * the locked fixture artifact set; a non-synthetic profile resolves to the
 * sole ACTIVE live release's exact-reference artifact bindings. Everything
 * downstream (finalization, acceptance, the constrained-provider boundary)
 * consults this binding instead of branching on `isSynthetic` itself.
 */
export type AiCoachRuntimeBinding =
  | { mode: "FIXTURE"; artifactRequest: ArtifactLoadRequest; liveRelease: null }
  | { mode: "LIVE"; artifactRequest: ArtifactLoadRequest; liveRelease: ActiveAiCoachLiveRelease };

/** T-2000 review finding 5: one fact, not two literals. The fixture-mode
 * runtime binding's policy key must always equal `ACTIVE_POLICY_VERSION` —
 * the same constant `checkPolicyVersionUsable`'s one-argument (legacy) form
 * checks against — so the two paths can never silently diverge on which
 * fixture policy version is "the" current one. */
const RUNTIME_POLICY_KEY: string = ACTIVE_POLICY_VERSION;

/** Moved verbatim from finalization.ts. Not part of the frozen public contract;
 * only resolveAiCoachRuntimeBinding's FIXTURE branch needs it now that
 * finalization and acceptance read `binding.artifactRequest` instead. */
function syntheticRuntimeArtifactRequest(): ArtifactLoadRequest {
  return {
    engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    policyArtifactKey: RUNTIME_POLICY_KEY,
  };
}

/** Exact-reference request from the sole ACTIVE packet. Moved verbatim from live-boundary.ts:6-21. */
export function liveArtifactRequest(
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
 * Fails closed: throws AiCoachError("TEMPORARILY_UNAVAILABLE", ..., 503) when
 * neither the fixture branch nor the live branch applies. `tx` is optional so
 * both transactional callers (pass their open transaction) and one-off
 * non-transactional callers (pass null) share this one resolver.
 *
 * `preResolvedLiveRelease` (T-2000 review finding 6): a caller that already
 * holds the ACTIVE release from its own `lockAiClient` call in the same
 * transaction (e.g. `getAiWorkspace`) passes it through here instead of
 * paying for a second `assertActiveAiCoachLiveReleaseReadyInTransaction` —
 * which re-loads and re-digests every artifact in the set — on every read.
 * Omitted or `null`, behavior is unchanged (resolves fresh).
 */
export async function resolveAiCoachRuntimeBinding(
  tx: Prisma.TransactionClient | null,
  profile: { isSynthetic: boolean },
  preResolvedLiveRelease?: ActiveAiCoachLiveRelease | null
): Promise<AiCoachRuntimeBinding> {
  if (profile.isSynthetic) {
    requireFixtureRuntime();
    return {
      mode: "FIXTURE",
      artifactRequest: syntheticRuntimeArtifactRequest(),
      liveRelease: null,
    };
  }
  // Dynamic import, as access.ts:37 already does, to keep the existing
  // lib/ai-coach/access.ts <-> lib/ai-coach/live-launch/repository.ts cycle break.
  const repository = await import("./live-launch/repository");
  try {
    const release =
      preResolvedLiveRelease ??
      (tx
        ? await repository.assertActiveAiCoachLiveReleaseReadyInTransaction(tx)
        : await repository.assertActiveAiCoachLiveReleaseReady());
    return {
      mode: "LIVE",
      artifactRequest: liveArtifactRequest(release.engineVersion, release.artifactBindings),
      liveRelease: release,
    };
  } catch (err) {
    // T-2000 review / parity finding P5: both error classes extend the plain
    // `Error` base (neither is an `AiCoachError`), so leaving either
    // unwrapped lets it escape `aiHttp`'s generic branch as an unreadable
    // message plus a spurious `reportServerError` anomaly. Both map to the
    // same stable, already-documented code: the account has no currently
    // usable runtime binding.
    if (err instanceof repository.LiveLaunchError || err instanceof ArtifactLoadError) {
      throw new AiCoachError(
        "TEMPORARILY_UNAVAILABLE",
        "AI coaching is not available for live use yet.",
        503
      );
    }
    throw err;
  }
}

/**
 * Resolves the caller's own profile via getCurrentDbUser(); for non-transactional
 * callers. Part of the frozen T-2000 contract. No current caller: `finalizeCurrentClientPlan`
 * and `acceptPlanVersionAtomic` both resolve the binding from an explicit,
 * trusted `clientId` via `resolveAiCoachRuntimeBinding` directly instead (see
 * T-2000 review round 1, finding "deviation 1" — neither function has a
 * Clerk-session dependency by design). Reserved for a future
 * non-transactional, session-authenticated caller.
 */
export async function resolveCurrentClientRuntimeBinding(): Promise<AiCoachRuntimeBinding> {
  const user = await getCurrentDbUser();
  const profile = await db.aiCoachProfile.findUnique({
    where: { clientId: user.id },
    select: { isSynthetic: true },
  });
  if (!profile) throw new AiCoachError("FORBIDDEN", "An AI Coach profile is required.", 403);
  return resolveAiCoachRuntimeBinding(null, profile);
}

/** FIXTURE -> runConstrainedProviderBoundary(request, input, new SyntheticConstrainedProvider());
 *  LIVE    -> runActiveConstrainedProviderBoundary(input). One call site, one selector. */
export async function runRuntimeConstrainedProviderBoundary(
  binding: AiCoachRuntimeBinding,
  input: unknown
): ReturnType<typeof runConstrainedProviderBoundary> {
  if (binding.mode === "FIXTURE") {
    return runConstrainedProviderBoundary(
      binding.artifactRequest,
      input,
      new SyntheticConstrainedProvider()
    );
  }
  // Dynamic import to avoid a static cycle with provider/live-boundary.ts,
  // which imports liveArtifactRequest from this module.
  const { runActiveConstrainedProviderBoundary } = await import("./provider/live-boundary");
  return runActiveConstrainedProviderBoundary(input);
}
