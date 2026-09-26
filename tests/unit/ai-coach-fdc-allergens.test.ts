import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  proposeAllergenFacts,
  allergenTermVariants,
  matchesAnyTerm,
  textNamesAllergenCategory,
  ALLERGEN_TERM_INDEX,
  INGESTION_ALLERGEN_RULE_ID,
} from "@/lib/ai-coach/catalog/fdc/allergen-rules";
import { loadDraftUnsignedFoodCatalog } from "@/lib/ai-coach/artifacts/drafts/loader";
import { normalizeFdcRecord } from "@/lib/ai-coach/catalog/fdc/normalize";
import type { AllowlistEntry } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import { allergenCategorySchema, type AllergenCategory } from "@/lib/ai-coach/artifacts/schema";

/**
 * Fixtures are SYNTHETIC and say so in their own `_synthetic` block. They are
 * hand-built to exercise code paths, not recorded USDA responses: no
 * attribution, no retrieval date, no licence, ids far outside any FoodData
 * Central range. Genuinely recorded responses, when a real run produces them,
 * land in a separate directory and the provenance tests bind to those.
 */
const FIXTURES_DIR = path.resolve("tests/fixtures/ai-coach/fdc-synthetic");

const ALL_FOOD_FIXTURES = [
  "foundation-single-ingredient.json",
  "sr-legacy-single-ingredient.json",
  "missing-nutrient.json",
  "reported-zero.json",
  "multi-ingredient.json",
  "allergen-milk.json",
  "no-energy-nutrient.json",
  "baked-bread-multi-ingredient.json",
];

