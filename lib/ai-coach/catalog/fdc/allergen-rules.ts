import {
  type AllergenCategory,
  allergenCategorySchema,
} from "@/lib/ai-coach/artifacts/schema";
import type { AllowlistEntry } from "./allowlist-schema";
import type { NormalizedFdcRecord } from "./normalize";

/**
 * T-2035 — mechanical tri-state allergen facts over a USDA FoodData Central record.
 *
 * THE RULE (rewritten 2026-09-26 after code review r1 / `board/evidence/T-2035.md`):
 *
 *   `VERIFIED_ABSENT` requires positive evidence *in the source record* that the
 *   allergen is absent. Everything else is `UNKNOWN`.
 *
 * Absence of an ingredient list is not evidence of absence. A category label is
 * not evidence of absence. An empty `inputFoods`/`foodComponents` array is not
 * evidence of absence. A `singleIngredientWholeFood` flag chosen by whoever
 * curated the allowlist is not evidence at all — it is not in the record.
 *
 * What a real FDC record actually contains (structure probed live 2026-09-26,
 * Foundation fdcId 747447, Branded fdcId 1886332):
 *
 *  - **Foundation** — 16 top-level keys: `dataType, description, fdcId,
 *    foodAttributes, foodCategory, foodClass, foodComponents, foodNutrients,
 *    foodPortions, footnote, inputFoods, isHistoricalReference, ndbNumber,
 *    nutrientConversionFactors, publicationDate, scientificName`. There is **no
 *    `ingredients` field**, no "contains" declaration and no allergen field of
 *    any kind. Nothing in that key set states that an allergen is absent.
 *  - **SR Legacy** — the same minus `inputFoods`/`foodComponents`. Same
 *    conclusion, and its descriptions cover commercially prepared foods
 *    ("commercially prepared" breads and similar) whose real ingredient
 *    statements routinely include soybean oil, milk solids and sesame.
 *  - **Branded** — the only data type carrying an `ingredients` statement,
 *    because US labelling law requires one. That statement is the only place in
 *    the whole API where positive evidence of absence could ever come from. v1
 *    does not accept Branded records (the allowlist schema fences `dataType` to
 *    Foundation and SR Legacy, and `mapFdcRecordToCatalogItem` rejects anything
 *    else with `DISALLOWED_DATA_TYPE`) and this module does not parse ingredient
 *    statements.
 *
 * Therefore, for every record v1 can ingest, no category can be established as
 * absent, and this module emits no `VERIFIED_ABSENT` at all. That is expressed
 * in the type (`ProposedAllergenPresence`) rather than in a comment, exactly as
 * `crossContact` is, so no future edit can quietly widen it without changing a
 * type that a reviewer will see. Downstream (T-2036) `UNKNOWN` fails closed:
 * a client who declared that allergen does not get the food.
 *
 * The consequence is intended and should not be "fixed" by inferring absence:
 * the catalog is mostly `UNKNOWN`, and a food is excluded for a declared
 * allergen rather than served on an unverified absence claim.
 */

export type AllergenTriState = "PRESENT" | "VERIFIED_ABSENT" | "UNKNOWN";

/**
 * What the ingestion rule can emit. `VERIFIED_ABSENT` is deliberately absent:
 * no FDC record of a data type v1 accepts can positively establish absence.
 * A reviewer attestation (`basis: "REVIEWER_ATTESTED"`) is a different writer
 * and is not part of this ticket.
 */
export type ProposedAllergenPresence = Extract<AllergenTriState, "PRESENT" | "UNKNOWN">;

export type SourcedAllergenCategoryFact = {
  category: AllergenCategory;
  presence: ProposedAllergenPresence;
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

/** Stamped on every fact this module emits, so a later rule change is visible in stored data. */
export const INGESTION_ALLERGEN_RULE_ID = "INGESTION_RULE_V2_FAIL_CLOSED";

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

  const categories: SourcedAllergenCategoryFact[] = allergenCategorySchema.options.map((category) => {
    const terms = ALLERGEN_TERM_INDEX[category];
    const isDeclaredOwn = entry.ownAllergenCategories.includes(category);
    const termMatched = matchesAnyTerm(combinedText, terms);

    // PRESENT — the record's own identity names the allergen, or the curator
    // declared the food *is* that allergen. This is the only claim an FDC
    // record supports, and it is the fail-closed direction.
    if (isDeclaredOwn || termMatched) {
      return {
        category,
        presence: "PRESENT",
        crossContact: "UNKNOWN",
        basis: "SOURCE_RECORD_IDENTITY",
        ruleId: INGESTION_ALLERGEN_RULE_ID,
        verifiedAt: timestamp,
      };
    }

    // UNKNOWN — everything else. There is no third branch: see the module
    // header. No field of a Foundation or SR Legacy record establishes that an
    // allergen is absent, so absence is never asserted here.
    return {
      category,
      presence: "UNKNOWN",
      crossContact: "UNKNOWN",
      basis: "NONE",
      ruleId: INGESTION_ALLERGEN_RULE_ID,
      verifiedAt: null,
    };
  });

  return {
    categories,
    // Read off the record, not assumed: only a Branded record carries an
    // ingredient statement, and v1 never ingests one. Recorded as a fact so the
    // reviewer can see that the absence question was never answerable.
    ingredientStatementAvailable: record.ingredientStatement !== null,
    speciesOrTypeDetail: null,
  };
}
