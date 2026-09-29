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
import {
  NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE,
  resolveNutritionSafetyPolicy,
} from "@/lib/ai-coach/nutrition-safety";
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
    // adopted on 2026-09-29 and S-23 wrote in = 108.
    expect(parameterIdsInContent).toHaveLength(108);
    expect(provenanceParameterIds).toHaveLength(108);
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
    if (safetyPolicy.resolutionStatus !== "RESOLVED") {
      throw new Error("fixture safety policy changed");
    }
    expect(safetyPolicy.nutritionLimits.minimumDailyEnergyKcal).toBe(1234);
    expect(safetyPolicy.nutritionLimits.maximumWeeklyLossRatePercent).toBe(9.99);
  });

  it("returns a renderable HOLD when the draft safety floors await RD review", () => {
    const resolution = resolveNutritionSafetyPolicy(loadDraftUnsignedPolicyBundle().content);
    expect(resolution.resolutionStatus).toBe("PENDING");
    expect(resolution.pendingParameterIds).toEqual([
      "PENDING_RD_DECISION_MIN_DAILY_ENERGY",
      "PENDING_RD_DECISION_MAX_WEEKLY_LOSS_RATE",
    ]);
    expect(resolution.pendingDecision).toMatchObject({
      outcome: "HOLD",
      reasonCodes: [NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE],
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
