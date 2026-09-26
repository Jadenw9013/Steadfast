import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isIngestableEntry,
  mapFdcRecordToCatalogItem,
  mapNutrientDerivation,
  redactUrl,
  selectIngestableEntries,
  toLegacyAllergenTokens,
} from "@/lib/ai-coach/catalog/fdc/mapping";
import type { AllowlistEntry } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import {
  allergenCategorySchema,
  foodCatalogContentSchema,
} from "@/lib/ai-coach/artifacts/schema";
import { allergenSchema } from "@/lib/ai-coach/catalog/schema";
import { LEGACY_TOKEN_BY_CATEGORY } from "@/lib/ai-coach/intake-allergens";

/**
 * SYNTHETIC fixtures — hand-built to exercise code paths, not recorded USDA
 * responses. See `tests/fixtures/ai-coach/fdc-synthetic/*.json`'s own
 * `_synthetic` block and `docs/ai-coach/catalog/README.md` §5.
 */
const FIXTURES_DIR = path.resolve("tests/fixtures/ai-coach/fdc-synthetic");

function loadFixture(filename: string): unknown {
  const filePath = path.join(FIXTURES_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const mockAllowlistEntry: AllowlistEntry = {
  fdcId: 9000000001,
  dataType: "Foundation",
  canonicalName: "Synthetic Plant Item, Raw",
  synonyms: ["synthetic plant item"],
  categoryId: "VEGETABLE",
  foodState: "RAW",
  singleIngredientWholeFood: true,
  patternTags: ["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN"],
  ownAllergenCategories: [],
  reviewState: "PROPOSED",
  reviewerNote: null,
};

describe("T-2035 — FDC mapping pure module", () => {
  it("Foundation fixture maps to a SOURCED_V2 item", () => {
    const rawFoundation = loadFixture("foundation-single-ingredient.json");
    const retrievedAt = "2026-09-26T00:00:00.000Z";

    const res = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt,
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.item.sourceRecord?.dataType).toBe("FOUNDATION");
    expect(res.item.sourceRecord?.license).toBe("CC0_PUBLIC_DOMAIN");
    expect(res.item.sourceRecord?.retrievedAt).toBe(retrievedAt);
    expect(res.item.amountBasis?.basisGrams).toBe(100);

    // A nutrient row whose unit cannot be mapped is skipped with a warning, not
    // guessed at and not silently dropped.
    expect(res.warnings.some((w) => w.code === "UNRECOGNIZED_NUTRIENT_UNIT")).toBe(true);
    expect(res.item.nutrientFacts?.some((n) => n.unit === ("SP_GR" as never))).toBe(false);
    // The kJ energy row must not be mistaken for the kcal energy row.
    expect(res.item.nutrients.energyKcal).toBe(100);

    // Validate that the item satisfies SOURCED_V2 food catalog schema
    const container = {
      artifactKey: "food-catalog",
      version: 1,
      catalogProfile: "SOURCED_V2" as const,
      market: "US" as const,
      items: [res.item],
    };
    expect(() => foodCatalogContentSchema.parse(container)).not.toThrow();
  });

  it("SR Legacy fixture maps with dataType === 'SR_LEGACY'", () => {
    const rawSr = loadFixture("sr-legacy-single-ingredient.json");
    const entry: AllowlistEntry = {
      ...mockAllowlistEntry,
      fdcId: 9000000002,
      dataType: "SR Legacy",
      canonicalName: "Synthetic Animal Item, Cooked",
      categoryId: "PROTEIN_ANIMAL",
      foodState: "COOKED",
    };

    const res = mapFdcRecordToCatalogItem({
      entry,
      record: rawSr,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.item.sourceRecord?.dataType).toBe("SR_LEGACY");
    expect(res.item.name).toBe("Synthetic Animal Item, Cooked");
  });

  it("A Branded fixture is rejected with a named error and no item is produced", () => {
    const rawBranded = loadFixture("branded-disallowed.json");
    const entry: AllowlistEntry = {
      ...mockAllowlistEntry,
      fdcId: 9000000008,
      canonicalName: "Synthetic Branded Item",
    };

    const res = mapFdcRecordToCatalogItem({
      entry,
      record: rawBranded,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;

    expect(res.errors.some((e) => e.code === "DISALLOWED_DATA_TYPE")).toBe(true);
  });

  it("A nutrient absent from the record becomes { value: null, status: 'UNKNOWN' } and not.toBe(0)", () => {
    const rawMissing = loadFixture("missing-nutrient.json");
    const entry: AllowlistEntry = {
      ...mockAllowlistEntry,
      fdcId: 9000000003,
      canonicalName: "Synthetic Item With No Fiber Row",
      categoryId: "FRUIT",
    };

    const res = mapFdcRecordToCatalogItem({
      entry,
      record: rawMissing,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Fiber (1079) is absent from missing-nutrient fixture
    const fiberFact = res.item.nutrientFacts?.find(
      (n) => n.nutrientId === "1079" || n.nutrientName.toLowerCase().includes("fiber")
    );
    expect(fiberFact).toBeDefined();
    expect(fiberFact?.status).toBe("UNKNOWN");
    expect(fiberFact?.value).toBeNull();
    expect(fiberFact?.value).not.toBe(0);
  });

  it("A nutrient the record explicitly reports as 0 becomes { value: 0, status: 'REPORTED' }", () => {
    const rawZero = loadFixture("reported-zero.json");
    const entry: AllowlistEntry = {
      ...mockAllowlistEntry,
      fdcId: 9000000004,
      dataType: "SR Legacy",
      canonicalName: "Synthetic Pressed Plant Liquid",
      categoryId: "FAT_AND_OIL",
      foodState: "NOT_APPLICABLE",
    };

    const res = mapFdcRecordToCatalogItem({
      entry,
      record: rawZero,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const proteinFact = res.item.nutrientFacts?.find(
      (n) => n.nutrientId === "203" || n.nutrientName === "Protein"
    );
    expect(proteinFact).toBeDefined();
    expect(proteinFact?.status).toBe("REPORTED");
    expect(proteinFact?.value).toBe(0);
  });

  it("Derivation mapping table correctly maps analytical, calculated, and unknown codes", () => {
    // One Foundation analytical code -> ANALYTICAL
    const analytical = mapNutrientDerivation("Foundation", "A", "Analytical");
    expect(analytical.derivation).toBe("ANALYTICAL");

    // One calculated code -> CALCULATED
    const calculated = mapNutrientDerivation("Foundation", "NC", "Calculated");
    expect(calculated.derivation).toBe("CALCULATED");

    // Unknown code -> UNKNOWN with raw code in derivationDetail
    const unknown = mapNutrientDerivation("Foundation", "UNKNOWN_CODE_99", null);
    expect(unknown.derivation).toBe("UNKNOWN");
    expect(unknown.derivationDetail).toBe("UNKNOWN_CODE_99");
  });

  it("Atwater codes AS and AG are CALCULATED, not ANALYTICAL (review r1 B4)", () => {
    // "Analytical" means measured. AS/AG are Atwater *calculations*, and the
    // shipped artifact read derivation ANALYTICAL next to a derivationDetail
    // that said "Calculated using Atwater specific factors".
    for (const code of ["AS", "AG", "as", "ag"]) {
      const mapped = mapNutrientDerivation("Foundation", code, "Calculated using Atwater factors");
      expect(mapped.derivation).toBe("CALCULATED");
    }

    const rawFoundation = loadFixture("foundation-single-ingredient.json");
    const res = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const energyNutrientFact = res.item.nutrientFacts?.find(
      (n) => n.nutrientId === "1008" && n.unit === "KCAL"
    );
    expect(energyNutrientFact?.derivation).toBe("CALCULATED");
    expect(energyNutrientFact?.derivationDetail).toContain("Atwater");
    // The Atwater information is not lost — energyFact.method is its home.
    expect(res.item.energyFact?.method).toBe("ATWATER_SPECIFIC");

    // No item may claim a measured value next to a "Calculated" detail string.
    for (const fact of res.item.nutrientFacts ?? []) {
      if (fact.derivation === "ANALYTICAL") {
        expect(fact.derivationDetail?.toLowerCase() ?? "").not.toContain("calculated");
      }
    }
  });

  it("allergenFacts.contains is written in the legacy exclusion-token vocabulary (review r1 F1)", () => {
    // The nine catalog categories and the legacy tokens are two different
    // vocabularies. `contains` must carry the legacy one, because that is what
    // a client's declared allergy is projected into
    // (`deriveLegacyAllergyTokens`) and what `matchAllergen` compares against.
    // Writing "SOYBEAN" where a declaration says "SOY" fails OPEN on an allergen.
    expect(toLegacyAllergenTokens(["SOYBEAN"])).toEqual(["SOY"]);
    expect(toLegacyAllergenTokens(["CRUSTACEAN_SHELLFISH"])).toEqual(["SHELLFISH"]);
    expect(toLegacyAllergenTokens(["SESAME"])).toEqual(["SESAME"]);

    // Pin the exact string set, so a future divergence is a red test and not a
    // silent miss. Both directions are pinned: the nine categories, and the
    // token each one becomes.
    expect(allergenCategorySchema.options).toEqual([
      "MILK",
      "EGG",
      "FISH",
      "CRUSTACEAN_SHELLFISH",
      "TREE_NUT",
      "PEANUT",
      "WHEAT",
      "SOYBEAN",
      "SESAME",
    ]);
    expect(toLegacyAllergenTokens(allergenCategorySchema.options)).toEqual([
      "EGG",
      "FISH",
      "MILK",
      "PEANUT",
      "SESAME",
      "SHELLFISH",
      "SOY",
      "TREE_NUT",
      "WHEAT",
    ]);
    // One translation table, not two: the mapper imports the intake contract's.
    for (const category of allergenCategorySchema.options) {
      expect(toLegacyAllergenTokens([category])).toEqual([LEGACY_TOKEN_BY_CATEGORY[category]]);
    }

    // Every emitted token except SESAME is a legacy `allergenSchema` value.
    // SESAME has no legacy catalog token (a known, documented gap: a SESAME
    // declaration derives the same "SESAME" string, so the comparison still
    // matches and fails closed) and is emitted anyway, because dropping it
    // would make a sesame-containing food look sesame-free.
    const legacyValues = new Set<string>(allergenSchema.options);
    for (const token of toLegacyAllergenTokens(allergenCategorySchema.options)) {
      if (token === "SESAME") continue;
      expect(legacyValues.has(token)).toBe(true);
    }

    // End to end through the mapper: a record whose identity names an allergen
    // emits the legacy token, never the category name.
    const rawMilk = loadFixture("allergen-milk.json");
    const res = mapFdcRecordToCatalogItem({
      entry: {
        ...mockAllowlistEntry,
        fdcId: 9000000006,
        canonicalName: "Synthetic Dairy Item",
        categoryId: "DAIRY_AND_ALTERNATIVE",
        ownAllergenCategories: ["MILK", "SOYBEAN", "CRUSTACEAN_SHELLFISH"],
      },
      record: rawMilk,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.item.allergenFacts.contains).toEqual(["MILK", "SHELLFISH", "SOY"]);
    expect(res.item.allergenFacts.contains).not.toContain("SOYBEAN");
    expect(res.item.allergenFacts.contains).not.toContain("CRUSTACEAN_SHELLFISH");
  });

  it("isIngestableEntry / selectIngestableEntries skip STRUCK entries and only STRUCK entries", () => {
    // The predicate the CLI actually uses (`scripts/ai-coach-ingest-fdc.ts`),
    // tested directly rather than re-implemented in the test.
    const base = { ...mockAllowlistEntry };
    const proposed: AllowlistEntry = { ...base, fdcId: 9000000201, canonicalName: "A", reviewState: "PROPOSED" };
    const accepted: AllowlistEntry = { ...base, fdcId: 9000000202, canonicalName: "B", reviewState: "ACCEPTED" };
    const struck: AllowlistEntry = { ...base, fdcId: 9000000203, canonicalName: "C", reviewState: "STRUCK" };

    expect(isIngestableEntry(proposed)).toBe(true);
    expect(isIngestableEntry(accepted)).toBe(true);
    expect(isIngestableEntry(struck)).toBe(false);
    expect(selectIngestableEntries([proposed, accepted, struck])).toEqual([proposed, accepted]);
    expect(selectIngestableEntries([struck])).toEqual([]);
  });

  it("Energy method: Atwater-specific -> ATWATER_SPECIFIC; unreadable method -> SOURCE_REPORTED_UNSPECIFIED; missing energy -> rejected", () => {
    const rawFoundation = loadFixture("foundation-single-ingredient.json");
    const resSpecific = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(resSpecific.ok).toBe(true);
    if (resSpecific.ok) {
      expect(resSpecific.item.energyFact?.method).toBe("ATWATER_SPECIFIC");
    }

    const rawSr = loadFixture("sr-legacy-single-ingredient.json");
    const resUnspecified = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000002, dataType: "SR Legacy" },
      record: rawSr,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(resUnspecified.ok).toBe(true);
    if (resUnspecified.ok) {
      expect(resUnspecified.item.energyFact?.method).toBe("SOURCE_REPORTED_UNSPECIFIED");
    }

    const rawNoEnergy = loadFixture("no-energy-nutrient.json");
    const resNoEnergy = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000007 },
      record: rawNoEnergy,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(resNoEnergy.ok).toBe(false);
    if (!resNoEnergy.ok) {
      expect(resNoEnergy.errors.some((e) => e.code === "MISSING_ENERGY")).toBe(true);
    }
  });

  it("macroEnergyDiscrepancyKcal is computed and non-zero for a record where it is non-zero, and kcal is not adjusted", () => {
    const rawFoundation = loadFixture("foundation-single-ingredient.json");
    // Fixture 01: kcal = 100, protein = 5, fat = 2, carb = 10.
    // 4*5 + 4*10 + 9*2 = 20 + 40 + 18 = 78. Discrepancy: 100 - 78 = 22.
    const res = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.item.energyFact?.macroEnergyDiscrepancyKcal).toBe(22);
    expect(res.item.energyFact?.macroEnergyDiscrepancyKcal).not.toBe(0);
    expect(res.item.energyFact?.kcal).toBe(100); // unadjusted
    expect(res.item.nutrients.energyKcal).toBe(100);
  });

  it("An item whose protein/carb/fat is UNKNOWN is rejected rather than emitted with zero", () => {
    const rawNoProtein = {
      fdcId: 9000000102,
      description: "SYNTHETIC FIXTURE - record with no protein row",
      dataType: "Foundation",
      publicationDate: "10/28/2020",
      foodNutrients: [
        {
          nutrient: { id: 1008, number: "1008", name: "Energy", unitName: "KCAL" },
          amount: 100,
        },
        {
          nutrient: { id: 1004, number: "1004", name: "Total lipid (fat)", unitName: "G" },
          amount: 5,
        },
        {
          nutrient: { id: 1005, number: "1005", name: "Carbohydrate, by difference", unitName: "G" },
          amount: 10,
        },
      ],
    };

    const res = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000102 },
      record: rawNoProtein,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "MISSING_PROTEIN")).toBe(true);
    }
  });

  it("householdMeasures are carried through with provenance 'SOURCE_PORTION' and empty array if no portions", () => {
    const rawFoundation = loadFixture("foundation-single-ingredient.json");
    const resWithPortions = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(resWithPortions.ok).toBe(true);
    if (resWithPortions.ok) {
      expect(resWithPortions.item.amountBasis?.householdMeasures.length).toBeGreaterThan(0);
      expect(resWithPortions.item.amountBasis?.householdMeasures[0].provenance).toBe("SOURCE_PORTION");
    }

    const rawNoPortions = {
      ...(rawFoundation as Record<string, unknown>),
      foodPortions: [],
    };
    const resNoPortions = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawNoPortions,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(resNoPortions.ok).toBe(true);
    if (resNoPortions.ok) {
      expect(resNoPortions.item.amountBasis?.householdMeasures).toEqual([]);
    }
  });

  it("redactUrl removes api_key query param and leaves rest of URL intact, preventing SECRET-KEY-FIXTURE leakage", () => {
    const secretKey = "SECRET-KEY-FIXTURE";
    const sampleUrl = `https://api.nal.usda.gov/fdc/v1/food/9000000001?api_key=${secretKey}&format=full`;

    const redacted = redactUrl(sampleUrl);
    expect(redacted).not.toContain(secretKey);
    expect(redacted).toContain("https://api.nal.usda.gov/fdc/v1/food/9000000001");
    expect(redacted).toContain("format=full");

    // Assert secret key never leaks from any exported function
    const rawFoundation = loadFixture("foundation-single-ingredient.json");
    const res = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(res.ok).toBe(true);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(secretKey);
  });

  it("mapFdcRecordToCatalogItem performs no I/O (runs with fetch stubbed to throw)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("I/O is forbidden during mapping");
    });

    try {
      const rawFoundation = loadFixture("foundation-single-ingredient.json");
      const res = mapFdcRecordToCatalogItem({
        entry: mockAllowlistEntry,
        record: rawFoundation,
        retrievedAt: "2026-09-26T00:00:00.000Z",
        allowlistVersion: 1,
      });
      expect(res.ok).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("Key leakage guard: FDC_API_KEY is never referenced in lib/ or app/", () => {
    const scanDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && /\.(ts|tsx|js|json)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, "utf8");
          expect(content).not.toContain("FDC_API_KEY");
        }
      }
    };

    scanDir(path.resolve("lib"));
    scanDir(path.resolve("app"));
  });
});

