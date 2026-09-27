import { z } from "zod";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "../schema";
import {
  draftUnsignedReviewMetadataSchema,
  evidenceRegistryContentSchema,
  isDraftUnsignedReviewMetadata,
  signedArtifactReviewMetadataSchema,
} from "../schema";
import rawDraftEvidenceRegistry from "./evidence-registry.draft-unsigned.v1.json";

/**
 * S-V1-artifacts — the DRAFT_UNSIGNED evidence registry.
 *
 * `loadLiveArtifactSetForLaunchValidation` requires a signed, non-synthetic
 * EVIDENCE_REGISTRY. Before this file the only one that existed was the
 * synthetic fixture, which is refused at launch by design, so no v1 launch was
 * representable. This is the draft a qualified professional corrects and signs.
 *
 * What this file does and does not claim:
 *
 * - **It contains no evidence.** Every record is a *pointer* to a source the
 *   draft policy bundle already records in `reviewMetadata.proposalProvenance`,
 *   plus the statement that Steadfast has not verified it. No record states what
 *   a source says, and none carries a number. The reviewer reads the cited
 *   locator and confirms, corrects or strikes each one.
 * - **No claim may name a source the policy bundle does not already cite.** The
 *   `sourceUrl` and rule bindings of every claim are derived from the bundle
 *   (`numericParameters[].evidenceClaimIds` and `applicabilityRuleIds`), and
 *   `tests/unit/ai-coach-evidence-escalation-drafts.test.ts` re-derives both
 *   independently and fails if this file introduces either. That is deliberate:
 *   it makes inventing a citation here structurally impossible rather than a
 *   matter of care (`board/evidence/T-2035.md`).
 * - `reviewer.name` and `reviewer.qualifications` are the fixed sentinels
 *   {@link UNREVIEWED_DRAFT_REVIEWER_NAME} and
 *   {@link UNREVIEWED_DRAFT_QUALIFICATION}. Nobody has reviewed these records,
 *   so no name and no qualification is asserted; a test pins both.
 * - `reviewDate` is the draft *preparation* date on every record, not a review
 *   date. The field name asserts a review the schema cannot express otherwise;
 *   T-2020 already tracks that naming problem across every artifact kind.
 * - `CLAIM.PENDING.NUTRITION_EVIDENCE_RULE` supplies no evidence and says so in
 *   its own text. It exists because `assertEvidenceRulesHaveClaims` throws
 *   inside the gate transaction when a policy evidence rule has no covering
 *   claim, which is a 503 with no decision row for every client rather than a
 *   recorded refusal. See the loader note below.
 *
 * Nothing here may reach a client. It ships `DRAFT_UNSIGNED` with every claim
 * `PROPOSED`, {@link loadDraftUnsignedEvidenceRegistry} refuses to run in
 * production, and T-2034's four refusal points reject the metadata if it were
 * ever registered.
 *
 * **This module is server-side and test-side only.** It statically imports the
 * JSON, so any module that imports it carries the whole draft into its bundle.
 * T-2038 shipped its catalog into a browser chunk exactly this way. Nothing
 * under `app/` or `components/` may import it, and a unit test asserts it.
 */

export const UNREVIEWED_DRAFT_REVIEWER_NAME = "UNREVIEWED_DRAFT_NO_REVIEWER_ASSIGNED";
export const UNREVIEWED_DRAFT_QUALIFICATION = "UNREVIEWED_DRAFT_NOT_A_QUALIFICATION";

/** The prefix a claim id carries when it supplies no evidence at all. */
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
    reviewMetadata: draftUnsignedReviewMetadataSchema,
    reviewStates: z.array(draftEvidenceReviewStateSchema).min(1).max(20_000),
    content: evidenceRegistryContentSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
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
 * Converts a validated draft registry into an `ArtifactDraftInput` ready for
 * registration once signed by a qualified professional reviewer. The required
 * `signed` argument makes registering an unsigned draft unrepresentable at the
 * type level, and the runtime check makes it unrepresentable from JavaScript
 * too. No caller exists yet; that is intentional — G01 has not happened.
 */
export function draftEvidenceRegistryToArtifactDraftInput(
  file: DraftEvidenceRegistryFile,
  signed: SignedArtifactReviewMetadata,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  if (
    isDraftUnsignedReviewMetadata(signed) ||
    !signedArtifactReviewMetadataSchema.safeParse(signed).success
  ) {
    throw new Error(
      "The evidence registry can only be registered with signed review metadata from a qualified professional reviewer."
    );
  }
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
