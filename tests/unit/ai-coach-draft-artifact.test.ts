import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  loadDraftUnsignedPolicyBundle,
  policyBundleToArtifactDraftInput,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import {
  isDraftUnsignedReviewMetadata,
  parseArtifactDraftInput,
  policyBundleContentSchema,
  type PolicyBundleContent,
} from "@/lib/ai-coach/artifacts/schema";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { resolveNutritionSafetyPolicy } from "@/lib/ai-coach/nutrition-safety";
import {
  PRESCRIPTION_PARAMETER_SPECS,
  resolvePrescriptionParameters,
} from "@/lib/ai-coach/prescription/parameters";
import { buildSyntheticSafetyFloors } from "../helpers/ai-prescription-bundle";
import { DRAFT_UNSIGNED_METADATA } from "../helpers/ai-draft-review-metadata";

describe("T-2034 — DRAFT_UNSIGNED review metadata, draft bundle, and parameter catalogue", () => {

  it("preserves exact byte-identical digests for all existing synthetic leaf fixtures", () => {
    const set = buildSyntheticArtifactSet();

    // These digests are captured directly from the fixtures and prove
    // the review-metadata union does not alter a single byte of stored digests.
    expect(artifactContentDigest(set.foodCatalog)).toBe(
      "5c5153170d060f62937fb58eea635e869978f2e5445413709732fd5b577d7a7a"
    );
    expect(artifactContentDigest(set.exerciseCatalog)).toBe(
      "9ec1b46668a9f3334ce310500f88ef4591b1d193033cdaf2cd5c81cbe07cb594"
    );
    // T-2039 added effort templates; S-15 added a distinct nutrition-copy
    // template so those effort strings cannot leak into nutrition assumptions.
    expect(artifactContentDigest(set.evidenceRegistry)).toBe(
      "24eba06c36b95985b2b17401daef78d7b06edcf428d0fc4b8f4da39adefb2c37"
    );
    expect(artifactContentDigest(set.escalationTemplates)).toBe(
      "a39e7c45cdbc04ff6a74826320bde13fc3c13fd7fca26ef7c6a526631170ce14"
    );
  });

  it("isDraftUnsignedReviewMetadata correctly identifies draft vs signed metadata and rejects invalid inputs", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet();

    // S-17: the checked-in bundle is signed, so it is the *negative* case now.
    expect(isDraftUnsignedReviewMetadata(draftFile.reviewMetadata)).toBe(false);
    expect(isDraftUnsignedReviewMetadata(DRAFT_UNSIGNED_METADATA)).toBe(true);
    expect(isDraftUnsignedReviewMetadata(set.policyBundle.reviewMetadata)).toBe(false);
    expect(isDraftUnsignedReviewMetadata(null)).toBe(false);
    expect(isDraftUnsignedReviewMetadata(undefined)).toBe(false);
    expect(isDraftUnsignedReviewMetadata("DRAFT_UNSIGNED")).toBe(false);
    expect(isDraftUnsignedReviewMetadata({})).toBe(false);
    expect(isDraftUnsignedReviewMetadata({ decision: "APPROVED" })).toBe(false);
    expect(isDraftUnsignedReviewMetadata({ decision: "DRAFT_UNSIGNED" })).toBe(false);
  });

  it("rejects a DRAFT_UNSIGNED artifact if synthetic is true", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet();
    const draftInput = {
      id: "policy-bundle-nutrition:v1",
      artifactKey: "policy-bundle-nutrition",
      version: 1,
      kind: "POLICY_BUNDLE" as const,
      schemaVersion: 1 as const,
      engineVersions: ["ai-coach-artifact-engine-v1"],
      dependencies: set.policyBundle.dependencies,
      synthetic: true, // Forbidden for DRAFT_UNSIGNED
      reviewMetadata: DRAFT_UNSIGNED_METADATA,
      content: draftFile.content,
    };

    expect(() => parseArtifactDraftInput(draftInput)).toThrow(
      "Draft unsigned artifacts cannot be synthetic"
    );
  });

  it("allows a non-synthetic DRAFT_UNSIGNED artifact without jurisdiction review", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet();
    const draftInput = {
      id: "policy-bundle-nutrition:v1",
      artifactKey: "policy-bundle-nutrition",
      version: 1,
      kind: "POLICY_BUNDLE" as const,
      schemaVersion: 1 as const,
      engineVersions: ["ai-coach-artifact-engine-v1"],
      dependencies: set.policyBundle.dependencies,
      synthetic: false,
      reviewMetadata: DRAFT_UNSIGNED_METADATA,
      content: draftFile.content,
    };

    const parsed = parseArtifactDraftInput(draftInput);
    expect(parsed.id).toBe("policy-bundle-nutrition:v1");
    expect(isDraftUnsignedReviewMetadata(parsed.reviewMetadata)).toBe(true);
  });

  it("loadDraftUnsignedPolicyBundle returns valid content with exact provenance coverage, signed", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    expect(draftFile.fileSchemaVersion).toBe(1);

    // Content passes policyBundleContentSchema
    const parsedContent = policyBundleContentSchema.parse(draftFile.content);
    expect(parsedContent.artifactKey).toBe("policy-bundle-nutrition");

    // S-17: the bundle is signed, and `proposalProvenance` survived the signature.
    expect(draftFile.reviewMetadata.decision).toBe("APPROVED");
    if (draftFile.reviewMetadata.decision !== "APPROVED") return;
    const provenance = draftFile.reviewMetadata.proposalProvenance ?? [];

    // Provenance covers EVERY numeric parameter present in content
    const parameterIdsInContent = draftFile.content.numericParameters.map((p) => p.id);
    const provenanceParameterIds = provenance.map((p) => p.parameterId);

    // 62 nutrition + 11 training session-structure parameters = 73, plus the
    // 35 training, workload and progression values the accountable owner
    // adopted on 2026-09-29 and S-23 wrote in = 108, plus the 13 prescription
    // values and the 2 nutrition safety floors he adopted the same day and
    // S-25 wrote in = 123.
    expect(parameterIdsInContent).toHaveLength(123);
    expect(provenanceParameterIds).toHaveLength(123);
    expect([...provenanceParameterIds].sort()).toEqual([...parameterIdsInContent].sort());

    for (const prov of provenance) {
      expect(prov.sourceClaimId).toBeTruthy();
      expect(prov.sourceId).toBeTruthy();
      expect(prov.sourceUrl.startsWith("https://")).toBe(true);
      expect(prov.sourceLocator).toBeTruthy();
    }
  });

  it("throws when loadDraftUnsignedPolicyBundle is called in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => loadDraftUnsignedPolicyBundle()).toThrow(
        "Draft unsigned artifacts cannot be loaded in production environments."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("draft bundle parameters agree with catalogue doc and do not drift (62 sourced / 13 adopted)", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const floors = buildSyntheticSafetyFloors();
    const resolution = resolvePrescriptionParameters(
      draftFile.content,
      ["Synthetic test explanation"],
      floors
    );

    // S-25 — the 13 were the whole of what this refused on. The accountable
    // owner adopted them on 2026-09-29 (`steadfast-hq/board/DOSE-WORKSHEET-3.md`),
    // so the bundle now carries all 75 and the resolver resolves. The
    // fail-closed behaviour itself is not weakened: the per-id removal proof
    // below still fails the resolver on each one individually.
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    // Parse the catalogue doc to ensure no drift between doc and code
    const cataloguePath = path.resolve(
      process.cwd(),
      "docs/ai-coach/17-Policy-Parameter-Catalogue.md"
    );
    const catalogueContent = fs.readFileSync(cataloguePath, "utf-8");

    // Extract proposed parameters table IDs (Section 2)
    const proposedSection = catalogueContent
      .split("## 2. Source-Backed Proposed Parameters (62)")[1]
      ?.split("## 3. Owner-Adopted Prescription Parameters (13)")[0];
    expect(proposedSection).toBeDefined();

    const proposedIdsFromDoc = [...proposedSection.matchAll(/\|\s*`([A-Z0-9._:-]+)`\s*\|/g)]
      .map((m) => m[1])
      .filter((id) => PRESCRIPTION_PARAMETER_SPECS.some((spec) => spec.id === id));

    // Unique IDs from proposed section
    const uniqueProposedIdsFromDoc = [...new Set(proposedIdsFromDoc)];
    expect(uniqueProposedIdsFromDoc).toHaveLength(62);

    // Extract the owner-adopted table IDs (Section 3)
    const adoptedSection = catalogueContent
      .split("## 3. Owner-Adopted Prescription Parameters (13)")[1]
      ?.split("## 4. Training and Progression Parameters (46)")[0];
    expect(adoptedSection).toBeDefined();

    const adoptedIdsFromDoc = [...adoptedSection.matchAll(/\|\s*`([A-Z0-9._:-]+)`\s*\|/g)]
      .map((m) => m[1])
      // Filter out table headers, rule IDs and the two safety floors, which are
      // not members of PRESCRIPTION_PARAMETER_SPECS.
      .filter((id) => PRESCRIPTION_PARAMETER_SPECS.some((spec) => spec.id === id));

    expect(adoptedIdsFromDoc).toHaveLength(13);
    // The two sections partition the resolver's catalogue exactly: nothing is
    // in both, nothing is in neither.
    expect([...uniqueProposedIdsFromDoc, ...adoptedIdsFromDoc].sort()).toEqual(
      PRESCRIPTION_PARAMETER_SPECS.map((spec) => spec.id).sort()
    );

    const draftPrescriptionParameterIds = draftFile.content.numericParameters
      .map((p) => p.id)
      .filter((id) => PRESCRIPTION_PARAMETER_SPECS.some((spec) => spec.id === id));
    expect([...draftPrescriptionParameterIds].sort()).toEqual(
      PRESCRIPTION_PARAMETER_SPECS.map((spec) => spec.id).sort()
    );

    // Total must equal 75
    expect(PRESCRIPTION_PARAMETER_SPECS).toHaveLength(75);
    expect(draftPrescriptionParameterIds).toHaveLength(75);
  });

  it("resolves the accountable owner's thirteen adopted values, exactly as he wrote them", () => {
    // S-25 — the values, not the count. `DOSE-WORKSHEET-3.md`'s ADOPTED
    // section is the record; this is the assertion that moving any one of
    // them is a test change rather than a quiet edit to a signed artifact.
    const draftFile = loadDraftUnsignedPolicyBundle();
    const byId = new Map(draftFile.content.numericParameters.map((p) => [p.id, p]));
    const adopted: Record<string, { value: number; unit: string }> = {
      "GOAL.ADJUSTMENT.LOSE.GRADUAL.ENERGY_DELTA_FRACTION": {
        value: -0.1,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "GOAL.ADJUSTMENT.LOSE.MODERATE.ENERGY_DELTA_FRACTION": {
        value: -0.2,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "GOAL.ADJUSTMENT.GAIN.GRADUAL.ENERGY_DELTA_FRACTION": {
        value: 0.05,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "GOAL.ADJUSTMENT.GAIN.MODERATE.ENERGY_DELTA_FRACTION": {
        value: 0.1,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "GOAL.ADJUSTMENT.MAINTAIN.ANY.ENERGY_DELTA_FRACTION": {
        value: 0,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION": {
        value: 0.25,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION": {
        value: 0.25,
        unit: "FRACTION_OF_MAINTENANCE_ENERGY",
      },
      "ENERGY.BODY_MASS.ENERGY_PER_KG": { value: 7700, unit: "KCAL_PER_KG_BODY_MASS" },
      "ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS": { value: 14, unit: "DAYS" },
      "ROUNDING.ENERGY_KCAL.STEP": { value: 10, unit: "KCAL_PER_DAY" },
      "ROUNDING.MACRO_GRAMS.DECIMALS": { value: 0, unit: "DECIMAL_PLACES" },
      "ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS": { value: 2, unit: "DECIMAL_PLACES" },
      "COMPOSITION.TOLERANCE_PERCENT": { value: 5, unit: "PERCENT" },
    };
    expect(Object.keys(adopted)).toHaveLength(13);
    for (const [id, expected] of Object.entries(adopted)) {
      expect({ id, value: byId.get(id)?.value, unit: byId.get(id)?.unit }).toEqual({
        id,
        ...expected,
      });
    }

    // And every one of them names the owner-adoption claim rather than a citation.
    if (draftFile.reviewMetadata.decision !== "APPROVED") throw new Error("bundle is not signed");
    const provenance = new Map(
      (draftFile.reviewMetadata.proposalProvenance ?? []).map((row) => [row.parameterId, row])
    );
    for (const id of Object.keys(adopted)) {
      expect({ id, claim: provenance.get(id)?.sourceClaimId }).toEqual({
        id,
        claim: "CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION",
      });
    }
  });

  it("still fails closed on each of the thirteen individually, one id at a time", () => {
    // Resolving is not the same as no longer being able to refuse. Removing
    // any one of the adopted values must still refuse by id, which is the
    // property that protected clients before they existed.
    const draftFile = loadDraftUnsignedPolicyBundle();
    const floors = buildSyntheticSafetyFloors();
    const adoptedIds = [
      "GOAL.ADJUSTMENT.LOSE.GRADUAL.ENERGY_DELTA_FRACTION",
      "GOAL.ADJUSTMENT.LOSE.MODERATE.ENERGY_DELTA_FRACTION",
      "GOAL.ADJUSTMENT.GAIN.GRADUAL.ENERGY_DELTA_FRACTION",
      "GOAL.ADJUSTMENT.GAIN.MODERATE.ENERGY_DELTA_FRACTION",
      "GOAL.ADJUSTMENT.MAINTAIN.ANY.ENERGY_DELTA_FRACTION",
      "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION",
      "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION",
      "ENERGY.BODY_MASS.ENERGY_PER_KG",
      "ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS",
      "ROUNDING.ENERGY_KCAL.STEP",
      "ROUNDING.MACRO_GRAMS.DECIMALS",
      "ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS",
      "COMPOSITION.TOLERANCE_PERCENT",
    ];
    for (const id of adoptedIds) {
      const content = {
        ...draftFile.content,
        numericParameters: draftFile.content.numericParameters.filter((p) => p.id !== id),
      };
      const resolution = resolvePrescriptionParameters(content, ["text"], floors);
      expect({ id, ok: resolution.ok }).toEqual({ id, ok: false });
      if (resolution.ok) continue;
      expect({ id, missing: resolution.missingParameterIds }).toEqual({ id, missing: [id] });
    }
  });

  it("synthetic policy bundle resolves to ok:true with all 75 parameters and nutrition-safety passes", () => {
    const set = buildSyntheticArtifactSet();
    const floors = buildSyntheticSafetyFloors();

    // resolvePrescriptionParameters succeeds with all 75 parameters
    const resolution = resolvePrescriptionParameters(
      set.policyBundle.content as PolicyBundleContent,
      ["Synthetic test next step."],
      floors
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    expect(resolution.parameters.energyCoefficients.MALE_ADULT.INACTIVE.intercept).toBe(700);
    expect(resolution.parameters.protein.REGULAR.target).toBe(2.5);

    // resolveNutritionSafetyPolicy still succeeds unchanged on synthetic policy
    const safetyPolicy = resolveNutritionSafetyPolicy(
      set.policyBundle.content as PolicyBundleContent
    );
    if (safetyPolicy.resolutionStatus !== "RESOLVED") {
      throw new Error("fixture safety policy changed");
    }
    expect(safetyPolicy.nutritionLimits.minimumDailyEnergyKcal).toBe(1234);
    expect(safetyPolicy.nutritionLimits.maximumWeeklyLossRatePercent).toBe(9.99);
  });

  it("resolves the two nutrition safety floors the accountable owner adopted", () => {
    // S-25 — this asserted a renderable HOLD while both hooks were still
    // `PENDING_RD_DECISION` placeholders. They are not: the owner adopted
    // 1200 kcal/day and 1.0 %BW/week on 2026-09-29 and the hooks were
    // repointed in the same edit that added the parameters. The PENDING branch
    // itself is still exercised, on a mutated copy, in
    // `ai-coach-nutrition-safety-floors.test.ts`.
    const resolution = resolveNutritionSafetyPolicy(loadDraftUnsignedPolicyBundle().content);
    expect(resolution.resolutionStatus).toBe("RESOLVED");
    if (resolution.resolutionStatus !== "RESOLVED") return;
    expect(resolution.pendingParameterIds).toEqual([]);
    expect(resolution.pendingDecision).toBeNull();
    expect({
      minimumDailyEnergyParameterId: resolution.nutritionLimits.minimumDailyEnergyParameterId,
      minimumDailyEnergyKcal: resolution.nutritionLimits.minimumDailyEnergyKcal,
      maximumWeeklyLossRateParameterId:
        resolution.nutritionLimits.maximumWeeklyLossRateParameterId,
      maximumWeeklyLossRatePercent: resolution.nutritionLimits.maximumWeeklyLossRatePercent,
    }).toEqual({
      minimumDailyEnergyParameterId: "SAFETY.NUTRITION.MIN_DAILY_ENERGY.FLOOR.V1",
      minimumDailyEnergyKcal: 1200,
      maximumWeeklyLossRateParameterId: "SAFETY.NUTRITION.MAX_WEEKLY_LOSS_RATE.CEILING.V1",
      maximumWeeklyLossRatePercent: 1,
    });
  });

  it("policyBundleToArtifactDraftInput carries the file's own signature, and refuses an unsigned file", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet();

    const converted = policyBundleToArtifactDraftInput(draftFile, set.policyBundle.dependencies);

    expect(converted.synthetic).toBe(false);
    expect(converted.reviewMetadata.decision).toBe("APPROVED");
    // S-17: the signature is read from the file, so the registered artifact and
    // the file cannot disagree about who signed what.
    expect(converted.reviewMetadata).toEqual(draftFile.reviewMetadata);
    expect(converted.kind).toBe("POLICY_BUNDLE");
    expect(converted.dependencies).toHaveLength(4);

    expect(() =>
      policyBundleToArtifactDraftInput(
        { ...draftFile, reviewMetadata: DRAFT_UNSIGNED_METADATA },
        set.policyBundle.dependencies
      )
    ).toThrow(/signed review metadata/i);
  });
});
