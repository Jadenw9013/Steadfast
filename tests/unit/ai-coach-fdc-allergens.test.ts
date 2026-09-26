import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  proposeAllergenFacts,
  ALLERGEN_TERM_INDEX,
  type SourcedAllergenFacts,
} from "@/lib/ai-coach/catalog/fdc/allergen-rules";
import { normalizeFdcRecord } from "@/lib/ai-coach/catalog/fdc/normalize";
import type { AllowlistEntry } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import { allergenCategorySchema, type AllergenCategory } from "@/lib/ai-coach/artifacts/schema";

const FIXTURES_DIR = path.resolve("tests/fixtures/ai-coach/fdc");

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

describe("T-2035 — FDC Allergen Tri-State Rules", () => {
  it("The nine category values equal T-2002's frozen enum exactly", () => {
    expect(allergenCategorySchema.options).toEqual(FROZEN_T2002_ALLERGEN_CATEGORIES);
  });

  it("All nine categories are always present in allergenFactsV2.categories for every fixture (length === 9)", () => {
    const fixtureFiles = [
      "foundation-single-ingredient.json",
      "sr-legacy-single-ingredient.json",
      "missing-nutrient.json",
      "reported-zero.json",
      "multi-ingredient.json",
      "allergen-milk.json",
      "no-energy-nutrient.json",
    ];

    for (const file of fixtureFiles) {
      const raw = loadFixture(file);
      const norm = normalizeFdcRecord(raw);
      const entry: AllowlistEntry = {
        fdcId: norm.fdcId,
        dataType: norm.dataType === "Foundation" ? "Foundation" : "SR Legacy",
        canonicalName: norm.description,
        synonyms: [norm.description.toLowerCase()],
        categoryId: "VEGETABLE",
        foodState: "RAW",
        singleIngredientWholeFood: !norm.hasInputFoods,
        patternTags: ["OMNIVORE"],
        ownAllergenCategories: [],
        reviewState: "PROPOSED",
        reviewerNote: null,
      };

      const facts = proposeAllergenFacts(entry, norm, "2026-09-26T00:00:00.000Z");
      expect(facts.categories.length).toBe(9);
      const categoryNames = facts.categories.map((c) => c.category);
      expect(categoryNames).toEqual(FROZEN_T2002_ALLERGEN_CATEGORIES);
    }
  });

  it("The milk record yields MILK: PRESENT with basis: 'SOURCE_RECORD_IDENTITY'", () => {
    const rawMilk = loadFixture("allergen-milk.json");
    const norm = normalizeFdcRecord(rawMilk);
    const entry: AllowlistEntry = {
      fdcId: norm.fdcId,
      dataType: "Foundation",
      canonicalName: "Milk, Whole, 3.25%",
      synonyms: ["whole milk", "dairy milk"],
      categoryId: "DAIRY_AND_ALTERNATIVE",
      foodState: "RAW",
      singleIngredientWholeFood: true,
      patternTags: ["OMNIVORE", "LACTO_OVO_VEGETARIAN"],
      ownAllergenCategories: ["MILK"],
      reviewState: "PROPOSED",
      reviewerNote: null,
    };

    const facts = proposeAllergenFacts(entry, norm, "2026-09-26T00:00:00.000Z");
    const milkFact = facts.categories.find((c) => c.category === "MILK");
    expect(milkFact).toBeDefined();
    expect(milkFact?.presence).toBe("PRESENT");
    expect(milkFact?.basis).toBe("SOURCE_RECORD_IDENTITY");
  });

  it("A Foundation single-ingredient vegetable yields VERIFIED_ABSENT for MILK, EGG, etc. and exact tri-states", () => {
    const rawBroccoli = loadFixture("foundation-single-ingredient.json");
    const norm = normalizeFdcRecord(rawBroccoli);
    const entry: AllowlistEntry = {
      fdcId: norm.fdcId,
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

    const facts = proposeAllergenFacts(entry, norm, "2026-09-26T00:00:00.000Z");
    // Vegetables is in SESAME_TREE_NUT_SAFE_CATEGORIES and SINGLE_INGREDIENT_WHOLE_FOOD_CATEGORIES
    // With singleIngredientWholeFood === true, no inputFoods, no allergen terms:
    // All 9 categories must be VERIFIED_ABSENT!
    for (const cat of facts.categories) {
      expect(cat.presence).toBe("VERIFIED_ABSENT");
      expect(cat.basis).toBe("SOURCE_RECORD_IDENTITY");
      expect(cat.ruleId).toBe("INGESTION_RULE_V1");
      expect(cat.crossContact).toBe("UNKNOWN");
    }
  });

  it("The multi-ingredient record yields UNKNOWN for all nine with basis: 'NONE'", () => {
    const rawSoup = loadFixture("multi-ingredient.json");
    const norm = normalizeFdcRecord(rawSoup);
    const entry: AllowlistEntry = {
      fdcId: norm.fdcId,
      dataType: "Foundation",
      canonicalName: "Vegetable Soup",
      synonyms: ["canned vegetable soup"],
      categoryId: "VEGETABLE",
      foodState: "COOKED",
      singleIngredientWholeFood: false,
      patternTags: ["OMNIVORE"],
      ownAllergenCategories: [],
      reviewState: "PROPOSED",
      reviewerNote: null,
    };

    const facts = proposeAllergenFacts(entry, norm, "2026-09-26T00:00:00.000Z");
    for (const cat of facts.categories) {
      expect(cat.presence).toBe("UNKNOWN");
      expect(cat.basis).toBe("NONE");
      expect(cat.verifiedAt).toBeNull();
    }
  });

  it("A snack/spice-category record yields UNKNOWN for SESAME and TREE_NUT even though no term matches", () => {
    const rawSpice = {
      fdcId: 179001,
      description: "Black pepper, ground",
      dataType: "Foundation",
      publicationDate: "10/28/2020",
      foodCategory: {
        description: "Spices and Herbs",
      },
      foodNutrients: [],
    };
    const norm = normalizeFdcRecord(rawSpice);
    const entry: AllowlistEntry = {
      fdcId: norm.fdcId,
      dataType: "Foundation",
      canonicalName: "Black Pepper",
      synonyms: ["ground black pepper"],
      categoryId: "CONDIMENT_AND_SEASONING",
      foodState: "NOT_APPLICABLE",
      singleIngredientWholeFood: true,
      patternTags: ["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN"],
      ownAllergenCategories: [],
      reviewState: "PROPOSED",
      reviewerNote: null,
    };

    const facts = proposeAllergenFacts(entry, norm, "2026-09-26T00:00:00.000Z");
    const sesameFact = facts.categories.find((c) => c.category === "SESAME");
    const treeNutFact = facts.categories.find((c) => c.category === "TREE_NUT");
    const milkFact = facts.categories.find((c) => c.category === "MILK");

    // Milk should be VERIFIED_ABSENT for single ingredient whole spice
    expect(milkFact?.presence).toBe("VERIFIED_ABSENT");
    // But SESAME and TREE_NUT must yield UNKNOWN because Spices and Herbs is not in SESAME_TREE_NUT_SAFE_CATEGORIES
    expect(sesameFact?.presence).toBe("UNKNOWN");
    expect(sesameFact?.basis).toBe("NONE");
    expect(treeNutFact?.presence).toBe("UNKNOWN");
    expect(treeNutFact?.basis).toBe("NONE");
  });

  it("crossContact is UNKNOWN for every category of every fixture", () => {
    const fixtureFiles = [
      "foundation-single-ingredient.json",
      "sr-legacy-single-ingredient.json",
      "missing-nutrient.json",
      "reported-zero.json",
      "multi-ingredient.json",
      "allergen-milk.json",
      "no-energy-nutrient.json",
    ];

    for (const file of fixtureFiles) {
      const raw = loadFixture(file);
      const norm = normalizeFdcRecord(raw);
      const entry: AllowlistEntry = {
        fdcId: norm.fdcId,
        dataType: norm.dataType === "Foundation" ? "Foundation" : "SR Legacy",
        canonicalName: norm.description,
        synonyms: [norm.description.toLowerCase()],
        categoryId: "VEGETABLE",
        foodState: "RAW",
        singleIngredientWholeFood: !norm.hasInputFoods,
        patternTags: ["OMNIVORE"],
        ownAllergenCategories: file.includes("milk") ? ["MILK"] : [],
        reviewState: "PROPOSED",
        reviewerNote: null,
      };

      const facts = proposeAllergenFacts(entry, norm, "2026-09-26T00:00:00.000Z");
      const allCrossContactUnknown = facts.categories.every(
        (c) => c.crossContact === "UNKNOWN"
      );
      expect(allCrossContactUnknown).toBe(true);
    }
  });
});
