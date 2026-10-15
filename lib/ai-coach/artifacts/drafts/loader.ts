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
import { artifactFileReviewMetadataSchema, requireSignedReviewMetadata } from "./file-review";
import { mealTemplateSetSchema } from "../../catalog/meal-template-schema";
import rawDraftBundle from "./policy-bundle-nutrition.draft-unsigned.v1.json";

export const draftPolicyBundleFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: artifactFileReviewMetadataSchema,
    content: policyBundleContentSchema,
  })
  .strict();

export type DraftPolicyBundleFile = z.infer<typeof draftPolicyBundleFileSchema>;

/**
 * Loads and strictly parses the checked-in policy bundle file.
 *
 * S-17 — this file is now signed (`decision: "APPROVED"`); the function name and
 * the `draft-unsigned` filename are kept only so the rename does not bury the
 * signing diff, and both are stale. Follow-up: rename both.
 *
 * Throws in production environments. That refusal is unchanged and deliberate:
 * a signature is not an activation, and activation is Jaden's step alone.
 */
export function loadDraftUnsignedPolicyBundle(): DraftPolicyBundleFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  return draftPolicyBundleFileSchema.parse(rawDraftBundle);
}

/**
 * Converts a validated bundle file into an `ArtifactDraftInput` ready for
 * registration. The signature comes from the file itself, so the file and the
 * registered artifact cannot disagree about who signed what;
 * {@link requireSignedReviewMetadata} refuses an unsigned one.
 */
export function policyBundleToArtifactDraftInput(
  file: DraftPolicyBundleFile,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  const signed = requireSignedReviewMetadata(file.reviewMetadata, "policy bundle");
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
    reviewMetadata: artifactFileReviewMetadataSchema,
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

export const DRAFT_FOOD_CATALOG_V2_FILENAME = "food-catalog-fdc.v2.draft-unsigned.v1.json";

export const FOOD_CATALOG_V2_DRAFT_NOT_GENERATED =
  "The DRAFT_UNSIGNED food catalog v2 has not been generated. It is content.version 2 of the " +
  "reviewed USDA FoodData Central catalog (S-31): the signed v1's 232 items carried over " +
  "byte-identical plus 24 additional COOKED items adopted from the recorded 2026-09-27 ingest " +
  "run preserved at commit aff0f71 on team/T-2042-cooked-foods, built by a script and never " +
  "hand-written; see board/CATALOG-WORKSHEET-v2.md.";

/**
 * Loads and strictly parses the DRAFT_UNSIGNED food catalog **v2** file (S-31).
 *
 * This is a second, additive version of the `food-catalog` artifact key,
 * sitting next to {@link loadDraftUnsignedFoodCatalog} (v1, signed) without
 * touching it — v1's bytes are never read or modified by this function. The
 * artifact model is already versioned per key (`AiCoachArtifactVersion` is
 * keyed by `(artifactKey, version)`, selecting the latest `PUBLISHED` row by
 * `version desc`); this is the file-based mirror of that for the not-yet-signed
 * v2 content, the same way {@link loadDraftUnsignedFoodCatalog} is the mirror
 * for v1 before S-17 signed it.
 *
 * Throws in production environments — draft artifacts must never be loaded in
 * production. Reached only by `scripts/` and `tests/`, never by `app/` or
 * runtime `lib/` code, same as {@link loadDraftUnsignedFoodCatalog}.
 */
export function loadDraftUnsignedFoodCatalogV2(): DraftFoodCatalogFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  const fileUrl = new URL(`./${DRAFT_FOOD_CATALOG_V2_FILENAME}`, import.meta.url);
  if (!fs.existsSync(fileUrl)) {
    throw new Error(FOOD_CATALOG_V2_DRAFT_NOT_GENERATED);
  }
  return draftFoodCatalogFileSchema.parse(JSON.parse(fs.readFileSync(fileUrl, "utf8")));
}

export const draftMealTemplateFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: draftUnsignedReviewMetadataSchema,
    content: mealTemplateSetSchema,
  })
  .strict();

export type DraftMealTemplateFile = z.infer<typeof draftMealTemplateFileSchema>;

export const DRAFT_MEAL_TEMPLATES_FILENAME = "meal-templates.draft-unsigned.v1.json";

/**
 * Loads and strictly parses the DRAFT_UNSIGNED meal templates file.
 * Throws in production environments — draft artifacts must never be loaded in production.
 */
export function loadDraftUnsignedMealTemplates(): DraftMealTemplateFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  const fileUrl = new URL(`./${DRAFT_MEAL_TEMPLATES_FILENAME}`, import.meta.url);
  if (!fs.existsSync(fileUrl)) {
    throw new Error(`The DRAFT_UNSIGNED meal templates file was not found at ${fileUrl}`);
  }
  return draftMealTemplateFileSchema.parse(JSON.parse(fs.readFileSync(fileUrl, "utf8")));
}
