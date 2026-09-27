import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { AiCoachError, requireFixtureRuntime } from "./access";
import {
  ArtifactLoadError,
  resolveArtifactSetForClient,
  type ArtifactLoadRequest,
  type LoadedArtifact,
  type ReviewedArtifactSet,
} from "./artifacts/repository";
import { artifactReferenceSchema, type ArtifactReference } from "./artifacts/schema";
import { SYNTHETIC_ARTIFACT_ENGINE_VERSION } from "./artifacts/synthetic-fixtures";
import type { ActiveAiCoachLiveRelease } from "./live-launch/repository";
import { ACTIVE_POLICY_VERSION } from "./policy/policy-version";
// Type-only: `run-command.ts` imports values from this module, so importing
// `RunSnapshot` as a type keeps the edge erased and creates no runtime cycle.
import type { RunSnapshot } from "./run-command";
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

/**
 * T-2041 — the resolved runtime artifact set, frozen into the run snapshot at
 * `requestAiRun` and the single authority for the rest of the run's life.
 *
 * Every field is *projected off persisted, digest-verified artifacts* or off
 * the ACTIVE release packet. This module chooses no key, no version and no
 * number of its own; the one literal that survives is the FIXTURE-mode
 * `modelConfiguration`, which names the in-code synthetic template.
 *
 * The `superRefine` below makes a mixed set unrepresentable: the three keys
 * the set claims must be the `artifactKey`s of the references it carries, so
 * "which content produced these numbers" has exactly one answer.
 */
export const RUNTIME_ARTIFACT_KINDS = [
  "POLICY_BUNDLE",
  "FOOD_CATALOG",
  "EXERCISE_CATALOG",
  "EVIDENCE_REGISTRY",
  "ESCALATION_TEMPLATES",
] as const;

export const FIXTURE_MODEL_CONFIGURATION = "synthetic-template-v1";

export const resolvedRuntimeArtifactSetSchema = z
  .object({
    mode: z.enum(["FIXTURE", "LIVE"]),
    engineVersion: z.string().min(1).max(120),
    synthetic: z.boolean(),
    contentKind: z.enum(["SYNTHETIC_FIXTURE", "REVIEWED_LIVE_V1"]),
    modelConfiguration: z.string().min(1).max(120),
    policyVersion: z.string().min(1).max(120),
    catalogVersions: z
      .object({ food: z.string().min(1).max(120), exercise: z.string().min(1).max(120) })
      .strict(),
    artifactRefs: z.array(artifactReferenceSchema).length(5),
  })
  .strict()
  .superRefine((set, ctx) => {
    const byKind = new Map(set.artifactRefs.map((ref) => [ref.kind, ref] as const));
    if (byKind.size !== set.artifactRefs.length) {
      ctx.addIssue({
        code: "custom",
        path: ["artifactRefs"],
        message: "A runtime artifact set carries exactly one reference per kind.",
      });
      return;
    }
    for (const kind of RUNTIME_ARTIFACT_KINDS) {
      if (!byKind.has(kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["artifactRefs"],
          message: `A runtime artifact set is missing its ${kind} reference.`,
        });
        return;
      }
    }
    const ids = set.artifactRefs.map((ref) => ref.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["artifactRefs"],
        message: "Artifact reference IDs must be unique.",
      });
    }
    if (set.policyVersion !== byKind.get("POLICY_BUNDLE")!.artifactKey) {
      ctx.addIssue({
        code: "custom",
        path: ["policyVersion"],
        message: "policyVersion must be the POLICY_BUNDLE reference's artifactKey.",
      });
    }
    if (set.catalogVersions.food !== byKind.get("FOOD_CATALOG")!.artifactKey) {
      ctx.addIssue({
        code: "custom",
        path: ["catalogVersions", "food"],
        message: "catalogVersions.food must be the FOOD_CATALOG reference's artifactKey.",
      });
    }
    if (set.catalogVersions.exercise !== byKind.get("EXERCISE_CATALOG")!.artifactKey) {
      ctx.addIssue({
        code: "custom",
        path: ["catalogVersions", "exercise"],
        message: "catalogVersions.exercise must be the EXERCISE_CATALOG reference's artifactKey.",
      });
    }
    if (set.contentKind !== (set.synthetic ? "SYNTHETIC_FIXTURE" : "REVIEWED_LIVE_V1")) {
      ctx.addIssue({
        code: "custom",
        path: ["contentKind"],
        message: "contentKind must follow the artifact set's own synthetic classification.",
      });
    }
    if (set.mode === "FIXTURE" && !set.synthetic) {
      ctx.addIssue({
        code: "custom",
        path: ["synthetic"],
        message: "A FIXTURE runtime binding can only carry synthetic artifacts.",
      });
    }
  });
