import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  loadDraftUnsignedPolicyBundle,
  draftPolicyBundleToArtifactDraftInput,
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

describe("T-2034 — DRAFT_UNSIGNED review metadata, draft bundle, and parameter catalogue", () => {
  const FROZEN_UNSIGNED_NOTICE =
    "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.";

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
    // T-2039: evidenceRegistry gained the 6 training/progression rule IDs in its claim,
    // and escalationTemplates gained the two reviewed effort explanation templates.
    expect(artifactContentDigest(set.evidenceRegistry)).toBe(
      "8797be80c8c2cbe21af3d61eb7c54ea711ee96c344ca41124a7dc1b9169e0233"
    );
    expect(artifactContentDigest(set.escalationTemplates)).toBe(
      "fab8e295214943dfaee468a9fd1742e4f05648fe33a24942da112f960959b34b"
    );
  });

  it("isDraftUnsignedReviewMetadata correctly identifies draft vs signed metadata and rejects invalid inputs", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet();

    expect(isDraftUnsignedReviewMetadata(draftFile.reviewMetadata)).toBe(true);
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
      reviewMetadata: draftFile.reviewMetadata,
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
      reviewMetadata: draftFile.reviewMetadata,
      content: draftFile.content,
    };

    const parsed = parseArtifactDraftInput(draftInput);
    expect(parsed.id).toBe("policy-bundle-nutrition:v1");
    expect(isDraftUnsignedReviewMetadata(parsed.reviewMetadata)).toBe(true);
  });

  it("loadDraftUnsignedPolicyBundle returns valid content with exact provenance coverage and unsigned notice", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    expect(draftFile.fileSchemaVersion).toBe(1);

    // Content passes policyBundleContentSchema
    const parsedContent = policyBundleContentSchema.parse(draftFile.content);
    expect(parsedContent.artifactKey).toBe("policy-bundle-nutrition");

    // Exact notice text
    expect(draftFile.reviewMetadata.unsignedNotice).toBe(FROZEN_UNSIGNED_NOTICE);

    // Provenance covers EVERY numeric parameter present in content
    const parameterIdsInContent = draftFile.content.numericParameters.map((p) => p.id);
    const provenanceParameterIds = draftFile.reviewMetadata.proposalProvenance.map(
      (p) => p.parameterId
    );

    // 62 nutrition parameters + 11 proposed training parameters = 73 parameters in draft bundle
    expect(parameterIdsInContent).toHaveLength(73);
    expect(provenanceParameterIds).toHaveLength(73);
    expect([...provenanceParameterIds].sort()).toEqual([...parameterIdsInContent].sort());

    for (const prov of draftFile.reviewMetadata.proposalProvenance) {
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

  it("draft bundle parameters agree with catalogue doc and do not drift (62 proposed / 13 open)", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const floors = buildSyntheticSafetyFloors();
    const resolution = resolvePrescriptionParameters(
      draftFile.content,
      ["Synthetic test explanation"],
      floors
    );

    // Fails closed because 13 parameters are intentionally omitted awaiting RD review
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;

    expect(resolution.reasonCodes).toEqual(["PRESCRIPTION_PARAMETER_MISSING"]);
    expect(resolution.missingParameterIds).toHaveLength(13);

    // Parse the catalogue doc to ensure no drift between doc and code
    const cataloguePath = path.resolve(
      process.cwd(),
      "docs/ai-coach/17-Policy-Parameter-Catalogue.md"
    );
    const catalogueContent = fs.readFileSync(cataloguePath, "utf-8");

    // Extract awaiting review table IDs (Section 3)
    const awaitingReviewSection = catalogueContent
      .split("## 3. Awaiting Qualified Professional Review (13)")[1]
      ?.split("## 4. Training and Progression Parameters (46)")[0];
    expect(awaitingReviewSection).toBeDefined();

    const awaitingIdsFromDoc = [...awaitingReviewSection.matchAll(/\|\s*`([A-Z0-9._:-]+)`\s*\|/g)]
      .map((m) => m[1])
      // Filter out table headers or non-parameter matches
      .filter((id) => PRESCRIPTION_PARAMETER_SPECS.some((spec) => spec.id === id));

    expect(awaitingIdsFromDoc).toHaveLength(13);
    expect([...resolution.missingParameterIds].sort()).toEqual([...awaitingIdsFromDoc].sort());

    // Extract proposed parameters table IDs (Section 2)
    const proposedSection = catalogueContent
      .split("## 2. Source-Backed Proposed Parameters (62)")[1]
      ?.split("## 3. Awaiting Qualified Professional Review (13)")[0];
    expect(proposedSection).toBeDefined();

    const proposedIdsFromDoc = [...proposedSection.matchAll(/\|\s*`([A-Z0-9._:-]+)`\s*\|/g)]
      .map((m) => m[1])
      .filter((id) => PRESCRIPTION_PARAMETER_SPECS.some((spec) => spec.id === id));

    // Unique IDs from proposed section
    const uniqueProposedIdsFromDoc = [...new Set(proposedIdsFromDoc)];
    expect(uniqueProposedIdsFromDoc).toHaveLength(62);

    const draftPrescriptionParameterIds = draftFile.content.numericParameters
      .map((p) => p.id)
      .filter((id) => PRESCRIPTION_PARAMETER_SPECS.some((spec) => spec.id === id));
    expect([...draftPrescriptionParameterIds].sort()).toEqual([...uniqueProposedIdsFromDoc].sort());

    // Total must equal 75
    expect(PRESCRIPTION_PARAMETER_SPECS).toHaveLength(75);
    expect(draftPrescriptionParameterIds.length + resolution.missingParameterIds.length).toBe(75);
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
    expect(safetyPolicy.nutritionLimits.minimumDailyEnergyKcal).toBe(1234);
    expect(safetyPolicy.nutritionLimits.maximumWeeklyLossRatePercent).toBe(9.99);
  });

  it("draftPolicyBundleToArtifactDraftInput produces an ArtifactDraftInput requiring a signed review metadata argument", () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet();

    const converted = draftPolicyBundleToArtifactDraftInput(
      draftFile,
      set.policyBundle.reviewMetadata,
      set.policyBundle.dependencies
    );

    expect(converted.synthetic).toBe(false);
    expect(converted.reviewMetadata.decision).toBe("APPROVED");
    expect(converted.kind).toBe("POLICY_BUNDLE");
    expect(converted.dependencies).toHaveLength(4);
  });
});
