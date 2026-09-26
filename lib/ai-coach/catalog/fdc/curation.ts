/**
 * T-2016 — machine-derived curation proposals for an FDC allowlist entry.
 *
 * Three values on an allowlist entry used to be engineer-set constants that
 * read as facts about the food (review r2 FU-3):
 *
 *  - `singleIngredientWholeFood: true` on 245 of 245 entries, including
 *    `TACO BELL, Nachos` and `Oil, industrial, canola (partially hydrogenated)`.
 *    Deleted outright: the allergen rule that once read it is gone, so it was an
 *    unverified claim with no reader.
 *  - `categoryId` set from whichever coverage-plan *search term* returned the
 *    record, so `TACO BELL, Nachos` was `VEGETABLES` and `Croissants, apple`
 *    was `FRUITS`.
 *  - `patternTags: ["OMNIVORE"]` on every entry, which makes every
 *    pattern-filtered read for a `VEGAN`, `LACTO_OVO_VEGETARIAN` or
 *    `PESCATARIAN` client empty — a screen that disappears instead of degrading
 *    (`board/strategy/release-safety.md`).
 *
 * This module derives the last two, plus reviewer triage flags, from **the
 * record's own USDA `foodCategory` and its own description**, and records on the
 * entry which basis produced each value. Everything stays `PROPOSED`: the RD is
 * still the gate, and these are proposals they can see the reasoning for.
 *
 * ## Why reading `foodCategory` is legitimate here, when the allergen rule had
 * ## it removed
 *
 * Do not read this module as reintroducing review r2 MB-2. That finding was
 * about *allergen declarations*: scanning the category string produced
 * `CRUSTACEAN_SHELLFISH: PRESENT` on all 14 finfish ("Finfish and Shellfish
 * Products") and `WHEAT: PRESENT` on quinoa and rice ("Cereal Grains and
 * Pasta"). A food category cannot establish an allergen declaration, because an
 * allergen declaration is a statement about the food's *ingredients and
 * processing*, which the category says nothing about.
 *
 * A category does establish the food's **identity**: which USDA food group the
 * record belongs to is exactly what `foodCategory` is. Which eating patterns a
 * food belongs to is a question of identity, not a clinical judgment — a record
 * in "Beef Products" is not vegan whatever else is true of it. So identity may
 * be read off the category; a declaration may not.
 *
 * Two rules keep that distinction from eroding:
 *
 *  1. **Category only, never the description, for pattern tags.** Name-based
 *     inference is what produced the allergen defects. `Tofu yogurt` and
 *     `Beverages, rice milk` are the standing proof that a USDA description
 *     does not tell you what a food is made of.
 *  2. **Fail closed to `["OMNIVORE"]` whenever the category does not
 *     unambiguously establish the pattern set.** Omnivore-only excludes the food
 *     from the three restricted patterns, which is the safe direction: a vegan
 *     client not offered broccoli gets a poorer catalog, a vegan client offered
 *     chicken gets a broken promise. Every mixed dish, restaurant item, candy,
 *     baby food and soup category therefore falls back, as does a record that
 *     carries no category at all.
 *
 * The description *is* read, but only for `triageFlags`, which are statements
 * about the description ("this description carries an all-caps brand token"),
 * never about the food.
 */

/**
 * The four eating patterns, in the artifact schema's order. Declared here and
 * imported by `allowlist-schema.ts` so the allowlist and this module cannot
 * drift; a unit test pins the tuple against
 * `sourcedFoodCatalogItemSchema`'s own `patternTags` enum.
 */
export const EATING_PATTERNS = [
  "OMNIVORE",
  "LACTO_OVO_VEGETARIAN",
  "VEGAN",
  "PESCATARIAN",
] as const;

export type EatingPattern = (typeof EATING_PATTERNS)[number];

export const PATTERN_TAG_BASES = [
  /** The record's own USDA food category unambiguously establishes the set. */
  "SOURCE_FOOD_CATEGORY",
  /**
   * It does not (mixed dish, restaurant, candy, baby food, soup, a fat category
   * spanning animal and plant fats, an unrecognised category string, or no
   * category on the record). Omnivore-only, which excludes the food from the
   * three restricted patterns.
   */
  "FALLBACK_OMNIVORE_ONLY",
  /**
   * The reviewer set these tags themselves. The tool never writes this value;
   * it exists so an RD edit has an honest home, because the consistency check
   * in `allowlist-schema.ts` holds a `SOURCE_FOOD_CATEGORY` entry to what its
   * recorded category actually derives.
   */
  "REVIEWER_SET",
] as const;

