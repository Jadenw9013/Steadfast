import {
  type AllergenCategory,
  allergenCategorySchema,
} from "@/lib/ai-coach/artifacts/schema";
import type { AllowlistEntry } from "./allowlist-schema";
import type { NormalizedFdcRecord } from "./normalize";

export type AllergenTriState = "PRESENT" | "VERIFIED_ABSENT" | "UNKNOWN";

export type SourcedAllergenCategoryFact = {
  category: AllergenCategory;
  presence: AllergenTriState;
  crossContact: "UNKNOWN"; // Frozen: always UNKNOWN, never VERIFIED_ABSENT
  basis: "SOURCE_RECORD_IDENTITY" | "REVIEWER_ATTESTED" | "NONE";
  ruleId: string;
  verifiedAt: string | null;
};

export type SourcedAllergenFacts = {
  categories: SourcedAllergenCategoryFact[];
  ingredientStatementAvailable: boolean;
  speciesOrTypeDetail: string | null;
};

export const ALLERGEN_TERM_INDEX: Readonly<Record<AllergenCategory, readonly string[]>> = {
  MILK: [
    "milk",
    "dairy",
    "butter",
    "cheese",
    "cream",
    "yogurt",
    "whey",
    "casein",
    "ghee",
    "buttermilk",
    "custard",
  ],
  EGG: ["egg", "eggs", "albumin", "albumen", "yolk", "eggwhite", "mayonnaise"],
  FISH: [
    "fish",
    "salmon",
    "tuna",
    "cod",
    "trout",
    "tilapia",
    "haddock",
    "halibut",
    "sardine",
    "anchovy",
    "bass",
    "catfish",
    "flounder",
    "mackerel",
    "perch",
    "pollock",
    "snapper",
    "swordfish",
    "herring",
    "carp",
    "whitefish",
  ],
  CRUSTACEAN_SHELLFISH: [
    "crustacean",
    "shellfish",
    "shrimp",
    "prawn",
    "crab",
    "lobster",
    "crawfish",
    "crayfish",
    "krill",
  ],
  TREE_NUT: [
    "tree nut",
    "almond",
    "cashew",
    "walnut",
    "pecan",
    "pistachio",
    "hazelnut",
    "filbert",
    "macadamia",
    "brazil nut",
    "pine nut",
    "chestnut",
  ],
  PEANUT: ["peanut", "peanuts", "groundnut", "arachis"],
  WHEAT: [
    "wheat",
    "flour",
    "semolina",
    "spelt",
    "kamut",
    "farro",
    "durum",
    "bulgur",
    "gluten",
    "bran",
    "couscous",
    "bread",
    "pasta",
  ],
  SOYBEAN: ["soy", "soya", "soybean", "soybeans", "edamame", "tofu", "tempeh", "miso"],
  SESAME: ["sesame", "tahini", "sesamum", "benne"],
};

export const SINGLE_INGREDIENT_WHOLE_FOOD_CATEGORIES = new Set([
  "vegetables and vegetable products",
  "vegetables",
  "fruits and fruit juices",
  "fruits",
  "beef products",
  "pork products",
  "poultry products",
  "finfish and shellfish products",
  "dairy and egg products",
  "cereal grains and pasta",
  "legumes and legume products",
  "nut and seed products",
  "fats and oils",
  "spices and herbs",
  "snacks",
  "baked products",
]);

export const SESAME_TREE_NUT_SAFE_CATEGORIES = new Set([
  "vegetables and vegetable products",
  "vegetables",
  "fruits and fruit juices",
  "fruits",
  "beef products",
  "pork products",
  "poultry products",
  "finfish and shellfish products",
  "dairy and egg products",
  "cereal grains and pasta",
  "legumes and legume products",
]);

function matchesAnyTerm(text: string, terms: readonly string[]): boolean {
  for (const term of terms) {
    // Regex for whole-word boundary
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${term}(?:$|[^a-zA-Z0-9])`, "i");
    if (regex.test(text)) {
      return true;
    }
  }
  return false;
}

export function proposeAllergenFacts(
  entry: AllowlistEntry,
  record: NormalizedFdcRecord,
  retrievedAt?: string
): SourcedAllergenFacts {
  const timestamp = retrievedAt ?? new Date().toISOString();
  const combinedText = [
    entry.canonicalName,
    record.description,
    record.foodCategory,
    ...entry.synonyms,
  ].join(" ");

  const normalizedCategory = record.foodCategory.trim().toLowerCase();
  const isSingleIngredientCategory = SINGLE_INGREDIENT_WHOLE_FOOD_CATEGORIES.has(normalizedCategory);
  const isSesameTreeNutSafeCategory = SESAME_TREE_NUT_SAFE_CATEGORIES.has(normalizedCategory);

  const categories: SourcedAllergenCategoryFact[] = allergenCategorySchema.options.map((category) => {
    const terms = ALLERGEN_TERM_INDEX[category];
    const isDeclaredOwn = entry.ownAllergenCategories.includes(category);
    const termMatched = matchesAnyTerm(combinedText, terms);

    // 1. PRESENT
    if (isDeclaredOwn || termMatched) {
      return {
        category,
        presence: "PRESENT",
        crossContact: "UNKNOWN",
        basis: "SOURCE_RECORD_IDENTITY",
        ruleId: "INGESTION_RULE_V1",
        verifiedAt: timestamp,
      };
    }

    // 2. VERIFIED_ABSENT
    const isAllowedDataType = entry.dataType === "Foundation" || entry.dataType === "SR Legacy";
    const isWholeFood = entry.singleIngredientWholeFood === true;
    const hasNoComponents = !record.hasInputFoods;

    let categorySafeForAbsence = true;
    if (category === "SESAME" || category === "TREE_NUT") {
      categorySafeForAbsence = isSesameTreeNutSafeCategory;
    }

    if (
      isAllowedDataType &&
      isWholeFood &&
      hasNoComponents &&
      isSingleIngredientCategory &&
      !isDeclaredOwn &&
      !termMatched &&
      categorySafeForAbsence
    ) {
      return {
        category,
        presence: "VERIFIED_ABSENT",
        crossContact: "UNKNOWN",
        basis: "SOURCE_RECORD_IDENTITY",
        ruleId: "INGESTION_RULE_V1",
        verifiedAt: timestamp,
      };
    }

    // 3. UNKNOWN
    return {
      category,
      presence: "UNKNOWN",
      crossContact: "UNKNOWN",
      basis: "NONE",
      ruleId: "INGESTION_RULE_V1",
      verifiedAt: null,
    };
  });

  return {
    categories,
    ingredientStatementAvailable: false,
    speciesOrTypeDetail: null,
  };
}
