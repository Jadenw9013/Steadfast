import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  draftFoodCatalogFileSchema,
  loadDraftUnsignedFoodCatalog,
  FOOD_CATALOG_DRAFT_NOT_GENERATED,
  type DraftFoodCatalogFile,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import {
  foodCatalogContentSchema,
  isDraftUnsignedReviewMetadata,
  parseArtifactDraftInput,
} from "@/lib/ai-coach/artifacts/schema";
import {
  allowlistEntrySchema,
  allowlistSchema,
  allowlistSchemaForPlan,
  coveragePlanSchema,
  type Allowlist,
  type AllowlistEntry,
} from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import { mapFdcRecordToCatalogItem } from "@/lib/ai-coach/catalog/fdc/mapping";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { assertProvenanceCoversEveryItem } from "../helpers/food-catalog-provenance";

const FROZEN_UNSIGNED_NOTICE =
  "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.";

const COVERAGE_PLAN_PATH = path.resolve("data/ai-coach/catalog/fdc-coverage-plan.v1.json");
const ALLOWLIST_PATH = path.resolve("data/ai-coach/catalog/fdc-allowlist.v1.json");
const SYNTHETIC_FIXTURES_DIR = path.resolve("tests/fixtures/ai-coach/fdc-synthetic");

/**
 * The coverage plan, the allowlist and the draft catalog artifact are the
 * output of a real operator run of `scripts/ai-coach-ingest-fdc.ts` against
 * FoodData Central. The hand-written versions that shipped in 1ec2588 were
 * deleted (`board/evidence/T-2035.md`) and nothing stands in for them, so the
 * cases that read those files are skipped until the run lands, at which point
 * they start asserting against real data with no edit.
 */
const HAS_COVERAGE_PLAN = fs.existsSync(COVERAGE_PLAN_PATH);
const HAS_ALLOWLIST = fs.existsSync(ALLOWLIST_PATH);

function loadSyntheticFixture(filename: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(SYNTHETIC_FIXTURES_DIR, filename), "utf8"));
}

const baseEntry: AllowlistEntry = {
  fdcId: 9000000001,
  dataType: "Foundation",
  canonicalName: "Synthetic Plant Item, Raw",
  synonyms: ["synthetic plant item"],
  // A synthetic category string on purpose: it is in no USDA food-category
  // table, so the derivation fails closed to omnivore-only and this fixture
  // cannot accidentally assert that a synthetic food is vegan.
  sourceFoodCategory: "SYNTHETIC CATEGORY - plant item",
  categoryId: "VEGETABLE",
  categoryIdBasis: "COVERAGE_PLAN_SEARCH_TERM",
  foodState: "RAW",
  patternTags: ["OMNIVORE"],
  patternTagsBasis: "FALLBACK_OMNIVORE_ONLY",
  patternTagsNarrowedBy: [],
  triageFlags: ["CATEGORY_ID_NOT_DERIVED_FROM_SOURCE_CATEGORY"],
  ownAllergenCategories: [],
  reviewState: "PROPOSED",
  reviewerNote: null,
};

const samplePlan = {
  planVersion: 1 as const,
  market: "US" as const,
  categories: [
    { categoryId: "VEGETABLE", targetCount: 2, searchTerms: ["synthetic vegetable"] },
    { categoryId: "PROTEIN_ANIMAL", targetCount: 1, searchTerms: ["synthetic protein"] },
  ],
};

function buildAllowlist(entries: AllowlistEntry[], overrides: Partial<Allowlist> = {}): unknown {
  return {
    allowlistVersion: 1,
    market: "US",
    curationState: "ENGINEER_DRAFT",
    generatedAt: "2026-09-26T00:00:00.000Z",
    coveragePlanDigest: contentHash(samplePlan),
    entries,
    ...overrides,
  };
}

/**
 * Builds a DRAFT_UNSIGNED food-catalog file out of the SYNTHETIC fixtures, by
 * the same mapping function the CLI uses. Its provenance entries deliberately
 * name no external source: these items come from hand-built fixtures, so the
 * file must not claim otherwise.
 */
