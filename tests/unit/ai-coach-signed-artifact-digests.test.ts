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
    // S-25 — re-signed again after the accountable owner's 13 adopted
    // prescription parameters and the two nutrition safety floors were written
    // in and the two `nutritionLimits` hooks were repointed off their
    // `PENDING_RD_DECISION` placeholders, in one edit. Content moved because
    // the parameters and the hooks are content; review metadata moved because
    // their 15 `proposalProvenance` rows are metadata. Both values were
    // recomputed on 2026-09-29 by running `contentHash` over the loaded files
    // and pasting stdout; neither was copied from a failing assertion.
    content: "70412bfaf4fc50b90a14e2d6075a9015899f9e6a8bcd69426725b4998ec6f2e3",
    reviewMetadata: "d7ece4c3e916d24c148bdbe86509999bf0b73383e048eb90cc71169a82f97da4",
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
    // S-23 — one claim added, CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION.
    // S-25 — that claim's rule set grew to cover the nutrition parameters now
    // bound to it, and it records the owner's second adoption sentence.
    // Content moved; review metadata did not, because nothing about who signed
    // the registry or when changed. Recomputed the same way, on 2026-09-29.
    content: "b3457ca708a5be762405451b2e38e6b63a489ca914c3f17c060a784eb0dc70ab",
    reviewMetadata: "0d5a93185ae7385a5add60cd7cf65d11c9e59b2064363e25d014a8f2d9b47d17",
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
