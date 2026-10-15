import { z } from "zod";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "../schema";
import { evidenceRegistryContentSchema } from "../schema";
import {
  artifactFileReviewMetadataSchema,
  reportReviewStateMismatch,
  requireSignedReviewMetadata,
} from "./file-review";
import rawDraftEvidenceRegistry from "./evidence-registry.draft-unsigned.v1.json";

/**
 * S-V1-artifacts / S-17 — the evidence registry, signed.
 *
 * `loadLiveArtifactSetForLaunchValidation` requires a signed, non-synthetic
 * EVIDENCE_REGISTRY. Before this file the only one that existed was the
 * synthetic fixture, which is refused at launch by design, so no v1 launch was
 * representable.
 *
 * **What each claim asserts, exactly.** Worksheet section 2 records that the
 * accountable owner confirmed each source supports the rule it is bound to,
 * within the general fitness and wellness scope. It does **not** record that
 * anyone read a source's full text and checked it. Every claim therefore says
 * the first and denies the second, in those words, and
 * `tests/unit/ai-coach-evidence-escalation-drafts.test.ts` fails if a claim
 * stops denying it. The distinction is the whole point of the record: a scope
 * attestation by a named accountable owner is a real and useful thing to have,
 * and an independent verification is a different thing that did not happen.
 *
 * What this file does and does not claim:
 *
 * - **It states no finding of its own.** No record says what a source says, and
 *   none carries a number. Each one records the binding and who stood behind it.
 * - **No claim may name a source the policy bundle does not already cite.** The
 *   `sourceUrl` and rule bindings of every claim are derived from the bundle
 *   (`reviewMetadata.proposalProvenance`, `numericParameters[].evidenceClaimIds`
 *   and `applicabilityRuleIds`), and the test re-derives both independently and
 *   fails if this file introduces either. That is deliberate: it makes inventing
 *   a citation here structurally impossible rather than a matter of care
 *   (`board/evidence/T-2035.md`). S-17 kept it working across the signature by
 *   making `proposalProvenance` available on signed metadata too — signing used
 *   to delete the very field the guard reads.
 * - `reviewer.name` is the accountable owner and `reviewer.qualifications` is
 *   the single line worksheet section 0 supplies. **No credential, registration
 *   number, licence or certifying body appears anywhere in this file, because
 *   none is claimed**; a test fails if one does.
 * - One claim's source is not derivable from the bundle:
 *   `CLAIM.AHA.ACC.TOS.OBESITY.NUTRITION_EVIDENCE` backs a rule, not a numeric
 *   parameter, so it has no `proposalProvenance` row to derive from and the test
 *   pins its URL explicitly against the worksheet instead.
 * - Two claim ids changed in S-17 because the sources under them changed:
 *   `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` (no longer a Steadfast proposal)
 *   and `CLAIM.PENDING.NUTRITION_EVIDENCE_RULE` (no longer pending, and
 *   {@link PENDING_EVIDENCE_CLAIM_ID_PREFIX} is a live guard).
 *
 * A signature is not an activation. {@link loadDraftUnsignedEvidenceRegistry}
 * still refuses to run in production, nothing registers this artifact, and no
 * caller exists — activation is Jaden's step and no agent may perform it.
 *
 * **This module is server-side and test-side only.** It statically imports the
 * JSON, so any module that imports it carries the whole draft into its bundle.
 * T-2038 shipped its catalog into a browser chunk exactly this way. Nothing
 * under `app/` or `components/` may import it, and a unit test asserts it.
 */

/**
 * The sentinels an unreviewed draft claim carried before S-17. Kept exported so
 * a test can assert they appear nowhere: a signed registry that still names one
 * is a registry that was signed without being looked at.
 */
export const UNREVIEWED_DRAFT_REVIEWER_NAME = "UNREVIEWED_DRAFT_NO_REVIEWER_ASSIGNED";
export const UNREVIEWED_DRAFT_QUALIFICATION = "UNREVIEWED_DRAFT_NOT_A_QUALIFICATION";

/**
 * The prefix a claim id carries when it supplies no evidence at all. No claim
 * carries it any more — worksheet section 2 supplied the missing source — and a
 * test keeps it that way, so a placeholder cannot reappear inside a signed
 * artifact.
 */
export const PENDING_EVIDENCE_CLAIM_ID_PREFIX = "CLAIM.PENDING.";

/**
 * Per-claim review marks, so the reviewer can strike a claim without deleting
 * it and without reviewer workflow state entering the hashed artifact content.
 * Mirrors `draftExerciseReviewStateSchema` (T-2038), which put the same state in
 * the file envelope rather than in `content` for the same digest reason.
 */
export const draftEvidenceReviewStateSchema = z
  .object({
    itemKind: z.literal("CLAIM"),
    itemId: z.string().min(1).max(160),
    reviewState: z.enum(["PROPOSED", "ACCEPTED", "STRUCK"]),
  })
  .strict();

export type DraftEvidenceReviewState = z.infer<typeof draftEvidenceReviewStateSchema>;

export const draftEvidenceRegistryFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: artifactFileReviewMetadataSchema,
    reviewStates: z.array(draftEvidenceReviewStateSchema).min(1).max(20_000),
    content: evidenceRegistryContentSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    reportReviewStateMismatch(file.reviewMetadata, file.reviewStates, ctx);
    const claimIds = new Set(file.content.claims.map((claim) => claim.id));
    const seen = new Set<string>();
    file.reviewStates.forEach((state, index) => {
      if (seen.has(state.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemId"],
          message: `Duplicate review state for ${state.itemId}`,
        });
      }
      seen.add(state.itemId);
      if (!claimIds.has(state.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemId"],
          message: `Review state references a claim that is not in the registry: ${state.itemId}`,
        });
      }
    });
    for (const claimId of claimIds) {
      if (!seen.has(claimId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates"],
          message: `Every claim needs a review state; missing: ${claimId}`,
        });
      }
    }
  });

export type DraftEvidenceRegistryFile = z.infer<typeof draftEvidenceRegistryFileSchema>;

/**
 * Loads and strictly parses the checked-in DRAFT_UNSIGNED evidence registry.
 * Throws in production environments — draft artifacts must never be loaded in
 * production. Mirrors `loadDraftUnsignedPolicyBundle` /
 * `loadDraftUnsignedExerciseCatalog`.
 */
export function loadDraftUnsignedEvidenceRegistry(): DraftEvidenceRegistryFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  return draftEvidenceRegistryFileSchema.parse(rawDraftEvidenceRegistry);
}

/**
 * Converts the validated file into an `ArtifactDraftInput` ready for
 * registration. The signature is read from the file rather than passed in, so
 * the file and the registered artifact cannot disagree about who signed what,
 * and {@link requireSignedReviewMetadata} refuses an unsigned one from
 * JavaScript as well as from TypeScript.
 *
 * No caller exists, and that is still intentional: registering is activation,
 * and activation is Jaden's step alone.
 */
export function evidenceRegistryToArtifactDraftInput(
  file: DraftEvidenceRegistryFile,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  const signed = requireSignedReviewMetadata(file.reviewMetadata, "evidence registry");
  return {
    id: `${file.content.artifactKey}:v${file.content.version}`,
    artifactKey: file.content.artifactKey,
    version: file.content.version,
    kind: "EVIDENCE_REGISTRY",
    schemaVersion: 1,
    engineVersions: ["ai-coach-artifact-engine-v1"],
    dependencies,
    synthetic: false,
    reviewMetadata: signed,
    content: file.content,
  };
}
