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

/**
 * Terms are written in the **singular only**. `matchesAnyTerm` generates the
 * plural and matches possessives, so listing `almonds` beside `almond` buys
 * nothing and listing only `almond` no longer loses `Nuts, almonds`. A unit
 * test walks all nine lists and asserts the generated plural of every term
 * matches, so this property holds for terms added later.
 */
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
  EGG: ["egg", "albumin", "albumen", "yolk", "eggwhite", "mayonnaise"],
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
  PEANUT: ["peanut", "groundnut", "arachis"],
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
  SOYBEAN: ["soy", "soya", "soybean", "edamame", "tofu", "tempeh", "miso"],
  SESAME: ["sesame", "tahini", "sesamum", "benne"],
};

/** Stamped on every fact this module emits, so a later rule change is visible in stored data. */
export const INGESTION_ALLERGEN_RULE_ID = "INGESTION_RULE_V2_FAIL_CLOSED";

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every written form of a term the matcher must recognise.
 *
 * Review r2 MB-3: the term lists hold singulars and the old boundary demanded a
 * non-alphanumeric character *immediately* after the term, so `almond` did not
 * match `Nuts, almonds` and the catalog shipped `Nuts, almonds` with
 * `TREE_NUT: PRESENT = []`. USDA descriptions are overwhelmingly plural
 * (`Nuts, walnuts, english`, `Crustaceans, shrimp`, `Eggs, Grade A, Large`),
 * so the singular-only match missed the commonest spelling of the allergen.
 *
 * Plurals are *generated*, not listed, so the gap cannot reopen one category at
 * a time: adding a term to any of the nine lists automatically covers its
 * plural. Possessives need no variant — the boundary character class already
 * admits `'` and `’`, so `almond's` and `almonds'` both match; a test pins that.
 */
export function allergenTermVariants(term: string): string[] {
  const base = term.trim().toLowerCase();
  const variants = new Set<string>([base]);
  if (/[^aeiou]y$/.test(base)) {
    variants.add(`${base.slice(0, -1)}ies`); // anchovy -> anchovies
  } else if (/(?:s|sh|ch|x|z)$/.test(base)) {
    variants.add(`${base}es`); // bass -> basses, shellfish -> shellfishes
  } else {
    variants.add(`${base}s`); // almond -> almonds, crustacean -> crustaceans
  }
  return [...variants];
}

export function matchesAnyTerm(text: string, terms: readonly string[]): boolean {
  for (const term of terms) {
    for (const variant of allergenTermVariants(term)) {
      // Whole-word boundary. The trailing class admits apostrophes, so a
      // possessive is matched without a variant of its own.
      const regex = new RegExp(
        `(?:^|[^a-zA-Z0-9])${escapeRegExp(variant)}(?:$|[^a-zA-Z0-9])`,
        "i"
      );
      if (regex.test(text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Does `text` name this allergen category? The single matcher the ingestion
 * rule and its tests both call, so a test cannot re-implement the rule it is
 * checking, and the invariant test over the committed catalog is asserting the
 * shipped rule rather than a copy of it.
 */
export function textNamesAllergenCategory(text: string, category: AllergenCategory): boolean {
  return matchesAnyTerm(text, ALLERGEN_TERM_INDEX[category]);
}

export function proposeAllergenFacts(
  entry: AllowlistEntry,
  record: NormalizedFdcRecord,
  retrievedAt?: string
): SourcedAllergenFacts {
  const timestamp = retrievedAt ?? new Date().toISOString();
  /**
   * The record's own *identity*: what the food is called, by USDA and by the
   * curator. Deliberately **not** `record.foodCategory`.
   *
   * The frozen spec's PRESENT clause named the category. Review r2 MB-2
   * measured what that produced over the real run: 42 of 130 PRESENT facts came
   * only from the category string and none of them were true. Every one of the
   * 14 finfish read `CRUSTACEAN_SHELLFISH: PRESENT` because USDA files them
   * under "Finfish and Shellfish Products"; quinoa and white rice read
   * `WHEAT: PRESENT` under "Cereal Grains and Pasta"; cheddar read
   * `EGG: PRESENT` and egg white read `MILK: PRESENT` under "Dairy and Egg
   * Products". This is a deliberate departure from the spec.
   *
   * Over-declaring is not the safe direction it looks like. `UNKNOWN` already
   * fails closed downstream, so a false `PRESENT` excludes nothing that
   * `UNKNOWN` would not have excluded anyway — it buys no safety. What it does
   * buy is a document the RD is asked to sign that says cod contains crustacean
   * shellfish. A catalog whose positive claims are 32% false is a catalog whose
   * positive claims cannot be relied on, which is the same failure as asserting
   * absence nobody verified, pointed the other way. `PRESENT` must be true;
   * `UNKNOWN` is the safe default, and the category is not identity.
   */
  const combinedText = [entry.canonicalName, record.description, ...entry.synonyms].join(" ");

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
