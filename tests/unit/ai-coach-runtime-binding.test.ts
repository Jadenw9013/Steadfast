import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactLoadError } from "@/lib/ai-coach/artifacts/repository";
import type { ArtifactReference } from "@/lib/ai-coach/artifacts/schema";
import {
  generationBindingFromSnapshot,
  liveArtifactRequest,
  resolveAiCoachRuntimeBinding,
  resolvedRuntimeArtifactSetSchema,
} from "@/lib/ai-coach/runtime-binding";
import { runSnapshotSchema } from "@/lib/ai-coach/run-command";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { FOOD_CATALOG_VERSION } from "@/lib/ai-coach/catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "@/lib/ai-coach/catalog/exercise-catalog";
import { LEGACY_RUN_SNAPSHOT } from "../fixtures/ai-coach-legacy-run-snapshot";

function reference(overrides: Partial<ArtifactReference> = {}): ArtifactReference {
  return {
    id: "synthetic-artifact:v1",
    artifactKey: "synthetic-artifact-key",
    version: 1,
    kind: "FOOD_CATALOG",
    digest: "a".repeat(64),
    ...overrides,
  };
}

describe("T-2000 — resolveAiCoachRuntimeBinding (synthetic branch)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves a synthetic profile to FIXTURE mode when fixture mode is enabled", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    const binding = await resolveAiCoachRuntimeBinding(null, { isSynthetic: true });
    expect(binding.mode).toBe("FIXTURE");
    expect(binding.liveRelease).toBeNull();
    expect(binding.artifactRequest.policyArtifactKey).toBe("policy-fixture-v1");
    expect(binding.artifactRequest.exactReferences).toBeUndefined();
  });

  it("throws TEMPORARILY_UNAVAILABLE (503) for a synthetic profile when fixture mode is not enabled", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "");
    await expect(resolveAiCoachRuntimeBinding(null, { isSynthetic: true })).rejects.toMatchObject(
      { code: "TEMPORARILY_UNAVAILABLE", status: 503 }
    );
  });

  it("throws TEMPORARILY_UNAVAILABLE (503) for a synthetic profile in production regardless of the fixture flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    await expect(resolveAiCoachRuntimeBinding(null, { isSynthetic: true })).rejects.toMatchObject(
      { code: "TEMPORARILY_UNAVAILABLE", status: 503 }
    );
  });
});

describe("T-2000 — liveArtifactRequest", () => {
  it("throws ARTIFACT_INCOMPATIBLE when the binding set has no POLICY_BUNDLE reference", () => {
    const bindings = [reference({ kind: "FOOD_CATALOG" }), reference({ kind: "EXERCISE_CATALOG" })];
    expect(() => liveArtifactRequest("engine-v1", bindings)).toThrow(ArtifactLoadError);
    try {
      liveArtifactRequest("engine-v1", bindings);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ArtifactLoadError);
      expect((err as ArtifactLoadError).code).toBe("ARTIFACT_INCOMPATIBLE");
    }
  });

  it("resolves the policy artifact key from the POLICY_BUNDLE binding and carries every exact reference", () => {
    const policyBinding = reference({
      kind: "POLICY_BUNDLE",
      artifactKey: "live-policy-key",
      id: "live-policy-key:v1",
    });
    const bindings = [
      policyBinding,
      reference({ kind: "FOOD_CATALOG", artifactKey: "live-food-key" }),
      reference({ kind: "EXERCISE_CATALOG", artifactKey: "live-exercise-key" }),
    ];
    const request = liveArtifactRequest("engine-v1", bindings);
    expect(request.engineVersion).toBe("engine-v1");
    expect(request.policyArtifactKey).toBe("live-policy-key");
    expect(request.exactReferences).toEqual(bindings);
    expect(request.exactReferences).not.toBe(bindings);
  });
});

/**
 * T-2041 — the resolved runtime artifact set is the single authority for
 * "which reviewed content produced these numbers". A *mixed* set — one whose
 * claimed keys do not match the references it carries — must be
 * unrepresentable, because a snapshot carrying one would let the executor
 * stamp a candidate with keys no loaded artifact ever supplied.
 */
function fixtureRef(kind: ArtifactReference["kind"], artifactKey: string): ArtifactReference {
  return { id: `${artifactKey}:v1`, artifactKey, version: 1, kind, digest: "b".repeat(64) };
}

const FIXTURE_SET = {
  mode: "FIXTURE" as const,
  engineVersion: "ai-coach-artifact-engine-v1",
  synthetic: true,
  contentKind: "SYNTHETIC_FIXTURE" as const,
  modelConfiguration: "synthetic-template-v1",
  policyVersion: "policy-fixture-v1",
  catalogVersions: { food: "food-fixture-v2", exercise: "exercise-fixture-v1" },
  artifactRefs: [
    fixtureRef("ESCALATION_TEMPLATES", "synthetic-escalation-t1008-runtime"),
    fixtureRef("EVIDENCE_REGISTRY", "synthetic-evidence-t1008-runtime"),
    fixtureRef("EXERCISE_CATALOG", "exercise-fixture-v1"),
    fixtureRef("FOOD_CATALOG", "food-fixture-v2"),
    fixtureRef("POLICY_BUNDLE", "policy-fixture-v1"),
  ],
};

