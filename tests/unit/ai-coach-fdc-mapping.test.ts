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

    // End to end through the mapper: the PRESENT categories project to the
    // legacy tokens, never to the category names. The mapper no longer writes
    // that projection into the item (review r2 MB-4, asserted below); the
    // translation is still the one T-2036 must use.
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
    const presentCategories = res.item.allergenFactsV2!.categories
      .filter((c) => c.presence === "PRESENT")
      .map((c) => c.category);
    expect(toLegacyAllergenTokens(presentCategories)).toEqual(["MILK", "SHELLFISH", "SOY"]);
    expect(toLegacyAllergenTokens(presentCategories)).not.toContain("SOYBEAN");
    expect(toLegacyAllergenTokens(presentCategories)).not.toContain("CRUSTACEAN_SHELLFISH");
  });

  /**
   * Review r2 MB-4. The legacy `allergenFacts` struct has two states and a
   * `verificationStatus` pinned to the literal "REVIEWED_SOURCE". The real run
   * produced 1643 UNKNOWN facts against 130 PRESENT; projecting that into
   * `contains` stamped every one of the 197 items "reviewed against the source
   * and containing only these", so `Nuts, almonds` shipped as reviewed and
   * containing nothing. It fails OPEN, and it is the field every pre-existing
   * consumer speaks.
   *
   * Of the review's two fixes, this is the one a consumer that has not been
   * updated cannot misread: the field is gone, so `item.allergenFacts.contains`
   * is a TypeScript error and a runtime TypeError, not an empty array that
   * reads as "no allergens". An `unknownCategories` array beside `contains`
   * would still have left `contains: []` for such a consumer to believe.
   */
  it("A SOURCED_V2 item carries no legacy allergenFacts, and the schema refuses one that does", () => {
    const res = mapFdcRecordToCatalogItem({
      entry: {
        ...mockAllowlistEntry,
        fdcId: 9000000006,
        canonicalName: "Synthetic Dairy Item",
        ownAllergenCategories: ["MILK"],
      },
      record: loadFixture("allergen-milk.json"),
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.item.allergenFacts).toBeUndefined();
    expect(Object.keys(res.item)).not.toContain("allergenFacts");
    // The tri-state survives in full: nothing was lost to the legacy struct.
    expect(res.item.allergenFactsV2?.categories).toHaveLength(9);
    expect(
      res.item.allergenFactsV2?.categories.filter((c) => c.presence === "UNKNOWN").length
    ).toBeGreaterThan(0);

    const container = {
      artifactKey: "food-catalog",
      version: 1,
      catalogProfile: "SOURCED_V2" as const,
      market: "US" as const,
      items: [res.item],
    };
    expect(() => foodCatalogContentSchema.parse(container)).not.toThrow();

    // Re-adding it is a schema failure, not a silent regression. This is the
    // guard that stops the false-negative surface coming back.
    expect(() =>
      foodCatalogContentSchema.parse({
        ...container,
        items: [
          {
            ...res.item,
            allergenFacts: {
              contains: [],
              evidenceSourceId: "USDA-FDC",
              verificationStatus: "REVIEWED_SOURCE",
              crossContactRequiresCurrentVerification: true,
            },
          },
        ],
      })
    ).toThrowError(/allergenFacts is forbidden under SOURCED_V2/);
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


  /**
   * Review r2 MB-1. The lookup read only `1008`/`208` for energy and
   * `1004`/`204` for fat, so it refused 48 modern Foundation records that carry
   * every macronutrient it needs — plain chicken breast, Pacific cod, olive
   * oil, bell peppers, walnuts, peanut butter — and the catalog shipped with no
   * plain chicken breast in it while keeping `TACO BELL, Nachos`. Modern
   * Foundation records report energy under the Atwater ids `2047`/`2048` and
   * fat under `1085` "Total fat (NLEA)". Live check of one struck record,
   * `2258588 "Peppers, bell, green, raw"`: no `1008` row, `2047` and `2048`
   * both present, `1003`/`1004`/`1005` all present
   * (board/evidence/T-2035-real-run.md).
   *
   * The values below are invented and the record is labelled SYNTHETIC; what is
   * borrowed from the source is the nutrient *numbering*, which is structure.
   */
  const modernFoundationRecord = (
    nutrients: Array<{ number: string; name: string; unitName: string; amount: number }>
  ) => ({
    _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
    fdcId: 9000000401,
    description: "SYNTHETIC FIXTURE - modern Foundation nutrient vocabulary",
    dataType: "Foundation",
    publicationDate: "01/01/1902",
    foodCategory: { description: "SYNTHETIC CATEGORY - plant item" },
    foodNutrients: nutrients.map((n, index) => ({
      type: "FoodNutrient",
      id: 20002000 + index,
      nutrient: { id: Number(n.number), number: n.number, name: n.name, unitName: n.unitName },
      amount: n.amount,
    })),
    foodPortions: [],
  });

  const ATWATER_GENERAL_ROW = {
    number: "2047",
    name: "Energy (Atwater General Factors)",
    unitName: "KCAL",
    amount: 30,
  };
  const ATWATER_SPECIFIC_ROW = {
    number: "2048",
    name: "Energy (Atwater Specific Factors)",
    unitName: "KCAL",
    amount: 25,
  };
  const NLEA_FAT_ROW = { number: "1085", name: "Total fat (NLEA)", unitName: "G", amount: 0.5 };
  const PROTEIN_ROW = { number: "1003", name: "Protein", unitName: "G", amount: 1 };
  const CARB_ROW = {
    number: "1005",
    name: "Carbohydrate, by difference",
    unitName: "G",
    amount: 4,
  };

  it("A modern Foundation record with Atwater energy and NLEA fat maps instead of being refused", () => {
    const record = modernFoundationRecord([
      ATWATER_GENERAL_ROW,
      ATWATER_SPECIFIC_ROW,
      PROTEIN_ROW,
      NLEA_FAT_ROW,
      CARB_ROW,
    ]);

    const res = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000401, canonicalName: "Synthetic Modern Item" },
      record,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Energy is taken from a row the record actually carries, never derived:
    // 2048 wins over 2047 deterministically, and the choice is recorded.
    expect(res.item.nutrients.energyKcal).toBe(25);
    expect(res.item.energyFact?.kcal).toBe(25);
    expect(res.item.energyFact?.method).toBe("ATWATER_SPECIFIC");
    expect(res.item.energyFact?.methodDetail).toBe("Energy (Atwater Specific Factors)");

    // Fat comes from Total fat (NLEA).
    expect(res.item.nutrients.fatGrams).toBe(0.5);
    expect(res.item.nutrients.proteinGrams).toBe(1);
    expect(res.item.nutrients.carbohydrateGrams).toBe(4);

    // The legacy ids are genuinely not reported, but the quantity is, so they
    // must not be listed as missing.
    expect(res.item.nutrients.missingNutrientIds).not.toContain("1008");
    expect(res.item.nutrients.missingNutrientIds).not.toContain("1004");

    // And the SOURCED_V2 refinement accepts it: the schema's id sets and the
    // mapper's are the same exported lists.
    expect(() =>
      foodCatalogContentSchema.parse({
        artifactKey: "food-catalog",
        version: 1,
        catalogProfile: "SOURCED_V2" as const,
        market: "US" as const,
        items: [res.item],
      })
    ).not.toThrow();
  });

  it("Atwater general alone yields ATWATER_GENERAL; a reported 1008 still wins over both", () => {
    const generalOnly = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000401, canonicalName: "Synthetic Modern Item" },
      record: modernFoundationRecord([ATWATER_GENERAL_ROW, PROTEIN_ROW, NLEA_FAT_ROW, CARB_ROW]),
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(generalOnly.ok).toBe(true);
    if (generalOnly.ok) {
      expect(generalOnly.item.nutrients.energyKcal).toBe(30);
      expect(generalOnly.item.energyFact?.method).toBe("ATWATER_GENERAL");
    }

    const withLegacyEnergy = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000401, canonicalName: "Synthetic Modern Item" },
      record: modernFoundationRecord([
        { number: "1008", name: "Energy", unitName: "KCAL", amount: 28 },
        ATWATER_GENERAL_ROW,
        ATWATER_SPECIFIC_ROW,
        PROTEIN_ROW,
        NLEA_FAT_ROW,
        CARB_ROW,
      ]),
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(withLegacyEnergy.ok).toBe(true);
    if (withLegacyEnergy.ok) {
      expect(withLegacyEnergy.item.nutrients.energyKcal).toBe(28);
      // No derivation on the row and no Atwater id used, so the method is not
      // guessed from the other rows present.
      expect(withLegacyEnergy.item.energyFact?.method).toBe("SOURCE_REPORTED_UNSPECIFIED");
    }
  });

  it("A record that genuinely reports no energy under ANY accepted id is still refused", () => {
    // Widening the lookup must not become deriving the number. `1079` is fiber:
    // a kcal quantity is nowhere in this record under 1008, 208, 2047 or 2048.
    const res = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000402, canonicalName: "Synthetic No Energy" },
      record: modernFoundationRecord([
        PROTEIN_ROW,
        NLEA_FAT_ROW,
        CARB_ROW,
        { number: "1079", name: "Fiber, total dietary", unitName: "G", amount: 2 },
      ]),
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "MISSING_ENERGY")).toBe(true);
    }

    // Same for fat, with no 1004, 204 or 1085 row.
    const noFat = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000403, canonicalName: "Synthetic No Fat" },
      record: modernFoundationRecord([ATWATER_SPECIFIC_ROW, PROTEIN_ROW, CARB_ROW]),
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(noFat.ok).toBe(false);
    if (!noFat.ok) {
      expect(noFat.errors.some((e) => e.code === "MISSING_FAT")).toBe(true);
    }
  });

  it("A null-amount Atwater row is 'not reported', not zero", () => {
    const record = modernFoundationRecord([PROTEIN_ROW, NLEA_FAT_ROW, CARB_ROW]) as Record<
      string,
      unknown
    >;
    (record.foodNutrients as unknown[]).push({
      type: "FoodNutrient",
      id: 20002099,
      nutrient: { id: 2048, number: "2048", name: "Energy (Atwater Specific Factors)", unitName: "KCAL" },
      amount: null,
    });

    const res = mapFdcRecordToCatalogItem({
      entry: { ...mockAllowlistEntry, fdcId: 9000000404, canonicalName: "Synthetic Null Energy" },
      record,
      retrievedAt: "2026-09-26T00:00:00.000Z",
      allowlistVersion: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "MISSING_ENERGY")).toBe(true);
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

