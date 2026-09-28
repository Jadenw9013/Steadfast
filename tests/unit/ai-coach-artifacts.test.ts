import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  escalationTemplatesContentSchema,
  exerciseCatalogContentSchema,
  parseArtifactDraftInput,
  type EscalationTemplatesContent,
  type PolicyBundleContent,
} from "@/lib/ai-coach/artifacts/schema";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { resolveNutritionSafetyPolicy } from "@/lib/ai-coach/nutrition-safety";
import { resolvePrescriptionParameters } from "@/lib/ai-coach/prescription/parameters";
import { buildSyntheticSafetyFloors } from "../helpers/ai-prescription-bundle";
import {
  resolveTrainingParameters,
  TRAINING_PROGRESSION_PARAMETER_IDS,
} from "@/lib/ai-coach/training/parameters";
import { loadDraftUnsignedExerciseCatalog } from "@/lib/ai-coach/artifacts/drafts/exercise-catalog";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";

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
   * Pinned digests for synthetic artifacts. In T-2039, evidenceRegistry gained
   * the 6 training/progression rule IDs in its claim, escalationTemplates gained
   * the two reviewed effort explanation templates, and policyBundle gained the 46
   * training and progression parameters. The food and exercise catalogs are 100%
   * byte-identical to their pre-change digests.
   */
  const DIGESTS_BEFORE_T2038: Record<string, Record<string, string>> = {
    "t1005-fixture": {
      foodCatalog: "5c5153170d060f62937fb58eea635e869978f2e5445413709732fd5b577d7a7a",
      exerciseCatalog: "9ec1b46668a9f3334ce310500f88ef4591b1d193033cdaf2cd5c81cbe07cb594",
      evidenceRegistry: "8797be80c8c2cbe21af3d61eb7c54ea711ee96c344ca41124a7dc1b9169e0233",
      escalationTemplates: "fab8e295214943dfaee468a9fd1742e4f05648fe33a24942da112f960959b34b",
      policyBundle: "11421c6b62af25dec4f531eaf02f1295bae7077b39101cb48db02d9d7090f0ec",
    },
    "t1008-runtime": {
      foodCatalog: "9d7eb3f81a2fc045345f79a315aead0a5c2779178ab0385eca13fef3abd92695",
      exerciseCatalog: "17af02f644e7e6effba953e9ba97f6ffe9cb5c75572992e927649ce09bea469f",
      evidenceRegistry: "187785ffba971a5620f3cc684d561f994f815fc0ae304061f6b68e1e6545cfee",
      escalationTemplates: "73e61e47f5523db815e77fde9e460f0649d8106cc95099046e2898161a050293",
      policyBundle: "3c62489d4183265a890b422c0073ea382e173ddd18539b958d434bceaa0e907d",
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

describe("T-2039 — training and progression parameters in synthetic and draft bundles", () => {
  it("resolves all 34 composer parameters from the synthetic bundle while prescription and safety succeed", () => {
    const set = buildSyntheticArtifactSet();
    const policy = set.policyBundle.content as PolicyBundleContent;
    const escalation = set.escalationTemplates.content as EscalationTemplatesContent;

    if (!("templates" in escalation)) throw new Error("fixture shape changed");

    const explanationTexts = escalation.templates.map((t) => ({ id: t.id, text: t.nextStepText }));
    const trainingResolution = resolveTrainingParameters(policy, explanationTexts);

    expect(trainingResolution.ok).toBe(true);
    if (!trainingResolution.ok) return;

    expect(trainingResolution.parameters.exerciseCountMin).toBe(3);
    expect(trainingResolution.parameters.plannedMinutesByBand.MIN_45_60).toBe(60);
    expect(trainingResolution.parameters.setsPerExerciseByExperience.NEW).toBe(2);
    expect(trainingResolution.parameters.workloadTotalSessionsMax).toBe(6);

    const floors = buildSyntheticSafetyFloors();
    const rxResolution = resolvePrescriptionParameters(policy, ["Synthetic rx step"], floors);
    expect(rxResolution.ok).toBe(true);

    const safetyPolicy = resolveNutritionSafetyPolicy(policy);
    expect(safetyPolicy.nutritionLimits.minimumDailyEnergyKcal).toBe(1234);
  });

  it("satisfies cross-artifact rule consistency between exercise catalogs and policy bundles", () => {
    const draftCatalog = loadDraftUnsignedExerciseCatalog();
    const draftBundle = loadDraftUnsignedPolicyBundle();
    const draftBundleRuleIds = new Set(draftBundle.content.ruleIds);

    for (const ex of draftCatalog.content.exercises) {
      for (const ruleId of [
        ...(ex.contraindicationRuleIds ?? []),
        ...(ex.beginnerConstraintIds ?? []),
      ]) {
        expect(draftBundleRuleIds.has(ruleId)).toBe(true);
      }
    }
    for (const tpl of draftCatalog.content.templates) {
      for (const ruleId of tpl.beginnerConstraintIds ?? []) {
        expect(draftBundleRuleIds.has(ruleId)).toBe(true);
      }
    }

    const syntheticSet = buildSyntheticArtifactSet();
    const syntheticBundle = syntheticSet.policyBundle.content as PolicyBundleContent;
    const syntheticBundleRuleIds = new Set(syntheticBundle.ruleIds);
    const syntheticExerciseCatalog = syntheticSet.exerciseCatalog.content;

    if (!("exercises" in syntheticExerciseCatalog)) throw new Error("fixture shape changed");

    for (const ex of syntheticExerciseCatalog.exercises) {
      for (const ruleId of [...ex.contraindicationRuleIds, ...ex.beginnerConstraintIds]) {
        expect(syntheticBundleRuleIds.has(ruleId)).toBe(true);
      }
    }
    for (const tpl of syntheticExerciseCatalog.templates) {
      for (const ruleId of tpl.beginnerConstraintIds) {
        expect(syntheticBundleRuleIds.has(ruleId)).toBe(true);
      }
    }
  });

  it("contains all TRAINING_PROGRESSION_PARAMETER_IDS in the synthetic bundle and in the catalogue doc", () => {
    const set = buildSyntheticArtifactSet();
    const policy = set.policyBundle.content as PolicyBundleContent;
    const syntheticParamIds = new Set(policy.numericParameters.map((p) => p.id));

    for (const progId of TRAINING_PROGRESSION_PARAMETER_IDS) {
      expect(syntheticParamIds.has(progId)).toBe(true);
    }

    const cataloguePath = path.resolve(
      process.cwd(),
      "docs/ai-coach/17-Policy-Parameter-Catalogue.md"
    );
    const catalogueContent = fs.readFileSync(cataloguePath, "utf-8");

    for (const progId of TRAINING_PROGRESSION_PARAMETER_IDS) {
      expect(catalogueContent).toContain(`\`${progId}\``);
    }
  });
});