const LIVE_SET = {
  ...FIXTURE_SET,
  mode: "LIVE" as const,
  synthetic: false,
  contentKind: "REVIEWED_LIVE_V1" as const,
  modelConfiguration: "synthetic-final-provider-v1:v1",
  policyVersion: "live-policy",
  catalogVersions: { food: "live-food", exercise: "live-exercise" },
  artifactRefs: [
    fixtureRef("ESCALATION_TEMPLATES", "live-escalation"),
    fixtureRef("EVIDENCE_REGISTRY", "live-evidence"),
    fixtureRef("EXERCISE_CATALOG", "live-exercise"),
    fixtureRef("FOOD_CATALOG", "live-food"),
    fixtureRef("POLICY_BUNDLE", "live-policy"),
  ],
};

describe("T-2041 — resolvedRuntimeArtifactSetSchema", () => {
  it("accepts a well-formed FIXTURE set", () => {
    expect(resolvedRuntimeArtifactSetSchema.safeParse(FIXTURE_SET).success).toBe(true);
  });

  it("accepts a well-formed LIVE set", () => {
    expect(resolvedRuntimeArtifactSetSchema.safeParse(LIVE_SET).success).toBe(true);
  });

  it("rejects four references instead of five", () => {
    const set = { ...FIXTURE_SET, artifactRefs: FIXTURE_SET.artifactRefs.slice(0, 4) };
    expect(resolvedRuntimeArtifactSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects two references of the same kind", () => {
    const set = {
      ...FIXTURE_SET,
      artifactRefs: [
        ...FIXTURE_SET.artifactRefs.slice(0, 4),
        fixtureRef("FOOD_CATALOG", "food-fixture-v2-duplicate"),
      ],
    };
    expect(resolvedRuntimeArtifactSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects a policyVersion that disagrees with the POLICY_BUNDLE reference", () => {
    const set = { ...FIXTURE_SET, policyVersion: "policy-fixture-v9" };
    expect(resolvedRuntimeArtifactSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects a catalogVersions.food that disagrees with the FOOD_CATALOG reference", () => {
    const set = {
      ...FIXTURE_SET,
      catalogVersions: { ...FIXTURE_SET.catalogVersions, food: "food-fixture-v9" },
    };
    expect(resolvedRuntimeArtifactSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects synthetic: false carrying contentKind SYNTHETIC_FIXTURE", () => {
    const set = { ...LIVE_SET, contentKind: "SYNTHETIC_FIXTURE" as const };
    expect(resolvedRuntimeArtifactSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects mode FIXTURE with synthetic: false", () => {
    const set = { ...LIVE_SET, mode: "FIXTURE" as const };
    expect(resolvedRuntimeArtifactSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects duplicate artifact reference IDs", () => {
    const refs = FIXTURE_SET.artifactRefs.map((ref) => ({ ...ref, id: "same:v1" }));
    expect(
      resolvedRuntimeArtifactSetSchema.safeParse({ ...FIXTURE_SET, artifactRefs: refs }).success
    ).toBe(false);
  });
});

describe("T-2041 — generationBindingFromSnapshot", () => {
  it("returns exactly the fixture constants for a snapshot with no runtimeBinding", () => {
    const snapshot = runSnapshotSchema.parse(LEGACY_RUN_SNAPSHOT);
    expect(generationBindingFromSnapshot(snapshot)).toEqual({
      synthetic: true,
      contentKind: "SYNTHETIC_FIXTURE",
      policyVersion: ACTIVE_POLICY_VERSION,
      catalogVersions: { food: FOOD_CATALOG_VERSION, exercise: EXERCISE_CATALOG_VERSION },
    });
  });

  it("returns the binding's four values for a snapshot that carries one", () => {
    const snapshot = runSnapshotSchema.parse({
      ...LEGACY_RUN_SNAPSHOT,
      synthetic: LIVE_SET.synthetic,
      policyVersion: LIVE_SET.policyVersion,
      catalogVersions: LIVE_SET.catalogVersions,
      modelConfiguration: LIVE_SET.modelConfiguration,
      runtimeBinding: LIVE_SET,
    });
    expect(generationBindingFromSnapshot(snapshot)).toEqual({
      synthetic: false,
      contentKind: "REVIEWED_LIVE_V1",
      policyVersion: "live-policy",
      catalogVersions: { food: "live-food", exercise: "live-exercise" },
    });
  });
});
