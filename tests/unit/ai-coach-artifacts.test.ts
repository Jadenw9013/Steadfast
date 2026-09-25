import { describe, expect, it } from "vitest";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  escalationTemplatesContentSchema,
  exerciseCatalogContentSchema,
  parseArtifactDraftInput,
} from "@/lib/ai-coach/artifacts/schema";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";

describe("T-1005 — reviewed artifact schemas", () => {
  it("accepts the complete synthetic policy/catalog/evidence/escalation fixture set", () => {
    const set = buildSyntheticArtifactSet("unit-complete");
    for (const artifact of [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
      set.policyBundle,
    ]) {
      expect(parseArtifactDraftInput(artifact)).toEqual(artifact);
      expect(artifactContentDigest(artifact)).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(set.evidenceRegistry.content).toMatchObject({
      claims: [
        {
          claim: expect.any(String),
          sourceUrl: expect.any(String),
          population: expect.any(String),
          limitations: expect.any(Array),
          reviewer: expect.any(Object),
          ruleIds: expect.any(Array),
          reviewDate: expect.any(String),
        },
      ],
    });
    if (!("numericParameters" in set.policyBundle.content)) {
      throw new Error("fixture shape changed");
    }
    expect(set.policyBundle.content.numericParameters[0]).toMatchObject({
      id: "SYNTHETIC_NUMERIC_PARAMETER",
      value: 1,
      unit: "SYNTHETIC_UNIT",
    });
  });

  it("requires every explicit out-of-scope boundary before an artifact can be registered", () => {
    const artifact = structuredClone(buildSyntheticArtifactSet("unit-boundary").foodCatalog);
    artifact.reviewMetadata.explicitExclusions = ["DIAGNOSIS"];
    expect(() => parseArtifactDraftInput(artifact)).toThrow();
  });

  it("allows ACE/NASM only as public candidate scope references without copied content or endorsement", () => {
    const artifact = structuredClone(buildSyntheticArtifactSet("unit-framework").policyBundle);
    expect(artifact.reviewMetadata.publicFrameworkReferences[0]).toMatchObject({
      usage: "CANDIDATE_SCOPE_REFERENCE_ONLY",
      proprietaryMaterialCopied: false,
      endorsementOrAffiliationClaimed: false,
    });
    (
      artifact.reviewMetadata.publicFrameworkReferences[0] as {
        endorsementOrAffiliationClaimed: boolean;
      }
    ).endorsementOrAffiliationClaimed = true;
    expect(() => parseArtifactDraftInput(artifact)).toThrow();
  });

  it("requires policy bundles to bind exact digests for all four dependency kinds", () => {
    const artifact = structuredClone(buildSyntheticArtifactSet("unit-dependencies").policyBundle);
    artifact.dependencies.pop();
    expect(() => parseArtifactDraftInput(artifact)).toThrow(
      "one exact food, exercise, evidence and escalation dependency"
    );
  });

  it("binds the digest to review metadata, compatibility and authoritative content", () => {
    const artifact = buildSyntheticArtifactSet("unit-digest").foodCatalog;
    const reordered = {
      content: artifact.content,
      reviewMetadata: artifact.reviewMetadata,
      synthetic: artifact.synthetic,
      dependencies: artifact.dependencies,
      engineVersions: artifact.engineVersions,
      schemaVersion: artifact.schemaVersion,
      kind: artifact.kind,
      version: artifact.version,
      artifactKey: artifact.artifactKey,
      id: artifact.id,
    };
    expect(artifactContentDigest(reordered)).toBe(artifactContentDigest(artifact));
    const changed = structuredClone(artifact);
    if (!("items" in changed.content)) throw new Error("fixture shape changed");
    changed.content.items[0].nutrients.energyKcal += 1;
    expect(artifactContentDigest(changed)).not.toBe(artifactContentDigest(artifact));
  });

  it("rejects duplicate authoritative food, exercise, template, evidence and policy-rule IDs", () => {
    const food = structuredClone(buildSyntheticArtifactSet("unit-duplicate-food").foodCatalog);
    if (!("items" in food.content)) throw new Error("fixture shape changed");
    food.content.items.push(structuredClone(food.content.items[0]));
    expect(() => parseArtifactDraftInput(food)).toThrow("Food IDs must be unique");

    const exercise = structuredClone(
      buildSyntheticArtifactSet("unit-duplicate-exercise").exerciseCatalog
    );
    const exerciseContent = exerciseCatalogContentSchema.parse(exercise.content);
    exerciseContent.exercises.push(structuredClone(exerciseContent.exercises[0]));
    exercise.content = exerciseContent;
    expect(() => parseArtifactDraftInput(exercise)).toThrow("Exercise IDs must be unique");

    const template = structuredClone(
      buildSyntheticArtifactSet("unit-duplicate-template").exerciseCatalog
    );
    const templateContent = exerciseCatalogContentSchema.parse(template.content);
    templateContent.templates.push(structuredClone(templateContent.templates[0]));
    template.content = templateContent;
    expect(() => parseArtifactDraftInput(template)).toThrow("Exercise template IDs must be unique");

    const escalation = structuredClone(
      buildSyntheticArtifactSet("unit-duplicate-escalation").escalationTemplates
    );
    const escalationContent = escalationTemplatesContentSchema.parse(escalation.content);
    escalationContent.templates.push(structuredClone(escalationContent.templates[0]));
    escalation.content = escalationContent;
    expect(() => parseArtifactDraftInput(escalation)).toThrow(
      "Escalation template IDs must be unique"
    );

    const evidence = structuredClone(
      buildSyntheticArtifactSet("unit-duplicate-evidence").evidenceRegistry
    );
    if (!("claims" in evidence.content)) throw new Error("fixture shape changed");
    evidence.content.claims.push(structuredClone(evidence.content.claims[0]));
    expect(() => parseArtifactDraftInput(evidence)).toThrow("Evidence claim IDs must be unique");

    const policy = structuredClone(buildSyntheticArtifactSet("unit-duplicate-rule").policyBundle);
    if (!("ruleIds" in policy.content)) throw new Error("fixture shape changed");
    policy.content.ruleIds.push(policy.content.ruleIds[0]);
    expect(() => parseArtifactDraftInput(policy)).toThrow("Policy rule IDs must be unique");
  });

  it("rejects dangling same-artifact exercise and policy-rule references", () => {
    const exercise = structuredClone(
      buildSyntheticArtifactSet("unit-dangling-exercise").exerciseCatalog
    );
    const exerciseContent = exerciseCatalogContentSchema.parse(exercise.content);
    exerciseContent.templates[0].exerciseIds = ["model-invented-exercise-id"];
    exercise.content = exerciseContent;
    expect(() => parseArtifactDraftInput(exercise)).toThrow("references unknown authoritative ID");

    const policy = structuredClone(buildSyntheticArtifactSet("unit-dangling-rule").policyBundle);
    if (!("adjustmentRuleIds" in policy.content)) throw new Error("fixture shape changed");
    policy.content.adjustmentRuleIds = ["model-invented-policy-rule"];
    expect(() => parseArtifactDraftInput(policy)).toThrow("references unknown authoritative ID");
  });

  it("rejects dangling safety rule and numeric-parameter references", () => {
    const rule = structuredClone(buildSyntheticArtifactSet("unit-safety-rule").policyBundle);
    if (!("safetyControls" in rule.content)) throw new Error("fixture shape changed");
    rule.content.safetyControls.nutritionLimits.noConsecutiveDeficitRuleId = "model-invented-rule";
    expect(() => parseArtifactDraftInput(rule)).toThrow("references unknown authoritative ID");

    const parameter = structuredClone(
      buildSyntheticArtifactSet("unit-safety-parameter").policyBundle
    );
    if (!("safetyControls" in parameter.content)) throw new Error("fixture shape changed");
    parameter.content.safetyControls.nutritionLimits.minimumDailyEnergyParameterId =
      "model-invented-parameter";
    expect(() => parseArtifactDraftInput(parameter)).toThrow("references unknown authoritative ID");
  });
});