export type PatternTagBasis = (typeof PATTERN_TAG_BASES)[number];

export const CATEGORY_ID_BASES = [
  /** The record's category maps to exactly one coverage-plan category. */
  "SOURCE_FOOD_CATEGORY",
  /**
   * The record's category maps to several plan categories and the
   * plan-assigned value is one of them, so it is kept as the more specific
   * answer. "Dairy and Egg Products" cannot choose between `DAIRY` and `EGGS`.
   */
  "SOURCE_FOOD_CATEGORY_AMBIGUOUS_PLAN_KEPT",
  /**
   * No confident mapping. The plan-assigned value — which came from the search
   * term, not the food — is kept unchanged and the entry is flagged, rather
   * than guessed at.
   */
  "COVERAGE_PLAN_SEARCH_TERM",
  /** The reviewer set it themselves. Never written by the tool. */
  "REVIEWER_SET",
] as const;

export type CategoryIdBasis = (typeof CATEGORY_ID_BASES)[number];

/**
 * Machine-written reviewer triage flags.
 *
 * **These are the tool's, `reviewState` is the reviewer's, and the two never
 * mix** — the same separation as the source-exclusions channel
 * (`source-exclusions.ts`). A flag says what the tool *detected in the record's
 * description or category*; it never says what the food is, never excludes
 * anything, and is recomputed from scratch on every `--propose` run.
 *
 * They exist because `--propose` takes search hits unfiltered, so roughly 29 of
 * 245 entries are restaurant, candy, baby food or industrial-oil records
 * (review r2 FU-5). Nothing unsafe follows from that — everything is `PROPOSED`
 * — but it costs the RD time and skews any "the catalog has N foods" claim. A
 * flagged group can be struck in bulk instead of read row by row.
 *
 * **The absence of a flag is not a claim.** This is a keyword triage aid over
 * USDA description text, not a classifier: it will miss things (`Fruit butters,
 * apple`, `Rose-apples, raw`) and it may flag a food the RD wants to keep
 * (`Rice, white, steamed, Chinese restaurant`). Never read an empty
 * `triageFlags` as "the tool judged this a good candidate".
 */
export const TRIAGE_FLAGS = [
  /** An all-caps word of 3+ letters, how USDA writes brands and chains. */
  "DESCRIPTION_CARRIES_AN_ALL_CAPS_BRAND_TOKEN",
  "DESCRIPTION_NAMES_A_RESTAURANT_OR_FAST_FOOD",
  "DESCRIPTION_NAMES_A_BABY_OR_TODDLER_FOOD",
  "DESCRIPTION_NAMES_A_CONFECTIONERY_OR_DESSERT",
  "DESCRIPTION_NAMES_AN_INDUSTRIAL_OR_HYDROGENATED_OIL",
  "DESCRIPTION_NAMES_A_SOUP_MIXED_DISH_OR_SNACK_PRODUCT",
  /** The record's USDA category is a prepared/mixed group, not a food group. */
  "SOURCE_CATEGORY_IS_NOT_A_WHOLE_FOOD_GROUP",
  /** The record carried no food category, so nothing could be derived from it. */
  "SOURCE_CATEGORY_MISSING",
  /** `categoryId` still comes from the search term; see `CATEGORY_ID_BASES`. */
  "CATEGORY_ID_NOT_DERIVED_FROM_SOURCE_CATEGORY",
] as const;

export type TriageFlag = (typeof TRIAGE_FLAGS)[number];

const PLANT_PATTERNS: readonly EatingPattern[] = [
  "OMNIVORE",
  "LACTO_OVO_VEGETARIAN",
  "VEGAN",
  "PESCATARIAN",
];
const DAIRY_EGG_PATTERNS: readonly EatingPattern[] = [
  "OMNIVORE",
  "LACTO_OVO_VEGETARIAN",
  "PESCATARIAN",
];
const SEAFOOD_PATTERNS: readonly EatingPattern[] = ["OMNIVORE", "PESCATARIAN"];
const OMNIVORE_ONLY: readonly EatingPattern[] = ["OMNIVORE"];

