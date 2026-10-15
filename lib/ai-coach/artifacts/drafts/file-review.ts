import type { z } from "zod";
import {
  type ArtifactReviewMetadata,
  type SignedArtifactReviewMetadata,
  artifactReviewMetadataSchema,
  isDraftUnsignedReviewMetadata,
} from "../schema";

/**
 * S-17 — the review metadata a checked-in artifact file may carry.
 *
 * These files used to accept `DRAFT_UNSIGNED` metadata and nothing else, which
 * made "the reviewer has signed this" unrepresentable: the only way to register
 * one was to hand a signed block in from somewhere else, so the file and the
 * signature could disagree. The union lets a file be in exactly one of the two
 * states it can actually be in, and {@link reportReviewStateMismatch} keeps the
 * per-record marks consistent with whichever one it is.
 *
 * The state still has teeth in both directions: a `DRAFT_UNSIGNED` file cannot
 * be published (`ARTIFACT_UNSIGNED_DRAFT`), and the food catalog's ingestion
 * tool keeps emitting `DRAFT_UNSIGNED` output because a fresh run has not been
 * reviewed by anyone.
 */
export const artifactFileReviewMetadataSchema = artifactReviewMetadataSchema;

export type ArtifactFileReviewMetadata = ArtifactReviewMetadata;

/**
 * A signed file's records are all `ACCEPTED`; an unsigned file's are all
 * `PROPOSED`. `STRUCK` records are removed rather than carried, so neither
 * state admits one.
 *
 * Without this, a file could say `APPROVED` at the top and `PROPOSED` on every
 * record underneath it, and nothing would notice which one the reviewer meant.
 */
export function reportReviewStateMismatch(
  reviewMetadata: ArtifactFileReviewMetadata,
  reviewStates: readonly { itemId: string; reviewState: string }[],
  ctx: z.RefinementCtx
) {
  const expected = isDraftUnsignedReviewMetadata(reviewMetadata) ? "PROPOSED" : "ACCEPTED";
  reviewStates.forEach((state, index) => {
    if (state.reviewState !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewStates", index, "reviewState"],
        message: `${reviewMetadata.decision} artifacts carry ${expected} records; ${state.itemId} is ${state.reviewState}.`,
      });
    }
  });
}

/**
 * Narrows a checked-in file's metadata to the signed branch, or refuses.
 *
 * The refusal is what makes registering an unsigned draft unrepresentable from
 * JavaScript as well as from TypeScript. G01–G03 are the human gates this
 * stands in front of.
 */
export function requireSignedReviewMetadata(
  reviewMetadata: ArtifactFileReviewMetadata,
  artifactName: string
): SignedArtifactReviewMetadata {
  if (isDraftUnsignedReviewMetadata(reviewMetadata)) {
    throw new Error(
      `The ${artifactName} can only be registered with signed review metadata from the accountable reviewer.`
    );
  }
  return reviewMetadata;
}
