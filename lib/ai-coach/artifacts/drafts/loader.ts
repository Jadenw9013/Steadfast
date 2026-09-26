import fs from "node:fs";
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

export const DRAFT_FOOD_CATALOG_FILENAME = "food-catalog-fdc.draft-unsigned.v1.json";

export const FOOD_CATALOG_DRAFT_NOT_GENERATED =
  "The DRAFT_UNSIGNED food catalog has not been generated. It is the output of a real USDA " +
  "FoodData Central run (pnpm ai-coach:fdc:ingest) and is never hand-written; see " +
  "docs/ai-coach/catalog/README.md.";

/**
 * Loads and strictly parses the DRAFT_UNSIGNED food catalog file that a real
 * `--ingest` run writes next to this module.
 *
 * Read at call time rather than statically imported, because the file is absent
 * until an operator has run the tool against the live API. The first version of
 * this ticket shipped a hand-written 260-item catalog in its place; that data
 * was deleted (`board/evidence/T-2035.md`) and nothing stands in for it. When
 * the real run commits the artifact this function starts returning it with no
 * code change; until then it throws {@link FOOD_CATALOG_DRAFT_NOT_GENERATED}.
 *
 * Throws in production environments — draft artifacts must never be loaded in
 * production. This module is imported only by `scripts/` and `tests/`; no
 * `app/` or `lib/` runtime path reaches it, so the `node:fs` read is never
 * bundled.
 */
export function loadDraftUnsignedFoodCatalog(): DraftFoodCatalogFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  const fileUrl = new URL(`./${DRAFT_FOOD_CATALOG_FILENAME}`, import.meta.url);
  if (!fs.existsSync(fileUrl)) {
    throw new Error(FOOD_CATALOG_DRAFT_NOT_GENERATED);
  }
  return draftFoodCatalogFileSchema.parse(JSON.parse(fs.readFileSync(fileUrl, "utf8")));
}