function loadFixture(filename: string): unknown {
  const filePath = path.join(FIXTURES_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const FROZEN_T2002_ALLERGEN_CATEGORIES = [
  "MILK",
  "EGG",
  "FISH",
  "CRUSTACEAN_SHELLFISH",
  "TREE_NUT",
  "PEANUT",
  "WHEAT",
  "SOYBEAN",
  "SESAME",
] as const;

function entryFor(
  norm: { fdcId: number; dataType: string; description: string },
  overrides: Partial<AllowlistEntry> = {}
): AllowlistEntry {
  return {
    fdcId: norm.fdcId,
    dataType: norm.dataType === "SR Legacy" ? "SR Legacy" : "Foundation",
    canonicalName: norm.description,
    synonyms: [],
    sourceFoodCategory: null,
    categoryId: "VEGETABLE",
    categoryIdBasis: "COVERAGE_PLAN_SEARCH_TERM",
    foodState: "RAW",
    patternTags: ["OMNIVORE"],
    patternTagsBasis: "FALLBACK_OMNIVORE_ONLY",
    patternTagsNarrowedBy: [],
    triageFlags: [],
    ownAllergenCategories: [],
    reviewState: "PROPOSED",
    reviewerNote: null,
    ...overrides,
  };
}

describe("T-2035 — FDC allergen tri-state rules (fail closed)", () => {
  it("The nine category values equal T-2002's frozen enum exactly", () => {
    expect(allergenCategorySchema.options).toEqual(FROZEN_T2002_ALLERGEN_CATEGORIES);
    expect(Object.keys(ALLERGEN_TERM_INDEX).sort()).toEqual(
      [...FROZEN_T2002_ALLERGEN_CATEGORIES].sort()
    );
  });

  it("All nine categories are always present in allergenFactsV2.categories for every fixture (length === 9)", () => {
    for (const file of ALL_FOOD_FIXTURES) {
      const norm = normalizeFdcRecord(loadFixture(file));
      const facts = proposeAllergenFacts(entryFor(norm), norm, "2026-09-26T00:00:00.000Z");
      expect(facts.categories.length).toBe(9);
      expect(facts.categories.map((c) => c.category)).toEqual(FROZEN_T2002_ALLERGEN_CATEGORIES);
    }
  });

  it("The milk record yields MILK: PRESENT with basis 'SOURCE_RECORD_IDENTITY'", () => {
    const norm = normalizeFdcRecord(loadFixture("allergen-milk.json"));
    const facts = proposeAllergenFacts(
      entryFor(norm, {
        canonicalName: "Synthetic Milk Fixture",
        categoryId: "DAIRY_AND_ALTERNATIVE",
        ownAllergenCategories: ["MILK"],
      }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );
    const milkFact = facts.categories.find((c) => c.category === "MILK");
    expect(milkFact?.presence).toBe("PRESENT");
    expect(milkFact?.basis).toBe("SOURCE_RECORD_IDENTITY");
    expect(milkFact?.ruleId).toBe(INGESTION_ALLERGEN_RULE_ID);
    expect(milkFact?.verifiedAt).toBe("2026-09-26T00:00:00.000Z");
  });

  /**
   * The rule, in one sentence: VERIFIED_ABSENT requires positive evidence in
   * the source record that the allergen is absent, and no Foundation or SR
   * Legacy record carries any — they have no `ingredients` field, no "contains"
   * declaration and no allergen field — so everything that is not PRESENT is
   * UNKNOWN. Before this rewrite the shipped artifact asserted 2,119
   * VERIFIED_ABSENT facts out of 2,340 (board/evidence/T-2035.md).
   */
  it("No fixture yields VERIFIED_ABSENT for any category, under any curation fields", () => {
    for (const file of ALL_FOOD_FIXTURES) {
      const norm = normalizeFdcRecord(loadFixture(file));
      const facts = proposeAllergenFacts(entryFor(norm), norm, "2026-09-26T00:00:00.000Z");
      for (const fact of facts.categories) {
        expect(fact.presence).not.toBe("VERIFIED_ABSENT");
        expect(["PRESENT", "UNKNOWN"]).toContain(fact.presence);
      }
    }
  });

  /**
   * T-2016 replaces the old "the deleted single-ingredient flag no longer
   * changes a single fact" case with its generalised form, because that field is
   * now gone from the schema entirely. The only entry fields the allergen rule
   * may read are the ones that name the food (`canonicalName`, `synonyms`) and
   * the curator's explicit declaration (`ownAllergenCategories`). The curation
   * values T-2016 derives from the USDA food category — `sourceFoodCategory`,
   * `categoryId`, `patternTags`, the triage flags — must change no allergen
   * fact, which is what keeps the food category out of the allergen rule
   * (review r2 MB-2) now that another module reads it.
   */
  it("no curation field on the entry changes a single allergen fact", () => {
    const variants: Array<Partial<AllowlistEntry>> = [
      { sourceFoodCategory: "Finfish and Shellfish Products" },
      { sourceFoodCategory: "Dairy and Egg Products" },
      { sourceFoodCategory: "Cereal Grains and Pasta" },
      { categoryId: "SEAFOOD", categoryIdBasis: "SOURCE_FOOD_CATEGORY" },
      { patternTags: ["VEGAN"], patternTagsBasis: "REVIEWER_SET" },
      { foodState: "PREPARED" },
      { triageFlags: ["DESCRIPTION_CARRIES_AN_ALL_CAPS_BRAND_TOKEN"] },
    ];

    for (const file of ALL_FOOD_FIXTURES) {
      const norm = normalizeFdcRecord(loadFixture(file));
      const baseline = proposeAllergenFacts(entryFor(norm), norm, "2026-09-26T00:00:00.000Z");
      for (const overrides of variants) {
        expect(
          proposeAllergenFacts(entryFor(norm, overrides), norm, "2026-09-26T00:00:00.000Z"),
          `${file} with ${JSON.stringify(overrides)}`
        ).toEqual(baseline);
      }
    }
  });

  it("A single-item Foundation record with an empty inputFoods array yields UNKNOWN for all nine", () => {
    const norm = normalizeFdcRecord(loadFixture("foundation-single-ingredient.json"));
    expect(norm.hasInputFoods).toBe(false);
    const facts = proposeAllergenFacts(
      entryFor(norm, { canonicalName: "Synthetic Plant Item", synonyms: ["synthetic plant"] }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );

    // Exact expected tri-state for all nine, so a later rule change breaks this test.
    const expected: Record<AllergenCategory, "PRESENT" | "UNKNOWN"> = {
      MILK: "UNKNOWN",
      EGG: "UNKNOWN",
      FISH: "UNKNOWN",
      CRUSTACEAN_SHELLFISH: "UNKNOWN",
      TREE_NUT: "UNKNOWN",
      PEANUT: "UNKNOWN",
      WHEAT: "UNKNOWN",
      SOYBEAN: "UNKNOWN",
      SESAME: "UNKNOWN",
    };
    for (const fact of facts.categories) {
      expect(fact.presence).toBe(expected[fact.category]);
      expect(fact.basis).toBe("NONE");
      expect(fact.verifiedAt).toBeNull();
      expect(fact.crossContact).toBe("UNKNOWN");
    }
  });

  it("The multi-ingredient record yields UNKNOWN for all nine with basis 'NONE'", () => {
    const norm = normalizeFdcRecord(loadFixture("multi-ingredient.json"));
    expect(norm.hasInputFoods).toBe(true);
    const facts = proposeAllergenFacts(
      entryFor(norm, { canonicalName: "Synthetic Mixed Item" }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );
    for (const fact of facts.categories) {
      expect(fact.presence).toBe("UNKNOWN");
      expect(fact.basis).toBe("NONE");
      expect(fact.verifiedAt).toBeNull();
    }
  });

  it("A spice-category record yields UNKNOWN for MILK, SESAME and TREE_NUT", () => {
    // Previously MILK read VERIFIED_ABSENT here because "spices and herbs" sat
    // in the single-ingredient category set. A spice record states nothing
    // about milk.
    const rawSpice = {
      _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
      fdcId: 9000000101,
      description: "SYNTHETIC FIXTURE - ground seasoning item",
      dataType: "Foundation",
      publicationDate: "01/01/1900",
      foodCategory: { description: "SYNTHETIC CATEGORY - seasoning item" },
      foodNutrients: [],
    };
    const norm = normalizeFdcRecord(rawSpice);
    const facts = proposeAllergenFacts(
      entryFor(norm, {
        canonicalName: "Synthetic Seasoning",
        categoryId: "CONDIMENT_AND_SEASONING",
        foodState: "NOT_APPLICABLE",
      }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );

    for (const category of ["MILK", "SESAME", "TREE_NUT"] as const) {
      const fact = facts.categories.find((c) => c.category === category);
      expect(fact?.presence).toBe("UNKNOWN");
      expect(fact?.basis).toBe("NONE");
    }
  });

  it("A commercially prepared bread record yields UNKNOWN for SOYBEAN, MILK and SESAME, never VERIFIED_ABSENT", () => {
    // The concrete harm this rule exists to prevent. A real Branded whole wheat
    // bread's ingredient statement contains "SOYBEAN AND/OR CANOLA OIL"
    // (FoodData Central structure probed by the lead, 2026-09-26). The
    // Foundation/SR Legacy record for the same class of food has no
    // `ingredients` field at all, so it cannot establish that soy, milk, egg or
    // sesame is absent — and the deleted catalog asserted exactly that for
    // sourdough, rye and pita.
    const norm = normalizeFdcRecord(loadFixture("baked-bread-multi-ingredient.json"));
    expect(norm.ingredientStatement).toBeNull();

    const facts = proposeAllergenFacts(
      entryFor(norm, {
        dataType: "SR Legacy",
        canonicalName: "Synthetic Whole-Wheat Commercial Bread",
        categoryId: "GRAIN_STARCH",
        foodState: "PREPARED",
      }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );

    const presenceOf = (category: AllergenCategory) =>
      facts.categories.find((c) => c.category === category)?.presence;

    expect(presenceOf("SOYBEAN")).toBe("UNKNOWN");
    expect(presenceOf("MILK")).toBe("UNKNOWN");
    expect(presenceOf("SESAME")).toBe("UNKNOWN");
    expect(presenceOf("EGG")).toBe("UNKNOWN");
    // The record's own identity says wheat, which is the one claim it supports.
    expect(presenceOf("WHEAT")).toBe("PRESENT");
    expect(facts.ingredientStatementAvailable).toBe(false);

    // The name said "bread" before this rework and that alone used to be enough.
    // `bread` is a food form — rye, corn and gluten-free breads exist — so it is
    // no longer a WHEAT term, and an unqualified bread record is UNKNOWN. That
    // still excludes a wheat-allergic client; it just stops the catalog
    // asserting something the record did not say.
    const unqualified = proposeAllergenFacts(
      entryFor(norm, {
        dataType: "SR Legacy",
        canonicalName: "Synthetic Commercial Bread",
        categoryId: "GRAIN_STARCH",
        foodState: "PREPARED",
      }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );
    expect(unqualified.categories.find((c) => c.category === "WHEAT")?.presence).toBe("UNKNOWN");
  });

  it("ingredientStatementAvailable is read off the record, not assumed", () => {
    for (const file of ALL_FOOD_FIXTURES) {
      const norm = normalizeFdcRecord(loadFixture(file));
      const facts = proposeAllergenFacts(entryFor(norm), norm, "2026-09-26T00:00:00.000Z");
      // No Foundation or SR Legacy record carries an ingredient statement.
      expect(facts.ingredientStatementAvailable).toBe(false);
    }

    // Branded is the only data type that does — and v1 never ingests one.
    const branded = normalizeFdcRecord(loadFixture("branded-disallowed.json"));
    expect(branded.ingredientStatement).not.toBeNull();
    const brandedFacts = proposeAllergenFacts(
      entryFor({ fdcId: branded.fdcId, dataType: "Foundation", description: branded.description }),
      branded,
      "2026-09-26T00:00:00.000Z"
    );
    expect(brandedFacts.ingredientStatementAvailable).toBe(true);
    // Having a statement is still not a parsed declaration: v1 does not read it,
    // so absence is still never asserted.
    for (const fact of brandedFacts.categories) {
      expect(fact.presence).not.toBe("VERIFIED_ABSENT");
    }
  });


  /**
   * Review r2 MB-3. `ALLERGEN_TERM_INDEX.TREE_NUT` held only singulars and the
   * boundary demanded a non-alphanumeric character immediately after the term,
   * so `almond` did not match `Nuts, almonds`. The real run shipped
   * `Nuts, almonds`, `Nuts, walnuts, english`, `Nuts, walnuts, black, dried`,
   * `Nuts, walnuts, glazed` and `Candies, nougat, with almonds` with
   * `TREE_NUT` PRESENT nowhere: a bag of almonds declaring no tree nut, in the
   * catalog whose whole purpose is to declare them. (`cashew` and `pistachio`
   * matched only because USDA happens to write "cashew nuts".)
   */
  it("Plural and possessive forms of a term match: Nuts, almonds -> TREE_NUT PRESENT", () => {
    const cases: Array<[string, AllergenCategory]> = [
      ["Nuts, almonds", "TREE_NUT"],
      ["Nuts, walnuts, english", "TREE_NUT"],
      ["Nuts, walnuts, black, dried", "TREE_NUT"],
      ["Nuts, walnuts, glazed", "TREE_NUT"],
      ["Candies, nougat, with almonds", "TREE_NUT"],
      ["Crustaceans, shrimp, raw", "CRUSTACEAN_SHELLFISH"],
      ["Eggs, Grade A, Large, egg white", "EGG"],
      ["Frozen yogurts, chocolate", "MILK"],
      ["Fish, anchovies, canned", "FISH"],
      // Possessive: the boundary class admits both apostrophes, so no variant
      // is needed for it. Pinned so a later boundary change cannot drop it.
      ["The almond's kernel", "TREE_NUT"],
      ["Two almonds' weight", "TREE_NUT"],
      ["The almond\u2019s kernel", "TREE_NUT"],
    ];

    for (const [text, category] of cases) {
      expect(
        textNamesAllergenCategory(text, category),
        `${text} should name ${category}`
      ).toBe(true);
    }

    // Through the rule itself, not just the matcher.
    const rawNuts = {
      _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
      fdcId: 9000000301,
      description: "SYNTHETIC FIXTURE - shelled nut record",
      dataType: "SR Legacy",
      publicationDate: "01/01/1900",
      foodCategory: { description: "SYNTHETIC CATEGORY - nut and seed item" },
      foodNutrients: [],
    };
    const norm = normalizeFdcRecord(rawNuts);
    const facts = proposeAllergenFacts(
      entryFor(norm, { canonicalName: "Nuts, almonds" }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );
    const treeNut = facts.categories.find((c) => c.category === "TREE_NUT");
    expect(treeNut?.presence).toBe("PRESENT");
    expect(treeNut?.basis).toBe("SOURCE_RECORD_IDENTITY");
  });

  it("A word boundary is still required: a term inside a longer word does not match", () => {
    // The plural fix must not become a substring match.
    expect(textNamesAllergenCategory("Peanuts, dry roasted", "TREE_NUT")).toBe(false);
    expect(textNamesAllergenCategory("Rice, white, glutinous", "WHEAT")).toBe(false);
    expect(matchesAnyTerm("almondine", ["almond"])).toBe(false);
    expect(matchesAnyTerm("codependent", ["cod"])).toBe(false);
  });

  /**
   * The audit the review asked for, as an invariant rather than as three words:
   * every term in every one of the nine lists must match its own plural, so a
   * term added later cannot reintroduce MB-3 in a category nobody re-checked.
   */
  it("Every term in all nine lists matches its own generated plural", () => {
    for (const category of allergenCategorySchema.options) {
      for (const term of ALLERGEN_TERM_INDEX[category]) {
        const variants = allergenTermVariants(term);
        expect(variants.length, `${category}/${term} produced no plural`).toBeGreaterThan(1);
        for (const variant of variants) {
          expect(
            matchesAnyTerm(`Foods, ${variant}, raw`, ALLERGEN_TERM_INDEX[category]),
            `${category}: '${variant}' (from '${term}') does not match its own list`
          ).toBe(true);
        }
      }
    }

    // The generated forms, pinned on the shapes that actually occur.
    expect(allergenTermVariants("almond")).toEqual(["almond", "almonds"]);
    expect(allergenTermVariants("anchovy")).toEqual(["anchovy", "anchovies"]);
    expect(allergenTermVariants("bass")).toEqual(["bass", "basses"]);
    expect(allergenTermVariants("shellfish")).toEqual(["shellfish", "shellfishes"]);
    expect(allergenTermVariants("soy")).toEqual(["soy", "soys"]);
    expect(allergenTermVariants("tree nut")).toEqual(["tree nut", "tree nuts"]);
  });

  /**
   * Review r2 MB-2. The scan used to fold `record.foodCategory` into the
   * matched text. Measured over the real run, 42 of 130 PRESENT facts came
   * only from the category string: all 14 finfish read
   * `CRUSTACEAN_SHELLFISH: PRESENT` because USDA files them under "Finfish and
   * Shellfish Products", quinoa and white rice read `WHEAT: PRESENT` under
   * "Cereal Grains and Pasta", cheddar read `EGG` and egg white read `MILK`
   * under "Dairy and Egg Products". None of those is true.
   */
  it("The food category is not scanned: cod is FISH PRESENT and CRUSTACEAN_SHELLFISH UNKNOWN", () => {
    const rawCod = {
      _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
      fdcId: 9000000302,
      description: "SYNTHETIC FIXTURE - finfish record",
      dataType: "SR Legacy",
      publicationDate: "01/01/1900",
      // The real USDA category string, because it is the input under test.
      foodCategory: { description: "Finfish and Shellfish Products" },
      foodNutrients: [],
    };
    const norm = normalizeFdcRecord(rawCod);
    expect(norm.foodCategory).toBe("Finfish and Shellfish Products");

    const facts = proposeAllergenFacts(
      entryFor(norm, { canonicalName: "Fish, cod, Atlantic, raw", categoryId: "SEAFOOD" }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );
    const presenceOf = (category: AllergenCategory) =>
      facts.categories.find((c) => c.category === category)?.presence;

    // The food's own name says finfish, and only that.
    expect(presenceOf("FISH")).toBe("PRESENT");
    expect(presenceOf("CRUSTACEAN_SHELLFISH")).toBe("UNKNOWN");
    expect(
      facts.categories.find((c) => c.category === "CRUSTACEAN_SHELLFISH")?.basis
    ).toBe("NONE");
  });

  it("A category naming an allergen the food's own name does not changes no fact at all", () => {
    const base = {
      _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
      fdcId: 9000000303,
      description: "SYNTHETIC FIXTURE - grain record",
      dataType: "SR Legacy",
      publicationDate: "01/01/1900",
      foodNutrients: [],
    };
    const neutral = normalizeFdcRecord({
      ...base,
      foodCategory: { description: "SYNTHETIC CATEGORY - plain" },
    });
    const loaded = normalizeFdcRecord({
      ...base,
      foodCategory: { description: "Cereal Grains and Pasta" },
    });

    const entry = { canonicalName: "Quinoa, uncooked", categoryId: "GRAINS_STARCHES" };
    const neutralFacts = proposeAllergenFacts(
      entryFor(neutral, entry),
      neutral,
      "2026-09-26T00:00:00.000Z"
    );
    const loadedFacts = proposeAllergenFacts(
      entryFor(loaded, entry),
      loaded,
      "2026-09-26T00:00:00.000Z"
    );

    expect(loadedFacts.categories).toEqual(neutralFacts.categories);
    expect(loadedFacts.categories.find((c) => c.category === "WHEAT")?.presence).toBe("UNKNOWN");
  });

  /**
   * The invariant that turns MB-3 from three named foods into a property of the
   * shipped artifact, **forward direction**: if an item's own name names an
   * allergen, the stored fact says PRESENT. The rule scans
   * `canonicalName + description + synonyms` and `item.name` *is*
   * `canonicalName`, so any violation means the committed catalog was produced
   * by a different rule than the one in the tree.
   *
   * It is red on purpose until the ingest is re-run after this change: the
   * committed artifact was produced by the singular-only matcher.
   */
  it("Committed catalog: every item whose name names an allergen has that category PRESENT", () => {
    const file = loadDraftUnsignedFoodCatalog();
    const violations: string[] = [];

    for (const item of file.content.items) {
      for (const category of allergenCategorySchema.options) {
        if (!textNamesAllergenCategory(item.name, category)) continue;
        const fact = item.allergenFactsV2?.categories.find((c) => c.category === category);
        if (fact?.presence !== "PRESENT") {
          violations.push(`${item.name} -> ${category} = ${fact?.presence ?? "(no fact)"}`);
        }
      }
    }

    expect(
      violations,
      `Items whose own name names an allergen the stored fact does not declare PRESENT:\n${violations.join(
        "\n"
      )}`
    ).toEqual([]);
  });


  /**
   * The same invariant, **reverse direction**: no stored PRESENT fact may come
   * from a term the list no longer contains, or from a signal the rule no
   * longer reads. Without this, dropping `flour`/`bread`/`pasta`/`butter` and
   * the `foodCategory` scan would leave the false facts they produced sitting
   * in the artifact with nothing asserting they are gone.
   *
   * The rule's inputs are `canonicalName + description + synonyms` plus
   * `ownAllergenCategories`. The artifact stores the name and the synonyms but
   * not the USDA `description`, so this check reconstructs the first and third
   * and joins the allowlist for the fourth. In the committed data
   * `--propose` sets `canonicalName` from the description and every
   * `ownAllergenCategories` is empty, so a violation here is a real divergence
   * worth reading, not a reconstruction artefact.
   *
   * Red until the re-run, for the same reason as the forward direction.
   */
  it("Committed catalog: no item has a PRESENT fact that the current rule cannot explain", () => {
    const file = loadDraftUnsignedFoodCatalog();
    const allowlist = JSON.parse(
      fs.readFileSync(path.resolve("data/ai-coach/catalog/fdc-allowlist.v1.json"), "utf8")
    ) as { entries: Array<{ fdcId: number; ownAllergenCategories: AllergenCategory[] }> };
    const ownByRecordId = new Map(
      allowlist.entries.map((entry) => [String(entry.fdcId), entry.ownAllergenCategories])
    );

    const unexplained: string[] = [];
    for (const item of file.content.items) {
      const scanned = [item.name, ...(item.synonyms ?? [])].join(" ");
      const own = ownByRecordId.get(item.sourceRecord?.recordId ?? "") ?? [];
      for (const fact of item.allergenFactsV2?.categories ?? []) {
        if (fact.presence !== "PRESENT") continue;
        if (textNamesAllergenCategory(scanned, fact.category)) continue;
        if (own.includes(fact.category)) continue;
        unexplained.push(`${item.name} -> ${fact.category}`);
      }
    }

    expect(
      unexplained,
      `PRESENT facts the current rule cannot produce (a removed term or the food category):\n${unexplained.join(
        "\n"
      )}`
    ).toEqual([]);
  });

  /**
   * The two the lead named as the ones not to put in front of the RD. Pinned by
   * name rather than left to the invariants, so they cannot be lost in a
   * re-measure. Both read `WHEAT: PRESENT` in the first real run — one from
   * `flour` and `pasta`, one from `flour` — and one of them is labelled
   * gluten-free on its own package.
   */
  it("Gluten-free pasta and chickpea flour do not read WHEAT", () => {
    for (const name of [
      "Pasta, gluten-free, corn flour and quinoa flour, cooked, ANCIENT HARVEST",
      "Chickpea flour (besan)",
      "Flour, rice, brown",
      "Rice flour, white, unenriched",
      "Oat bran, cooked",
    ]) {
      expect(textNamesAllergenCategory(name, "WHEAT"), `${name} must not name WHEAT`).toBe(false);
    }

    // And the coverage that must survive: whole-wheat bread still reads WHEAT
    // through `wheat`, with `bread` gone from the list.
    for (const name of [
      "Bread, whole-wheat, commercially prepared",
      "Bread, whole-wheat, commercially prepared, toasted",
      "Bread, pita, whole-wheat",
      "Bread, french or vienna, whole wheat",
    ]) {
      expect(textNamesAllergenCategory(name, "WHEAT"), `${name} must still name WHEAT`).toBe(true);
    }

    // Nut and fruit butters are not dairy.
    expect(textNamesAllergenCategory("Nuts, cashew butter, plain, with salt added", "MILK")).toBe(
      false
    );
    expect(textNamesAllergenCategory("Fruit butters, apple", "MILK")).toBe(false);
    // ...and the cashew is still a tree nut.
    expect(
      textNamesAllergenCategory("Nuts, cashew butter, plain, with salt added", "TREE_NUT")
    ).toBe(true);
  });

  /**
   * A term names the allergen substance itself, never a food form that can be
   * made from something else. Asserted against the lists directly so re-adding
   * one is a red test rather than a quiet regression in the next run's data.
   */
  it("No term names a food form rather than the allergen substance", () => {
    const forbidden: Array<[AllergenCategory, string]> = [
      ["MILK", "butter"],
      ["MILK", "custard"],
      ["WHEAT", "flour"],
      ["WHEAT", "bran"],
      ["WHEAT", "bread"],
      ["WHEAT", "pasta"],
      ["EGG", "mayonnaise"],
    ];
    for (const [category, term] of forbidden) {
      expect(
        ALLERGEN_TERM_INDEX[category],
        `${term} is a food form, not ${category}`
      ).not.toContain(term);
    }

    // The substances that must stay, so the loss is bounded and visible.
    expect(ALLERGEN_TERM_INDEX.MILK).toEqual(
      expect.arrayContaining([
        "milk",
        "cream",
        "cheese",
        "yogurt",
        "whey",
        "casein",
        "lactose",
        "buttermilk",
        "butterfat",
        "ghee",
      ])
    );
    expect(ALLERGEN_TERM_INDEX.WHEAT).toEqual(
      expect.arrayContaining([
        "wheat",
        "semolina",
        "durum",
        "spelt",
        "farro",
        "bulgur",
        "couscous",
        "seitan",
      ])
    );
  });

  /**
   * `<term>-free` is a negation of the term. Without this guard,
   * `Pasta, gluten-free, ...` reads WHEAT through `gluten`: a food whose name
   * says it does not contain the allergen, declared as containing it. The
   * result is UNKNOWN, not VERIFIED_ABSENT — a label phrase in a USDA
   * description is not the positive evidence of absence this module requires,
   * so the food still fails closed for a client who declared wheat.
   */
  it("A '<term>-free' phrase does not read as naming the allergen, and still yields UNKNOWN", () => {
    expect(textNamesAllergenCategory("Crackers, gluten-free", "WHEAT")).toBe(false);
    expect(textNamesAllergenCategory("Crackers, gluten free", "WHEAT")).toBe(false);
    expect(textNamesAllergenCategory("Dessert, dairy-free, frozen", "MILK")).toBe(false);
    // Narrow on purpose: "milk-fat free" is not "milk free".
    expect(
      textNamesAllergenCategory("Milk dessert, frozen, milk-fat free, chocolate", "MILK")
    ).toBe(true);
    // And "free" starting another word is not a negation.
    expect(textNamesAllergenCategory("Grains, gluten freekeh blend", "WHEAT")).toBe(true);

    const raw = {
      _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
      fdcId: 9000000304,
      description: "SYNTHETIC FIXTURE - gluten-free pasta record",
      dataType: "SR Legacy",
      publicationDate: "01/01/1900",
      foodCategory: { description: "SYNTHETIC CATEGORY - grain item" },
      foodNutrients: [],
    };
    const norm = normalizeFdcRecord(raw);
    const facts = proposeAllergenFacts(
      entryFor(norm, {
        canonicalName: "Pasta, gluten-free, corn flour and quinoa flour, cooked, ANCIENT HARVEST",
        categoryId: "GRAINS_STARCHES",
      }),
      norm,
      "2026-09-26T00:00:00.000Z"
    );
    const wheat = facts.categories.find((c) => c.category === "WHEAT");
    // Not PRESENT, and emphatically not VERIFIED_ABSENT: the rule still refuses
    // to convert a label phrase into evidence of absence.
    expect(wheat?.presence).toBe("UNKNOWN");
    expect(wheat?.basis).toBe("NONE");
  });

  it("crossContact is UNKNOWN for every category of every fixture", () => {
    for (const file of ALL_FOOD_FIXTURES) {
      const norm = normalizeFdcRecord(loadFixture(file));
      const facts = proposeAllergenFacts(
        entryFor(norm, { ownAllergenCategories: file.includes("milk") ? ["MILK"] : [] }),
        norm,
        "2026-09-26T00:00:00.000Z"
      );
      expect(facts.categories.every((c) => c.crossContact === "UNKNOWN")).toBe(true);
    }
  });
});
