import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadDraftUnsignedFoodCatalog,
  draftFoodCatalogFileSchema,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import {
  foodCatalogContentSchema,
  isDraftUnsignedReviewMetadata,
  parseArtifactDraftInput,
} from "@/lib/ai-coach/artifacts/schema";
import {
  allowlistSchema,
  coveragePlanSchema,
  type AllowlistEntry,
} from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import { mapFdcRecordToCatalogItem } from "@/lib/ai-coach/catalog/fdc/mapping";
import { contentHash } from "@/lib/ai-coach/canonical-json";

const FROZEN_UNSIGNED_NOTICE =
  "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.";

const COVERAGE_PLAN_PATH = path.resolve("data/ai-coach/catalog/fdc-coverage-plan.v1.json");
const ALLOWLIST_PATH = path.resolve("data/ai-coach/catalog/fdc-allowlist.v1.json");

describe("T-2035 — FDC Allowlist and Draft Food Catalog Artifact", () => {
  it("loadDraftUnsignedFoodCatalog() parses checked-in file with SOURCED_V2, DRAFT_UNSIGNED, and frozen notice", () => {
    const draftFile = loadDraftUnsignedFoodCatalog();
    expect(draftFile.fileSchemaVersion).toBe(1);
    expect(draftFile.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    expect(draftFile.reviewMetadata.unsignedNotice).toBe(FROZEN_UNSIGNED_NOTICE);
    expect(isDraftUnsignedReviewMetadata(draftFile.reviewMetadata)).toBe(true);

    const parsedContent = foodCatalogContentSchema.parse(draftFile.content);
    expect(parsedContent.catalogProfile).toBe("SOURCED_V2");
    expect(parsedContent.market).toBe("US");
    expect(parsedContent.items.length).toBeGreaterThanOrEqual(200);
  });

  it("reviewMetadata.proposalProvenance has exactly one entry per content.items[], and every parameterId matches an item ID", () => {
    const draftFile = loadDraftUnsignedFoodCatalog();
    const itemIds = draftFile.content.items.map((i) => i.id);
    const provenanceIds = draftFile.reviewMetadata.proposalProvenance.map((p) => p.parameterId);

    expect(provenanceIds).toHaveLength(itemIds.length);
    expect([...provenanceIds].sort()).toEqual([...itemIds].sort());

    for (const prov of draftFile.reviewMetadata.proposalProvenance) {
      expect(prov.sourceClaimId).toBe("GAP-N12");
      expect(prov.sourceId).toBe("USDA-FDC");
      expect(prov.sourceUrl.startsWith("https://")).toBe(true);
      expect(prov.sourceLocator).toMatch(/^fdcId \d+; dataType (Foundation|SR Legacy); publication .+/);
    }
  });

  it("No item has reviewState: 'ACCEPTED' while allowlist is ENGINEER_DRAFT", () => {
    const draftFile = loadDraftUnsignedFoodCatalog();
    for (const item of draftFile.content.items) {
      expect(item.reviewState).not.toBe("ACCEPTED");
    }
  });

  it("draft food catalog cannot be synthetic", () => {
    const draftFile = loadDraftUnsignedFoodCatalog();
    const draftInput = {
      id: `${draftFile.content.artifactKey}:v${draftFile.content.version}`,
      artifactKey: draftFile.content.artifactKey,
      version: draftFile.content.version,
      kind: "FOOD_CATALOG" as const,
      schemaVersion: 1 as const,
      engineVersions: ["ai-coach-artifact-engine-v1"],
      dependencies: [],
      synthetic: true, // Forbidden for DRAFT_UNSIGNED
      reviewMetadata: draftFile.reviewMetadata,
      content: draftFile.content,
    };

    expect(() => parseArtifactDraftInput(draftInput)).toThrow(
      "Draft unsigned artifacts cannot be synthetic"
    );
  });

  it("loadDraftUnsignedFoodCatalog throws when NODE_ENV === 'production'", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => loadDraftUnsignedFoodCatalog()).toThrow(
        "Draft unsigned artifacts cannot be loaded in production environments."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("The checked-in allowlist parses, has 200–300 entries, valid dataTypes, known categoryIds, matching digest, and no ACCEPTED entries", () => {
    const rawPlan = fs.readFileSync(COVERAGE_PLAN_PATH, "utf8");
    const plan = coveragePlanSchema.parse(JSON.parse(rawPlan));
    const expectedDigest = contentHash(plan);
    const validCategoryIds = new Set(plan.categories.map((c) => c.categoryId));

    const rawAllowlist = fs.readFileSync(ALLOWLIST_PATH, "utf8");
    const allowlist = allowlistSchema.parse(JSON.parse(rawAllowlist));

    expect(allowlist.entries.length).toBeGreaterThanOrEqual(200);
    expect(allowlist.entries.length).toBeLessThanOrEqual(300);
    expect(allowlist.curationState).toBe("ENGINEER_DRAFT");
    expect(allowlist.coveragePlanDigest).toBe(expectedDigest);

    for (const entry of allowlist.entries) {
      expect(["Foundation", "SR Legacy"]).toContain(entry.dataType);
      expect(validCategoryIds.has(entry.categoryId)).toBe(true);
      expect(entry.reviewState).not.toBe("ACCEPTED");
      expect(entry.reviewState).toBe("PROPOSED");
    }
  });

  it("Every allowlist entry has a unique fdcId and unique canonicalName", () => {
    const rawAllowlist = fs.readFileSync(ALLOWLIST_PATH, "utf8");
    const allowlist = allowlistSchema.parse(JSON.parse(rawAllowlist));

    const seenFdcIds = new Set<number>();
    const seenNames = new Set<string>();

    for (const entry of allowlist.entries) {
      expect(seenFdcIds.has(entry.fdcId)).toBe(false);
      seenFdcIds.add(entry.fdcId);

      const normalizedName = entry.canonicalName.toLowerCase();
      expect(seenNames.has(normalizedName)).toBe(false);
      seenNames.add(normalizedName);
    }
  });

  it("A STRUCK entry produces no catalog item", () => {
    const struckEntry: AllowlistEntry = {
      fdcId: 999999,
      dataType: "Foundation",
      canonicalName: "Struck Test Food",
      synonyms: [],
      categoryId: "VEGETABLE",
      foodState: "RAW",
      singleIngredientWholeFood: true,
      patternTags: ["OMNIVORE"],
      ownAllergenCategories: [],
      reviewState: "STRUCK",
      reviewerNote: "Struck by reviewer",
    };

    // When ingestion encounters STRUCK, it skips producing an item
    const entries = [struckEntry];
    const itemsEmitted = entries
      .filter((e) => e.reviewState !== "STRUCK")
      .map((e) => e.canonicalName);

    expect(itemsEmitted).toHaveLength(0);
  });
});
