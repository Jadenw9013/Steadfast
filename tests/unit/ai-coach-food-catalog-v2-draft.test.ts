import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  loadDraftUnsignedFoodCatalog,
  loadDraftUnsignedFoodCatalogV2,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import { foodCatalogContentSchema, isDraftUnsignedReviewMetadata } from "@/lib/ai-coach/artifacts/schema";
import { sourcedFoodCatalogSource } from "@/lib/ai-coach/catalog/food-source";

/**
 * S-31 — food catalog **v2**, DRAFT_UNSIGNED.
 *
 * `content.version: 2` sits on top of the signed v1 (S-17, `content.version: 1`),
 * carrying its 232 items byte-identical and appending 24 COOKED items adopted
 * from the recorded 2026-09-27 ingest run preserved at commit `aff0f71` on
 * `team/T-2042-cooked-foods` (board/tickets/S-31.md). v1 itself is never
 * touched by this file or by the loader that reads it.
 *
 * The digests below were computed by running `contentHash` over the loaded
 * v2 file and pasting stdout (see the S-31 engineer report), the same rule
 * `ai-coach-signed-artifact-digests.test.ts` follows for the five signed
 * artifacts: never typed by hand, never copied from a failing assertion.
 */

const NEW_ITEM_IDS = [
  "fdc-167828",
  "fdc-167842",
  "fdc-168241",
  "fdc-168250",
  "fdc-168254",
  "fdc-168633",
  "fdc-168635",
  "fdc-168636",
  "fdc-169458",
  "fdc-171097",
  "fdc-171477",
  "fdc-171481",
  "fdc-171496",
  "fdc-172005",
  "fdc-172387",
  "fdc-172388",
  "fdc-172395",
  "fdc-172877",
  "fdc-173637",
  "fdc-173639",
  "fdc-173707",
  "fdc-174500",
  "fdc-174514",
  "fdc-174516",
] as const;

describe("S-31 — food catalog v2 draft (unsigned)", () => {
  it("fileSchemaVersion 1, content.version 2, 256 items, parses under the signed schema", () => {
    const v2 = loadDraftUnsignedFoodCatalogV2();
    expect(v2.fileSchemaVersion).toBe(1);
    expect(v2.content.version).toBe(2);
    expect(v2.content.artifactKey).toBe("food-catalog");
    expect(v2.content.items).toHaveLength(256);
    expect(() => foodCatalogContentSchema.parse(v2.content)).not.toThrow();
  });

  it("is DRAFT_UNSIGNED, not APPROVED, and never touches v1's file", () => {
    const v1 = loadDraftUnsignedFoodCatalog();
    const v2 = loadDraftUnsignedFoodCatalogV2();
    expect(v1.content.version).toBe(1);
    expect(v1.content.items).toHaveLength(232);
    expect(v1.reviewMetadata.decision).toBe("APPROVED");

    expect(v2.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    expect(isDraftUnsignedReviewMetadata(v2.reviewMetadata)).toBe(true);
    if (v2.reviewMetadata.decision !== "DRAFT_UNSIGNED") return;
    expect(v2.reviewMetadata.preparedBy).toBe("ENGINEERING_DRAFT_FROM_REVIEWED_SOURCE");
    expect(v2.reviewMetadata.unsignedNotice).toBe(
      "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE."
    );
  });

  it("carries v1's 232 items byte-identical, then the 24 new ones appended", () => {
    const v1 = loadDraftUnsignedFoodCatalog();
    const v2 = loadDraftUnsignedFoodCatalogV2();

    expect(v2.content.items.slice(0, 232)).toEqual(v1.content.items);

    const appended = v2.content.items.slice(232);
    expect(appended.map((item) => item.id)).toEqual([...NEW_ITEM_IDS]);
    for (const item of appended) {
      expect(item.foodState).toBe("COOKED");
      expect(item.reviewState).toBe("PROPOSED");
      expect(item.patternTags).toBeDefined();
      expect(item.allergenFactsV2).toBeDefined();
    }

    // None of the 24 exist in v1; all 24 exist in v2.
    const v1Ids = new Set(v1.content.items.map((item) => item.id));
    for (const id of NEW_ITEM_IDS) {
      expect(v1Ids.has(id)).toBe(false);
    }
  });

  it("proposalProvenance covers exactly the 24 new items, naming the source commit and ingest date", () => {
    const v2 = loadDraftUnsignedFoodCatalogV2();
    if (v2.reviewMetadata.decision !== "DRAFT_UNSIGNED") throw new Error("v2 is not a draft");
    const provenance = v2.reviewMetadata.proposalProvenance;
    expect(provenance.map((p) => p.parameterId).sort()).toEqual([...NEW_ITEM_IDS].sort());
    for (const row of provenance) {
      expect(row.sourceId).toBe("USDA-FDC");
      expect(row.sourceUrl.startsWith("https://fdc.nal.usda.gov/")).toBe(true);
      expect(row.sourceLocator).toContain("aff0f71");
      expect(row.sourceLocator).toContain("2026-09-27");
    }
  });

  it("pins the content and review-metadata digest of the v2 draft", () => {
    const v2 = loadDraftUnsignedFoodCatalogV2();
    expect({
      content: contentHash(v2.content),
      reviewMetadata: contentHash(v2.reviewMetadata),
    }).toEqual({
      content: "ff2f6a59605b2a4256323eca415bc6fb8d45da7370f56ae689032bb63e137510",
      reviewMetadata: "e458ff96f381158e64e106b146a2fbaeac563e36372bf148d83af2de9c49bc5d",
    });
  });

  it("read path: sourcedFoodCatalogSource resolves one of the 24 at v2 and not at v1", () => {
    const v1 = loadDraftUnsignedFoodCatalog();
    const v2 = loadDraftUnsignedFoodCatalogV2();
    const sampleId = "fdc-171477"; // Chicken, broilers or fryers, breast, meat only, cooked, roasted

    const v1Source = sourcedFoodCatalogSource(v1.content);
    const v2Source = sourcedFoodCatalogSource(v2.content);

    expect(v2Source.catalogVersion).toBe("food-catalog:v2");
    expect(v1Source.catalogVersion).toBe("food-catalog:v1");

    const atV2 = v2Source.get(sampleId, "food-catalog:v2");
    expect(atV2.success).toBe(true);
    if (atV2.success) {
      expect(atV2.item.foodState).toBe("COOKED");
    }

    // The same id resolved against the v1 source (the signed catalog) is
    // unknown: v1 never carried these 24 records.
    const atV1 = v1Source.get(sampleId, "food-catalog:v1");
    expect(atV1).toEqual({ success: false, error: "UNKNOWN_ID" });

    // And the bare artifactKey also resolves v2 (matching `food-source.ts`'s
    // "requestedCatalogVersion !== version && requestedCatalogVersion !== content.artifactKey" check).
    const atV2ByKey = v2Source.get(sampleId, "food-catalog");
    expect(atV2ByKey.success).toBe(true);
  });
});
