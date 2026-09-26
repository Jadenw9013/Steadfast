import { describe, expect, it } from "vitest";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import { foodCatalogContentSchema } from "@/lib/ai-coach/artifacts/schema";
import { getReviewedFoodItem } from "@/lib/ai-coach/artifacts/repository";

describe("T-2035 — artifact schema backward compatibility and digest neutrality", () => {
  it("foodCatalog digest equals the golden hash captured on sprint-1 before the schema edit", () => {
    const set = buildSyntheticArtifactSet();
    const digest = artifactContentDigest(set.foodCatalog);
    expect(digest).toBe("5c5153170d060f62937fb58eea635e869978f2e5445413709732fd5b577d7a7a");
  });

  it("t1008-runtime foodCatalog digest equals its golden hash captured before the schema edit", () => {
    const set = buildSyntheticArtifactSet("t1008-runtime");
    const digest = artifactContentDigest(set.foodCatalog);
    expect(digest).toBe("9d7eb3f81a2fc045345f79a315aead0a5c2779178ab0385eca13fef3abd92695");
  });

  it("foodCatalogContentSchema.parse of pre-change synthetic content introduces no defaults", () => {
    const set = buildSyntheticArtifactSet();
    const parsed = foodCatalogContentSchema.parse(set.foodCatalog.content);
    expect("catalogProfile" in parsed).toBe(false);
    expect("market" in parsed).toBe(false);

    for (const item of parsed.items) {
      expect("synonyms" in item).toBe(false);
      expect("sourceRecord" in item).toBe(false);
      expect("amountBasis" in item).toBe(false);
      expect("nutrientFacts" in item).toBe(false);
      expect("energyFact" in item).toBe(false);
      expect("allergenFactsV2" in item).toBe(false);
      expect("patternTags" in item).toBe(false);
      expect("reviewState" in item).toBe(false);
      expect("supersedesItemId" in item).toBe(false);
    }
  });

  it("SOURCED_V2 content missing any newly-required field fails parse with the field named", () => {
    const set = buildSyntheticArtifactSet();
    const sourcedContent = {
      ...set.foodCatalog.content,
      catalogProfile: "SOURCED_V2",
      market: "US",
    };

    expect(() => foodCatalogContentSchema.parse(sourcedContent)).toThrowError(
      /Field synonyms is required under SOURCED_V2 profile/
    );

    const nonUsContent = {
      ...set.foodCatalog.content,
      catalogProfile: "SOURCED_V2",
      market: "UK",
    };
    expect(() => foodCatalogContentSchema.parse(nonUsContent)).toThrowError();
  });

  it("getReviewedFoodItem refuses raw unverified artifact with ARTIFACT_INVALID", () => {
    const set = buildSyntheticArtifactSet();
    expect(() => getReviewedFoodItem(set.foodCatalog as any, "SYNTHETIC_CHICKEN_BREAST")).toThrowError(
      /Catalog access requires an artifact returned by the reviewed server loader/
    );
  });
});
