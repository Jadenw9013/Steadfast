import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactLoadError } from "@/lib/ai-coach/artifacts/repository";
import type { ArtifactReference } from "@/lib/ai-coach/artifacts/schema";
import {
  liveArtifactRequest,
  resolveAiCoachRuntimeBinding,
} from "@/lib/ai-coach/runtime-binding";

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
