import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  mapFdcRecordToCatalogItem,
  mapNutrientDerivation,
  redactUrl,
  type MapFoodRecordInput,
} from "@/lib/ai-coach/catalog/fdc/mapping";
import type { AllowlistEntry } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import { foodCatalogContentSchema } from "@/lib/ai-coach/artifacts/schema";

const FIXTURES_DIR = path.resolve("tests/fixtures/ai-coach/fdc");

function loadFixture(filename: string): unknown {
  const filePath = path.join(FIXTURES_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const mockAllowlistEntry: AllowlistEntry = {
  fdcId: 171688,
  dataType: "Foundation",
  canonicalName: "Broccoli, Raw",
  synonyms: ["raw broccoli"],
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
      fdcId: 167746,
      dataType: "SR Legacy",
      canonicalName: "Chicken Breast, Roasted",
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
    expect(res.item.name).toBe("Chicken Breast, Roasted");
  });

  it("A Branded fixture is rejected with a named error and no item is produced", () => {
    const rawBranded = loadFixture("branded-disallowed.json");
    const entry: AllowlistEntry = {
      ...mockAllowlistEntry,
      fdcId: 177000,
      canonicalName: "Commercial Brand Snack Bar",
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
      fdcId: 173000,
      canonicalName: "Apples, Raw, with Skin",
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
      fdcId: 174000,
      dataType: "SR Legacy",
      canonicalName: "Olive Oil",
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
      entry: { ...mockAllowlistEntry, fdcId: 167746, dataType: "SR Legacy" },
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
      entry: { ...mockAllowlistEntry, fdcId: 176000 },
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
    // Broccoli raw: kcal = 34, p = 2.82, fat = 0.37, carb = 6.64.
    // 4*2.82 + 4*6.64 + 9*0.37 = 11.28 + 26.56 + 3.33 = 41.17.
    // Discrepancy: 34 - 41.17 = -7.17.
    const res = mapFdcRecordToCatalogItem({
      entry: mockAllowlistEntry,
      record: rawFoundation,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.item.energyFact?.macroEnergyDiscrepancyKcal).not.toBe(0);
    expect(res.item.energyFact?.kcal).toBe(34); // unadjusted
    expect(res.item.nutrients.energyKcal).toBe(34);
  });

  it("An item whose protein/carb/fat is UNKNOWN is rejected rather than emitted with zero", () => {
    const rawNoProtein = {
      fdcId: 178000,
      description: "No protein food",
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
      entry: { ...mockAllowlistEntry, fdcId: 178000 },
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
    const sampleUrl = `https://api.nal.usda.gov/fdc/v1/food/171688?api_key=${secretKey}&format=full`;

    const redacted = redactUrl(sampleUrl);
    expect(redacted).not.toContain(secretKey);
    expect(redacted).toContain("https://api.nal.usda.gov/fdc/v1/food/171688");
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

