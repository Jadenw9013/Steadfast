import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  loadDraftUnsignedFoodCatalog,
  loadDraftUnsignedPolicyBundle,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import { loadDraftUnsignedExerciseCatalog } from "@/lib/ai-coach/artifacts/drafts/exercise-catalog";
import { loadDraftUnsignedEvidenceRegistry } from "@/lib/ai-coach/artifacts/drafts/evidence-registry";
import { loadDraftUnsignedEscalationTemplates } from "@/lib/ai-coach/artifacts/drafts/escalation-templates";
import { signedArtifactReviewMetadataSchema } from "@/lib/ai-coach/artifacts/schema";

/**
 * S-17 — the digests of the five signed artifacts.
 *
 * These exist so that signed content cannot move without somebody deciding it
 * should. Every string in these files was written or confirmed by a named human
 * in `steadfast-hq/board/REVIEW-WORKSHEET.md`; an edit that changes one is
 * content nobody reviewed carrying a signature that says someone did, and the
 * only cheap way to catch it is to hash what was signed.
 *
 * **If one of these fails, do not update the expected value to make it pass.**
 * That is the move that silently disables the guard. Find the diff, and either
 * revert it or get a new signed worksheet entry for it.
 *
 * Content and review metadata are hashed separately and deliberately:
 * a re-signature (new reviewer, new date) should not look identical to a change
 * in what a client reads, and a content edit should not be maskable by a
 * metadata change.
 *
 * Derived by computing `contentHash` over the loaded files on 2026-09-28 and
 * pasting the output — not by hand, and not by copying a value from a failing
 * assertion.
 */
const EXPECTED = {
  policyBundle: {
    content: "c4ea70df84d1e890b6d4db7bf247eb8919f4d0aa641d0f24fcfc4ee512e7e7d6",
    reviewMetadata: "a464ef35897f0217c882c397522aed64c7ecf5f14fa29cd07081be200f7b27f7",
  },
  foodCatalog: {
    content: "ade4d55bd56221cffa959e5b23c74646ec3cb69911b00cc7889db06a6e66b5bd",
    reviewMetadata: "514bc4422212aab7482a0757e9c6211af692b59e224325f3f74063385e76c6cb",
  },
  exerciseCatalog: {
    content: "7b7f0bbd0eb94cbcfa2adfd7f5e880d7a797afabf153190ff1cb52abd00c92f0",
    reviewMetadata: "f9052e1ae5d585c0b65bea061b87593fe7f753e8dd9c28b0ba2e43284df6f139",
  },
  evidenceRegistry: {
    content: "72dd7a8c05f6dec1d442d42598fc1d125423bc676d757213d3adbe323466d35b",
    reviewMetadata: "3177919c227db5d603e8b24631baeb9cfd599dbe419591b3515a19b84fcd2140",
  },
  escalationTemplates: {
    content: "69c9610d2cb0cf8f85e3900939c287f0a36d041259459824cca670d57e111174",
    reviewMetadata: "9a41fe88156dd0258ca4374318a6146670ff19292a9c517153f16880b84a0435",
  },
} as const;

const files = () => ({
  policyBundle: loadDraftUnsignedPolicyBundle(),
  foodCatalog: loadDraftUnsignedFoodCatalog(),
  exerciseCatalog: loadDraftUnsignedExerciseCatalog(),
  evidenceRegistry: loadDraftUnsignedEvidenceRegistry(),
  escalationTemplates: loadDraftUnsignedEscalationTemplates(),
});

describe("S-17 — signed artifact digests", () => {
  it("pins the content and review-metadata digest of all five signed artifacts", () => {
    for (const [key, file] of Object.entries(files())) {
      const expected = EXPECTED[key as keyof typeof EXPECTED];
      expect({
        key,
        content: contentHash(file.content),
        reviewMetadata: contentHash(file.reviewMetadata),
      }).toEqual({ key, content: expected.content, reviewMetadata: expected.reviewMetadata });
    }
  });

  it("signs all five under one reviewer, one review record and one review date", () => {
    // Five artifacts signed on different days, or by different people, is a
    // different governance claim from one signing event. The packet asserts the
    // latter, so the artifacts have to agree with it.
    const metadata = Object.entries(files()).map(([key, file]) => {
      if (file.reviewMetadata.decision !== "APPROVED")
        throw new Error(`${key} is not signed`);
      return { key, ...file.reviewMetadata };
    });
    expect(metadata).toHaveLength(5);
    for (const entry of metadata) {
      expect({ key: entry.key, reviewer: entry.reviewer.name }).toEqual({
        key: entry.key,
        reviewer: "Jaden Wong",
      });
      expect({ key: entry.key, type: entry.reviewer.reviewerType }).toEqual({
        key: entry.key,
        type: "QUALIFIED_CONTENT_REVIEWER",
      });
      expect({ key: entry.key, at: entry.reviewedAt }).toEqual({
        key: entry.key,
        at: "2026-09-27T00:00:00.000Z",
      });
      expect({ key: entry.key, record: entry.reviewRecordId }).toEqual({
        key: entry.key,
        record: "steadfast-hq.board.REVIEW-WORKSHEET.2026-09-27",
      });
      expect({ key: entry.key, basis: entry.jurisdictionReview.legalReviewBasis }).toEqual({
        key: entry.key,
        basis: "ACCOUNTABLE_OWNER_SCOPE_ATTESTATION",
      });
      expect({ key: entry.key, note: entry.jurisdictionReview.scopeNote }).toEqual({
        key: entry.key,
        note: "Reviewed within general fitness and wellness scope; medical advice disclaimed.",
      });
      expect({ key: entry.key, jurisdictions: entry.jurisdictionReview.jurisdictions }).toEqual({
        key: entry.key,
        jurisdictions: ["US"],
      });
      expect({ key: entry.key, scope: [...entry.allowedScope].sort() }).toEqual({
        key: entry.key,
        scope: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION", "GENERAL_FITNESS_PROGRAMMING"],
      });
      expect({ key: entry.key, exclusions: [...entry.explicitExclusions].sort() }).toEqual({
        key: entry.key,
        exclusions: [
          "CLINICAL_NUTRITION_OR_MEDICAL_NUTRITION_THERAPY",
          "CLINICIAN_INSTRUCTION_OVERRIDE",
          "DIAGNOSIS",
          "MEDICATION_OR_SUPPLEMENT_PRESCRIBING",
          "TREATMENT_OR_REHABILITATION",
        ],
      });
    }
  });

  it("rejects an accountable-owner attestation that does not state its scope", () => {
    // `legalReviewStatus: "APPROVED"` on its own reads as external counsel.
    // The schema refuses to let it stand alone once the basis says otherwise.
    const file = loadDraftUnsignedEscalationTemplates();
    if (file.reviewMetadata.decision !== "APPROVED") throw new Error("not signed");
    const stripped = structuredClone(file.reviewMetadata);
    delete (stripped.jurisdictionReview as { scopeNote?: string }).scopeNote;
    expect(signedArtifactReviewMetadataSchema.safeParse(stripped).success).toBe(false);
    expect(signedArtifactReviewMetadataSchema.safeParse(file.reviewMetadata).success).toBe(true);
  });
});