/**
 * USDA food category → the eating patterns the category establishes.
 *
 * Only categories whose USDA group definition is unambiguous appear here.
 * Everything absent from this table — including every category in
 * {@link NON_WHOLE_FOOD_CATEGORIES} and every string this table does not
 * recognise — falls back to omnivore-only.
 *
 * **"Fats and Oils" is deliberately absent, which departs from the ticket's
 * list of plant categories.** USDA's Fats and Oils group is not a plant group:
 * lard, tallow, butter oil, the fish oils and margarine are canonical members,
 * and so are egg emulsions — `Mayonnaise, reduced fat, with olive oil` and
 * three `Fish oil, …` records are in the current allowlist. A plant-only tag set
 * derived from that category would tag cod liver oil `VEGAN`, which is the
 * broken promise the fallback rule exists to prevent. Plant oils lose their
 * restricted-pattern tags as a result; that is the cheap direction, and the RD
 * can widen them in review.
 *
 * Known residue, in the same spirit as the allergen residue documented in
 * `docs/ai-coach/catalog/README.md` §3: a plant-named USDA group can still
 * contain a prepared item with dairy or egg in it — `Spinach souffle` sits in
 * "Vegetables and Vegetable Products" and USDA's egg noodles sit in "Cereal
 * Grains and Pasta". The category is right about the group and wrong about that
 * record, the derivation is a proposal carrying its basis, and the RD review is
 * the gate. A description-based correction is exactly the mechanism that
 * produced the allergen defects, so it is not applied here.
 */
const PATTERNS_BY_CATEGORY: ReadonlyMap<string, readonly EatingPattern[]> = new Map([
  // Plant groups.
  ["vegetables and vegetable products", PLANT_PATTERNS],
  ["fruits and fruit juices", PLANT_PATTERNS],
  ["cereal grains and pasta", PLANT_PATTERNS],
  ["legumes and legume products", PLANT_PATTERNS],
  ["nut and seed products", PLANT_PATTERNS],
  ["nuts and seeds", PLANT_PATTERNS],
  // Dairy and egg: excluded from VEGAN only.
  ["dairy and egg products", DAIRY_EGG_PATTERNS],
  // Finfish and shellfish: pescatarian and omnivore.
  ["finfish and shellfish products", SEAFOOD_PATTERNS],
  // Animal flesh groups: omnivore only, and *derived* rather than fallen back to.
  ["poultry products", OMNIVORE_ONLY],
  ["beef products", OMNIVORE_ONLY],
  ["pork products", OMNIVORE_ONLY],
  ["lamb, veal, and game products", OMNIVORE_ONLY],
  ["lamb, veal and game products", OMNIVORE_ONLY],
  ["sausages and luncheon meats", OMNIVORE_ONLY],
]);

/**
 * USDA food category → the coverage-plan categories it can describe.
 *
 * A single-element list is a confident mapping. A multi-element list is
 * ambiguous: the plan-assigned value is kept when it is one of them. A category
 * absent from this table keeps the plan-assigned value and is flagged (task 3:
 * "where no confident mapping exists, keep the plan-assigned value and flag the
 * entry rather than guessing").
 *
 * The plan's ten ids are the fence — `allowlistSchemaForPlan` rejects any other
 * — so every value here must be one of them:
 * `VEGETABLES, FRUITS, GRAINS_STARCHES, LEGUMES, POULTRY_AND_MEAT, SEAFOOD,
 * DAIRY, EGGS, NUTS_AND_SEEDS, FATS_AND_OILS`.
 */
const PLAN_CATEGORIES_BY_SOURCE_CATEGORY: ReadonlyMap<string, readonly string[]> = new Map([
  ["vegetables and vegetable products", ["VEGETABLES"]],
  ["fruits and fruit juices", ["FRUITS"]],
  ["cereal grains and pasta", ["GRAINS_STARCHES"]],
  // Bread, bagels and the rest of the grain-based baked goods are starch foods.
  // This is the mapping that moves `Croissants, apple` out of `FRUITS`.
  ["baked products", ["GRAINS_STARCHES"]],
  ["breakfast cereals", ["GRAINS_STARCHES"]],
  ["legumes and legume products", ["LEGUMES"]],
  ["nut and seed products", ["NUTS_AND_SEEDS"]],
  ["nuts and seeds", ["NUTS_AND_SEEDS"]],
  ["fats and oils", ["FATS_AND_OILS"]],
  ["finfish and shellfish products", ["SEAFOOD"]],
  ["poultry products", ["POULTRY_AND_MEAT"]],
  ["beef products", ["POULTRY_AND_MEAT"]],
  ["pork products", ["POULTRY_AND_MEAT"]],
  ["lamb, veal, and game products", ["POULTRY_AND_MEAT"]],
  ["lamb, veal and game products", ["POULTRY_AND_MEAT"]],
  ["sausages and luncheon meats", ["POULTRY_AND_MEAT"]],
  // The one category the plan splits in two. Cannot choose; keeps the plan's
  // value when the plan says one of these.
  ["dairy and egg products", ["DAIRY", "EGGS"]],
]);