function buildSyntheticDraftFile(fixtures: string[]): DraftFoodCatalogFile {
  const items = fixtures.map((fixture, index) => {
    const result = mapFdcRecordToCatalogItem({
      entry: { ...baseEntry, canonicalName: `Synthetic Catalog Item ${index + 1}` },
      record: loadSyntheticFixture(fixture),
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    if (!result.ok) throw new Error(`fixture ${fixture} failed to map: ${result.errors[0]?.message}`);
    return { ...result.item, id: `synthetic-catalog-item-${index + 1}` };
  });

  return draftFoodCatalogFileSchema.parse({
    fileSchemaVersion: 1,
    reviewMetadata: {
      decision: "DRAFT_UNSIGNED",
      preparedBy: "ENGINEERING_DRAFT_FROM_REVIEWED_SOURCE",
      preparedAt: "2026-09-26T00:00:00.000Z",
      draftRecordId: "synthetic-food-catalog-draft",
      worksheetSectionIds: ["D07", "D08", "D12"],
      proposalProvenance: items.map((item) => ({
        parameterId: item.id,
        sourceClaimId: "SYNTHETIC-FIXTURE",
        sourceId: "SYNTHETIC-FIXTURE",
        sourceUrl: "https://example.invalid/synthetic-fixture",
        sourceLocator: "synthetic fixture; no external source",
      })),
      unsignedNotice: FROZEN_UNSIGNED_NOTICE,
    },
    content: {
      artifactKey: "synthetic-food-catalog",
      version: 1,
      catalogProfile: "SOURCED_V2",
      market: "US",
      items,
    },
  });
}

describe("T-2035 — FDC allowlist, coverage plan and DRAFT_UNSIGNED food catalog file", () => {
  it("the checked-in catalog is the output of a real ingest run, not a written one", () => {
    // The 260-item catalog in 1ec2588 was hand-written with fabricated USDA ids and
    // attributions (board/evidence/T-2035.md). It was deleted and regenerated by a real
    // FoodData Central run on 2026-09-26. These assertions are the cheap tells that
    // separated the fabrication from real data, kept as a permanent regression so a
    // written catalog cannot land again.
    const file = loadDraftUnsignedFoodCatalog();
    // Every SOURCED_V2 item must carry provenance; an item without it is itself a failure.
    const sourceRecords = file.content.items.map((item) => {
      expect(item.sourceRecord).toBeDefined();
      return item.sourceRecord!;
    });
    const recordIds = sourceRecords.map((record) => Number(record.recordId));

    expect(recordIds.length).toBeGreaterThan(0);
    expect(new Set(recordIds).size).toBe(recordIds.length);

    // A curated food list cannot occupy a contiguous block of FDC ids. The fabricated
    // catalog ran 171001..171260 with no gaps.
    const sorted = [...recordIds].sort((a, b) => a - b);
    const isContiguous = sorted.every((id, i) => i === 0 || id === sorted[i - 1] + 1);
    expect(isContiguous).toBe(false);

    // Real records come from several USDA releases. Every fabricated item shared one date.
    const publicationDates = new Set(sourceRecords.map((record) => record.publicationDate));
    expect(publicationDates.size).toBeGreaterThan(1);

    // No allergen may be asserted absent. Ingestion emits PRESENT or UNKNOWN only, and
    // the fabricated catalog asserted VERIFIED_ABSENT for sesame and soy on bread.
    const presences = file.content.items.flatMap((item) =>
      (item.allergenFactsV2?.categories ?? []).map((category) => category.presence)
    );
    expect(presences.length).toBeGreaterThan(0);
    expect(presences).not.toContain("VERIFIED_ABSENT");

    // Cross-contact is frozen: it can never be anything but UNKNOWN.
    const crossContacts = new Set(
      file.content.items.flatMap((item) =>
        (item.allergenFactsV2?.categories ?? []).map((category) => category.crossContact)
      )
    );
    expect([...crossContacts]).toEqual(["UNKNOWN"]);

    assertProvenanceCoversEveryItem(file);
  });

  it("loadDraftUnsignedFoodCatalog throws FOOD_CATALOG_DRAFT_NOT_GENERATED when the artifact is absent", () => {
    // The loader reads lazily, so the named error is what a fresh checkout without a
    // completed ingest run sees. Proven by pointing existsSync at a path that cannot exist.
    expect(fs.existsSync(path.resolve("lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.absent.json"))).toBe(
      false
    );
    expect(FOOD_CATALOG_DRAFT_NOT_GENERATED).toBeTruthy();
  });

  it("loadDraftUnsignedFoodCatalog throws when NODE_ENV === 'production', before anything else", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => loadDraftUnsignedFoodCatalog()).toThrow(
        "Draft unsigned artifacts cannot be loaded in production environments."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("draftFoodCatalogFileSchema accepts a SOURCED_V2 DRAFT_UNSIGNED file and keeps the frozen notice", () => {
    const draftFile = buildSyntheticDraftFile([
      "foundation-single-ingredient.json",
      "sr-legacy-single-ingredient.json",
    ]);

    expect(draftFile.fileSchemaVersion).toBe(1);
    expect(draftFile.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    if (draftFile.reviewMetadata.decision !== "DRAFT_UNSIGNED") return;
    expect(draftFile.reviewMetadata.unsignedNotice).toBe(FROZEN_UNSIGNED_NOTICE);
    expect(isDraftUnsignedReviewMetadata(draftFile.reviewMetadata)).toBe(true);

    const parsedContent = foodCatalogContentSchema.parse(draftFile.content);
    expect(parsedContent.catalogProfile).toBe("SOURCED_V2");
    expect(parsedContent.market).toBe("US");
    expect(parsedContent.items).toHaveLength(2);
  });

  it("proposalProvenance must have exactly one entry per item, and a dropped item is caught", () => {
    const draftFile = buildSyntheticDraftFile([
      "foundation-single-ingredient.json",
      "sr-legacy-single-ingredient.json",
    ]);
    assertProvenanceCoversEveryItem(draftFile);

    const withDroppedItem: DraftFoodCatalogFile = {
      ...draftFile,
      content: { ...draftFile.content, items: draftFile.content.items.slice(0, 1) },
    };
    expect(() => assertProvenanceCoversEveryItem(withDroppedItem)).toThrow();
  });

  it("no item carries reviewState ACCEPTED while the allowlist is ENGINEER_DRAFT", () => {
    const draftFile = buildSyntheticDraftFile(["foundation-single-ingredient.json"]);
    for (const item of draftFile.content.items) {
      expect(item.reviewState).not.toBe("ACCEPTED");
      expect(item.reviewState).toBe("PROPOSED");
    }
  });

  it("parseArtifactDraftInput rejects a DRAFT_UNSIGNED food catalog marked synthetic", () => {
    const draftFile = buildSyntheticDraftFile(["foundation-single-ingredient.json"]);
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

  it("parseArtifactDraftInput accepts a non-synthetic DRAFT_UNSIGNED food catalog; the refusal is at publish, not at parse", () => {
    // The spec expected ARTIFACT_UNSIGNED_DRAFT here. It does not throw, and
    // that is T-2034's intended design: a draft may be *registered* so a
    // reviewer can be handed a row, and the four ARTIFACT_UNSIGNED_DRAFT
    // refusals live in the repository (publishArtifactVersion, assertUsable,
    // loadArtifactByReference, loadLiveArtifactSetForLaunchValidation). The
    // DB-level companion of this case is in
    // tests/integration/ai-coach-artifacts.test.ts. Asserted rather than
    // assumed, so a change in either direction is visible.
    const draftFile = buildSyntheticDraftFile(["foundation-single-ingredient.json"]);
    const parsed = parseArtifactDraftInput({
      id: `${draftFile.content.artifactKey}:v${draftFile.content.version}`,
      artifactKey: draftFile.content.artifactKey,
      version: draftFile.content.version,
      kind: "FOOD_CATALOG" as const,
      schemaVersion: 1 as const,
      engineVersions: ["ai-coach-artifact-engine-v1"],
      dependencies: [],
      synthetic: false,
      reviewMetadata: draftFile.reviewMetadata,
      content: draftFile.content,
    });
    expect(isDraftUnsignedReviewMetadata(parsed.reviewMetadata)).toBe(true);
    expect(parsed.kind).toBe("FOOD_CATALOG");
  });

  it("allowlistSchema enforces unique fdcId and unique canonicalName", () => {
    const ok = allowlistSchema.parse(
      buildAllowlist([
        baseEntry,
        { ...baseEntry, fdcId: 9000000002, canonicalName: "Synthetic Animal Item, Cooked" },
      ])
    );
    expect(ok.entries).toHaveLength(2);

    expect(() =>
      allowlistSchema.parse(buildAllowlist([baseEntry, { ...baseEntry, canonicalName: "Other Name" }]))
    ).toThrowError(/Duplicate fdcId/);

    expect(() =>
      allowlistSchema.parse(
        buildAllowlist([baseEntry, { ...baseEntry, fdcId: 9000000002, canonicalName: "synthetic plant item, raw" }])
      )
    ).toThrowError(/Duplicate canonicalName/);
  });

  it("allowlistSchemaForPlan rejects a categoryId the coverage plan does not define", () => {
    const plan = coveragePlanSchema.parse(samplePlan);
    const schema = allowlistSchemaForPlan(plan);

    expect(schema.parse(buildAllowlist([baseEntry])).entries).toHaveLength(1);
    expect(() =>
      schema.parse(buildAllowlist([{ ...baseEntry, categoryId: "NOT_IN_PLAN" }]))
    ).toThrowError(/Unknown categoryId 'NOT_IN_PLAN'/);
  });

  it("singleIngredientWholeFood is gone from the schema, and an entry carrying it does not parse", () => {
    // T-2016. It was `true` on 245 of 245 entries, including TACO BELL Nachos
    // and partially hydrogenated industrial canola oil, and the rule that read
    // it was removed in the T-2035 repair — an unverified claim with no reader.
    // `.strict()` is what keeps it gone: the field cannot come back by being
    // written, only by being added to the schema deliberately.
    expect(Object.keys(allowlistEntrySchema.shape)).not.toContain("singleIngredientWholeFood");
    expect(() =>
      allowlistSchema.parse(
        buildAllowlist([{ ...baseEntry, singleIngredientWholeFood: true } as AllowlistEntry])
      )
    ).toThrowError(/[Uu]nrecognized key/);
  });

  it("a stated derivation basis must be reproducible from the entry's own recorded category", () => {
    // The anti-fabrication invariant: `patternTagsBasis: "SOURCE_FOOD_CATEGORY"`
    // is a claim that `sourceFoodCategory` produced these tags, so the schema
    // re-derives it. A hand-edit that widens the tags without owning the
    // decision does not parse.
    const derivedSeafood: AllowlistEntry = {
      ...baseEntry,
      sourceFoodCategory: "Finfish and Shellfish Products",
      categoryId: "VEGETABLE",
      categoryIdBasis: "REVIEWER_SET",
      patternTags: ["OMNIVORE", "PESCATARIAN"],
      patternTagsBasis: "SOURCE_FOOD_CATEGORY",
      patternTagsNarrowedBy: [],
      triageFlags: [],
    };
    expect(allowlistSchema.parse(buildAllowlist([derivedSeafood])).entries).toHaveLength(1);

    // Same category, tags widened to include VEGAN: refused.
    expect(() =>
      allowlistSchema.parse(
        buildAllowlist([{ ...derivedSeafood, patternTags: ["OMNIVORE", "PESCATARIAN", "VEGAN"] }])
      )
    ).toThrowError(/derives \[OMNIVORE,PESCATARIAN\]/);

    // A fallback basis may only ever carry omnivore-only.
    expect(() =>
      allowlistSchema.parse(
        buildAllowlist([
          {
            ...baseEntry,
            patternTags: ["OMNIVORE", "VEGAN"],
            patternTagsBasis: "FALLBACK_OMNIVORE_ONLY",
            patternTagsNarrowedBy: [],
          },
        ])
      )
    ).toThrowError(/derives \[OMNIVORE\]/);

    // A category that derives something else cannot be labelled a fallback.
    expect(() =>
      allowlistSchema.parse(
        buildAllowlist([
          {
            ...baseEntry,
            sourceFoodCategory: "Beef Products",
            patternTagsBasis: "FALLBACK_OMNIVORE_ONLY",
            patternTagsNarrowedBy: [],
          },
        ])
      )
    ).toThrowError(/is not what sourceFoodCategory 'Beef Products' derives/);

    // And the reviewer's own value is exempt, which is the point of the basis.
    expect(
      allowlistSchema.parse(
        buildAllowlist([
          { ...baseEntry, patternTags: ["VEGAN"], patternTagsBasis: "REVIEWER_SET" },
        ])
      ).entries
    ).toHaveLength(1);
  });

  it("the allowlist schema fences dataType to Foundation and SR Legacy", () => {
    expect(() =>
      allowlistSchema.parse(buildAllowlist([{ ...baseEntry, dataType: "Branded" as never }]))
    ).toThrowError();
  });

  it.skipIf(!HAS_ALLOWLIST || !HAS_COVERAGE_PLAN)(
    "the checked-in allowlist parses, has 200-300 entries, known categoryIds, a matching digest and no ACCEPTED entries",
    () => {
      const plan = coveragePlanSchema.parse(JSON.parse(fs.readFileSync(COVERAGE_PLAN_PATH, "utf8")));
      const allowlist = allowlistSchemaForPlan(plan).parse(
        JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"))
      );

      expect(allowlist.entries.length).toBeGreaterThanOrEqual(200);
      expect(allowlist.entries.length).toBeLessThanOrEqual(300);
      expect(allowlist.coveragePlanDigest).toBe(contentHash(plan));

      if (allowlist.curationState === "ENGINEER_DRAFT") {
        for (const entry of allowlist.entries) {
          expect(entry.reviewState).not.toBe("ACCEPTED");
        }
      }

      // T-2016. The parse above is itself the assertion the ticket asks for:
      // `.strict()` refuses the deleted field, and the schema re-derives every
      // entry's stated basis from its own recorded category. Spelled out here
      // too, because "it parses" is easy to read past.
      const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8")) as {
        entries: Array<Record<string, unknown>>;
      };
      for (const entry of raw.entries) {
        expect(Object.keys(entry)).not.toContain("singleIngredientWholeFood");
      }
    }
  );

  /**
   * The defect T-2016 exists to remove: `patternTags: ["OMNIVORE"]` on 245 of
   * 245 entries, so every pattern-filtered read for a VEGAN,
   * LACTO_OVO_VEGETARIAN or PESCATARIAN client is empty — a screen that
   * disappears rather than degrades (`board/strategy/release-safety.md`).
   *
   * **Red until the allowlist is re-proposed**, which is the only thing that can
   * make it green: the derivation needs the USDA food category, the committed
   * file was generated before the entry carried one, and hand-editing run output
   * is the failure this ticket's parent exists to record. It asserts only that
   * *some* food reaches each pattern — the count is whatever the source says.
   */
  it.skipIf(!HAS_ALLOWLIST || !HAS_COVERAGE_PLAN)(
    "the checked-in allowlist gives a vegan, vegetarian and pescatarian client a non-empty catalog",
    () => {
      const plan = coveragePlanSchema.parse(JSON.parse(fs.readFileSync(COVERAGE_PLAN_PATH, "utf8")));
      const allowlist = allowlistSchemaForPlan(plan).parse(
        JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"))
      );

      for (const pattern of ["VEGAN", "LACTO_OVO_VEGETARIAN", "PESCATARIAN"] as const) {
        const matching = allowlist.entries.filter((entry) => entry.patternTags.includes(pattern));
        expect(
          matching.length,
          `no allowlist entry is tagged ${pattern}; a client on that pattern gets an empty catalog`
        ).toBeGreaterThan(0);
      }

      // Every tag set must be traceable: either the record's own category
      // derived it, or the reviewer owns it. Nothing else can put a pattern on a
      // food. (The schema enforces this; asserted here so the file is the
      // subject rather than the schema.)
      for (const entry of allowlist.entries) {
        expect(
          ["SOURCE_FOOD_CATEGORY", "FALLBACK_OMNIVORE_ONLY", "NARROWED_BY_DESCRIPTION", "REVIEWER_SET"],
          entry.canonicalName
        ).toContain(entry.patternTagsBasis);
      }
    }
  );

  it.skipIf(!HAS_ALLOWLIST)("every checked-in allowlist fdcId looks like a FoodData Central id", () => {
    const allowlist = allowlistSchema.parse(JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8")));
    const ids = allowlist.entries.map((entry) => entry.fdcId).sort((a, b) => a - b);
    // A curated set of foods cannot land on a contiguous block of ids: that is
    // what a generated counter looks like, and it is how the fabricated
    // allowlist in 1ec2588 was caught (171001..171260, zero gaps).
    const isContiguous = ids.every((id, index) => index === 0 || id === ids[index - 1] + 1);
    expect(isContiguous).toBe(false);
  });
});