export type ResolvedRuntimeArtifactSet = z.infer<typeof resolvedRuntimeArtifactSetSchema>;

function referenceOf(artifact: LoadedArtifact): ArtifactReference {
  return {
    id: artifact.id,
    artifactKey: artifact.artifactKey,
    version: artifact.version,
    kind: artifact.kind,
    digest: artifact.contentDigest,
  };
}

/**
 * The five exact references of a loaded set, sorted by kind so the stored
 * value — and therefore every hash of it — is deterministic regardless of
 * load order. One implementation, used both when the set is frozen into a
 * run snapshot and when finalization re-derives today's set to compare
 * against that frozen one.
 */
export function runtimeArtifactRefs(artifacts: ReviewedArtifactSet): ArtifactReference[] {
  return [
    artifacts.policy,
    artifacts.foodCatalog,
    artifacts.exerciseCatalog,
    artifacts.evidenceRegistry,
    artifacts.escalationTemplates,
  ]
    .map(referenceOf)
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * Loads the set `binding` points at and projects only values read off
 * persisted, digest-verified artifacts. Invents no key and no number.
 *
 * `clientId` is the **explicit, trusted, server-derived** account the binding
 * was resolved for. The frozen T-2022 contract wrote this as a one-argument
 * function over `loadReviewedArtifactSet`, but that loader resolves the
 * account from `getCurrentDbUser()`; `requestAiRun` is already handed a
 * server-derived `clientId` and must not resolve a second identity from the
 * session to decide which artifacts a run is bound to.
 *
 * With no `tx` it opens its own transaction, so it must then be called
 * **before** a caller's own `db.$transaction`, never inside it (T-2041 risk
 * 4). A caller that already holds one passes it through.
 */
export async function resolveRuntimeArtifactSet(
  binding: AiCoachRuntimeBinding,
  clientId: string,
  tx?: Prisma.TransactionClient
): Promise<ResolvedRuntimeArtifactSet> {
  const artifacts = tx
    ? await resolveArtifactSetForClient(tx, clientId, binding.artifactRequest)
    : await db.$transaction((inner) =>
        resolveArtifactSetForClient(inner, clientId, binding.artifactRequest)
      );
  return resolvedRuntimeArtifactSetSchema.parse({
    mode: binding.mode,
    engineVersion: binding.artifactRequest.engineVersion,
    synthetic: artifacts.policy.synthetic,
    contentKind: artifacts.policy.synthetic ? "SYNTHETIC_FIXTURE" : "REVIEWED_LIVE_V1",
    // FIXTURE: the one place the in-code synthetic template constant
    // survives. LIVE: an identifier copied out of the ACTIVE packet's
    // reviewed runtime configuration, never a value this codebase chooses.
    modelConfiguration:
      binding.mode === "FIXTURE"
        ? FIXTURE_MODEL_CONFIGURATION
        : `${binding.liveRelease.runtimeConfiguration.provider.configurationId}:v${binding.liveRelease.runtimeConfiguration.provider.version}`,
    policyVersion: artifacts.policy.artifactKey,
    catalogVersions: {
      food: artifacts.foodCatalog.artifactKey,
      exercise: artifacts.exerciseCatalog.artifactKey,
    },
    artifactRefs: runtimeArtifactRefs(artifacts),
  });
}

/** What generation stamps. Read from the snapshot, never from a constant. */
export type GenerationBinding = {
  synthetic: boolean;
  contentKind: "SYNTHETIC_FIXTURE" | "REVIEWED_LIVE_V1";
  policyVersion: string;
  catalogVersions: { food: string; exercise: string };
};

/**
 * `snapshot.runtimeBinding` when present; otherwise the snapshot's own four
 * top-level fields, which `runSnapshotSchema`'s `superRefine` guarantees are
 * exactly the fixture constants. No constant is read here, so a run QUEUED
 * before this change replays against the truth stored in its own row rather
 * than against whatever the constants happen to be when it executes.
 */
export function generationBindingFromSnapshot(snapshot: RunSnapshot): GenerationBinding {
  if (snapshot.runtimeBinding) {
    return {
      synthetic: snapshot.runtimeBinding.synthetic,
      contentKind: snapshot.runtimeBinding.contentKind,
      policyVersion: snapshot.runtimeBinding.policyVersion,
      catalogVersions: { ...snapshot.runtimeBinding.catalogVersions },
    };
  }
  return {
    synthetic: snapshot.synthetic,
    // A legacy snapshot is a fixture snapshot by `runSnapshotSchema`'s own
    // no-binding branch (`synthetic === true` plus the three fixture keys).
    contentKind: "SYNTHETIC_FIXTURE",
    policyVersion: snapshot.policyVersion,
    catalogVersions: { ...snapshot.catalogVersions },
  };
}
