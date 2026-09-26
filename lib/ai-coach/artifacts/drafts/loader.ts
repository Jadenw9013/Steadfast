import { z } from "zod";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "../schema";
import {
  draftUnsignedReviewMetadataSchema,
  foodCatalogContentSchema,
  policyBundleContentSchema,
} from "../schema";
import rawDraftBundle from "./policy-bundle-nutrition.draft-unsigned.v1.json";
import rawDraftFoodCatalog from "./food-catalog-fdc.draft-unsigned.v1.json";

export const draftPolicyBundleFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: draftUnsignedReviewMetadataSchema,
    content: policyBundleContentSchema,
  })
  .strict();

export type DraftPolicyBundleFile = z.infer<typeof draftPolicyBundleFileSchema>;

/**
 * Loads and strictly parses the checked-in DRAFT_UNSIGNED policy bundle file.
 * Throws in production environments — draft artifacts must never be loaded in production.
 */
export function loadDraftUnsignedPolicyBundle(): DraftPolicyBundleFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  return draftPolicyBundleFileSchema.parse(rawDraftBundle);
}

/**
 * Converts a validated draft bundle file into an ArtifactDraftInput ready for
 * registration once signed by a qualified professional reviewer.
 * The required `signed` argument makes registering an unsigned draft unrepresentable.
 */
export function draftPolicyBundleToArtifactDraftInput(
  file: DraftPolicyBundleFile,
  signed: SignedArtifactReviewMetadata,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  return {
    id: `${file.content.artifactKey}:v${file.content.version}`,
    artifactKey: file.content.artifactKey,
    version: file.content.version,
    kind: "POLICY_BUNDLE",
    schemaVersion: 1,
    engineVersions: ["ai-coach-artifact-engine-v1"],
    dependencies,
    synthetic: false,
    reviewMetadata: signed,
    content: file.content,
  };
}

export const draftFoodCatalogFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: draftUnsignedReviewMetadataSchema,
    content: foodCatalogContentSchema,
  })
  .strict();

export type DraftFoodCatalogFile = z.infer<typeof draftFoodCatalogFileSchema>;

/**
 * Loads and strictly parses the checked-in DRAFT_UNSIGNED food catalog file.
 * Throws in production environments — draft artifacts must never be loaded in production.
 */
export function loadDraftUnsignedFoodCatalog(): DraftFoodCatalogFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  return draftFoodCatalogFileSchema.parse(rawDraftFoodCatalog);
}
