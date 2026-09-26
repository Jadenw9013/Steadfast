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

describe("T-2038 — the additive exercise-catalog fields move no already-registered byte", () => {
  /**
   * Captured from this branch's base, `team/sprint-1@72bf255`, before the
   * optional fields were added. `artifactContentDigest` hashes review metadata,
   * compatibility and content together, and every registered artifact row is
   * bound to its digest, so a `.default()`, a reordered key or a dropped
   * `.strict()` in `artifacts/schema.ts` would invalidate all of them silently.
   */
  const DIGESTS_BEFORE_T2038: Record<string, Record<string, string>> = {
    "t1005-fixture": {
      foodCatalog: "5c5153170d060f62937fb58eea635e869978f2e5445413709732fd5b577d7a7a",
      exerciseCatalog: "9ec1b46668a9f3334ce310500f88ef4591b1d193033cdaf2cd5c81cbe07cb594",
      evidenceRegistry: "3a946969a4053dc12a80057b4d48b658961fa09fca070764eb056c756d5d4feb",
      escalationTemplates: "9765ae01912b2c8ea0ec82e508640481dcc940c6af48f8ddf821bdc9294feb4c",
      policyBundle: "225de40fb936f1b0c94ca8415b95bd46ac55b6b95c9ff23ba71f46d50e3c32d4",
    },
    "t1008-runtime": {
      foodCatalog: "9d7eb3f81a2fc045345f79a315aead0a5c2779178ab0385eca13fef3abd92695",
      exerciseCatalog: "17af02f644e7e6effba953e9ba97f6ffe9cb5c75572992e927649ce09bea469f",
      evidenceRegistry: "5ca52850969c44d856f193f9481afa5063811e45f70bb660325a7c97d78b8ecc",
      escalationTemplates: "4082649b7259f1d6dd7274b9c66bf4404b8628637d6dd85063a47a3162cdf956",
      policyBundle: "87c0fb9ca421851f7bd02590a3ca56bcebd3f71dc3388c7645438d3ef4ba93e8",
    },
  };

  it("still parses every synthetic artifact to its pre-change digest", () => {
    for (const [namespace, expected] of Object.entries(DIGESTS_BEFORE_T2038)) {
      const set =
        namespace === "t1005-fixture"
          ? buildSyntheticArtifactSet()
          : buildSyntheticArtifactSet(namespace);
      for (const key of Object.keys(expected) as (keyof typeof set)[]) {
        const artifact = set[key] as Parameters<typeof parseArtifactDraftInput>[0];
        expect(parseArtifactDraftInput(artifact)).toEqual(artifact);
        expect({ namespace, key, digest: artifactContentDigest(artifact) }).toEqual({
          namespace,
          key,
          digest: expected[key as string],
        });
      }
    }
  });

  it("cross-checks equipmentAlternatives only when the field is present", () => {
    const base = structuredClone(
      buildSyntheticArtifactSet("unit-equipment-alternatives").exerciseCatalog
    );
    const content = exerciseCatalogContentSchema.parse(base.content);

    // Absent: parses, exactly as every already-registered artifact does.
    expect(content.exercises[0].equipmentAlternatives).toBeUndefined();
    expect(() => exerciseCatalogContentSchema.parse(content)).not.toThrow();

    const dangling = structuredClone(content);
    dangling.exercises[0].equipmentAlternatives = [
      { equipmentId: "EQUIPMENT_NONE", exerciseId: "model-invented-exercise-id" },
    ];
    expect(() => exerciseCatalogContentSchema.parse(dangling)).toThrow(
      "references unknown authoritative ID"
    );

    const resolvable = structuredClone(content);
    resolvable.exercises[0].equipmentAlternatives = [
      { equipmentId: "EQUIPMENT_NONE", exerciseId: content.exercises[0].id },
    ];
    expect(() => exerciseCatalogContentSchema.parse(resolvable)).not.toThrow();
  });
});