/**
 * USDA groups of prepared, branded or confectionery foods. Flagged for the RD's
 * triage, and never a pattern-tag basis.
 */
const NON_WHOLE_FOOD_CATEGORIES: ReadonlySet<string> = new Set([
  "fast foods",
  "restaurant foods",
  "sweets",
  "snacks",
  "baby foods",
  "babyfoods",
  "beverages",
  "soups, sauces, and gravies",
  "soups, sauces and gravies",
  "meals, entrees, and side dishes",
  "meals, entrees and side dishes",
  "spices and herbs",
  "american indian/alaska native foods",
]);

/**
 * Keyword sets for the description flags. Matched on word boundaries over the
 * lower-cased description, so `baby` alone never matches (`Spinach, baby`,
 * `Carrots, baby, raw` are foods the RD wants) while `babyfood` and `toddler`
 * do.
 */
const TRIAGE_TERMS: ReadonlyArray<{ flag: TriageFlag; terms: readonly string[] }> = [
  {
    flag: "DESCRIPTION_NAMES_A_RESTAURANT_OR_FAST_FOOD",
    terms: ["restaurant", "fast food", "fast foods"],
  },
  {
    flag: "DESCRIPTION_NAMES_A_BABY_OR_TODDLER_FOOD",
    terms: ["babyfood", "babyfoods", "baby food", "baby foods", "toddler"],
  },
  {
    flag: "DESCRIPTION_NAMES_A_CONFECTIONERY_OR_DESSERT",
    terms: [
      "candy",
      "candies",
      "confection",
      "confectioner",
      "confectioner's",
      "nougat",
      "chocolate",
      "ice cream",
      "ice creams",
      "sherbet",
      "frozen yogurt",
      "frozen yogurts",
      "dessert",
      "desserts",
      "topping",
      "toppings",
      "syrup",
      "strudel",
      "croissant",
      "croissants",
      "muffin",
      "muffins",
      "marmalade",
    ],
  },
  {
    flag: "DESCRIPTION_NAMES_AN_INDUSTRIAL_OR_HYDROGENATED_OIL",
    terms: ["industrial", "hydrogenated", "shortening"],
  },
  {
    flag: "DESCRIPTION_NAMES_A_SOUP_MIXED_DISH_OR_SNACK_PRODUCT",
    terms: [
      "soup",
      "soups",
      "souffle",
      "entree",
      "entrees",
      "snack",
      "snacks",
      "cracker",
      "crackers",
      "dinner",
    ],
  },
];

function normalizeCategory(foodCategory: string | null): string | null {
  if (typeof foodCategory !== "string") return null;
  const normalized = foodCategory.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  return normalized.length > 0 ? normalized : null;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function descriptionNamesTerm(description: string, term: string): boolean {
  // Word boundaries on both sides, so `snack` matches `Snacks,` and `snacking`
  // but `cracker` does not match inside another word. Apostrophes are part of
  // the term when the term carries one.
  const pattern = new RegExp(`(^|[^a-z0-9'])${escapeRegExp(term)}(s?)($|[^a-z0-9])`, "i");
  return pattern.test(description);
}

/**
 * USDA writes brand owners and restaurant chains in capitals
 * (`TACO BELL, Nachos`, `APPLEBEE'S, mozzarella sticks`,
 * `Pasta, gluten-free, …, ANCIENT HARVEST`), and writes generic foods in
 * sentence case. Three letters is the floor so that `Eggs, Grade A, Large` and
 * `Beef, short loin (NY strip steak)` are not flagged.
 */
export function descriptionCarriesAllCapsBrandToken(description: string): boolean {
  for (const token of description.split(/[^A-Za-z']+/)) {
    const letters = token.replace(/'/g, "");
    if (letters.length < 3) continue;
    if (letters === letters.toUpperCase() && /^[A-Z]+$/.test(letters)) return true;
  }
  return false;
}

/**
 * The pattern set a record's own USDA food category establishes, and the basis
 * that produced it. Category only — never the description.
 */
export function derivePatternTags(foodCategory: string | null): {
  patternTags: EatingPattern[];
  basis: PatternTagBasis;
} {
  const normalized = normalizeCategory(foodCategory);
  const mapped = normalized ? PATTERNS_BY_CATEGORY.get(normalized) : undefined;
  if (!mapped) {
    return { patternTags: [...OMNIVORE_ONLY], basis: "FALLBACK_OMNIVORE_ONLY" };
  }
  return { patternTags: [...mapped], basis: "SOURCE_FOOD_CATEGORY" };
}

/**
 * The coverage-plan category that describes the record, preferring the record's
 * own USDA category over the search term that happened to return it.
 * `planCategoryId` is whatever the coverage plan assigned and is returned
 * unchanged when no confident mapping exists.
 */
export function deriveCategoryId(input: {
  foodCategory: string | null;
  planCategoryId: string;
}): { categoryId: string; basis: CategoryIdBasis } {
  const normalized = normalizeCategory(input.foodCategory);
  const candidates = normalized ? PLAN_CATEGORIES_BY_SOURCE_CATEGORY.get(normalized) : undefined;

  if (!candidates || candidates.length === 0) {
    return { categoryId: input.planCategoryId, basis: "COVERAGE_PLAN_SEARCH_TERM" };
  }
  if (candidates.length === 1) {
    return { categoryId: candidates[0], basis: "SOURCE_FOOD_CATEGORY" };
  }
  if (candidates.includes(input.planCategoryId)) {
    return {
      categoryId: input.planCategoryId,
      basis: "SOURCE_FOOD_CATEGORY_AMBIGUOUS_PLAN_KEPT",
    };
  }
  return { categoryId: input.planCategoryId, basis: "COVERAGE_PLAN_SEARCH_TERM" };
}

/**
 * Everything the tool detected about the record that an RD would want to triage
 * on. Statements about the description and the category; never about the food.
 */
export function computeTriageFlags(input: {
  description: string;
  foodCategory: string | null;
  categoryIdBasis: CategoryIdBasis;
}): TriageFlag[] {
  const flags = new Set<TriageFlag>();
  const description = input.description ?? "";

  if (descriptionCarriesAllCapsBrandToken(description)) {
    flags.add("DESCRIPTION_CARRIES_AN_ALL_CAPS_BRAND_TOKEN");
  }

  for (const { flag, terms } of TRIAGE_TERMS) {
    if (terms.some((term) => descriptionNamesTerm(description, term))) {
      flags.add(flag);
    }
  }

  const normalized = normalizeCategory(input.foodCategory);
  if (!normalized) {
    flags.add("SOURCE_CATEGORY_MISSING");
  } else if (NON_WHOLE_FOOD_CATEGORIES.has(normalized)) {
    flags.add("SOURCE_CATEGORY_IS_NOT_A_WHOLE_FOOD_GROUP");
  }

  if (input.categoryIdBasis === "COVERAGE_PLAN_SEARCH_TERM") {
    flags.add("CATEGORY_ID_NOT_DERIVED_FROM_SOURCE_CATEGORY");
  }

  // Declaration order, so a re-run of an unchanged record produces an identical
  // array and an empty diff.
  return TRIAGE_FLAGS.filter((flag) => flags.has(flag));
}

export type ProposedCuration = {
  categoryId: string;
  categoryIdBasis: CategoryIdBasis;
  patternTags: EatingPattern[];
  patternTagsBasis: PatternTagBasis;
  triageFlags: TriageFlag[];
};

/**
 * The whole proposal for one search hit, as a pure function of the record's
 * description, the record's own USDA food category and the coverage plan's
 * assignment. Deliberately returns neither `reviewState` nor `reviewerNote`:
 * those are the reviewer's, and no code path here can reach them.
 */
export function proposeCuration(input: {
  description: string;
  foodCategory: string | null;
  planCategoryId: string;
}): ProposedCuration {
  const category = deriveCategoryId({
    foodCategory: input.foodCategory,
    planCategoryId: input.planCategoryId,
  });
  const patterns = derivePatternTags(input.foodCategory);
  return {
    categoryId: category.categoryId,
    categoryIdBasis: category.basis,
    patternTags: patterns.patternTags,
    patternTagsBasis: patterns.basis,
    triageFlags: computeTriageFlags({
      description: input.description,
      foodCategory: input.foodCategory,
      categoryIdBasis: category.basis,
    }),
  };
}
