import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourcedFoodCatalogItemSchema } from "@/lib/ai-coach/artifacts/schema";
import { coveragePlanSchema } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import {
  CATEGORY_ID_BASES,
  EATING_PATTERNS,
  PATTERN_TAG_BASES,
  TRIAGE_FLAGS,
  computeTriageFlags,
  derivePatternTags,
  deriveCategoryId,
  descriptionCarriesAllCapsBrandToken,
  proposeCuration,
  type EatingPattern,
} from "@/lib/ai-coach/catalog/fdc/curation";

const COVERAGE_PLAN_PATH = path.resolve("data/ai-coach/catalog/fdc-coverage-plan.v1.json");

/** The USDA food groups a record in this pipeline can land in. */
const PLANT_CATEGORIES = [
  "Vegetables and Vegetable Products",
  "Fruits and Fruit Juices",
  "Cereal Grains and Pasta",
  "Legumes and Legume Products",
  "Nut and Seed Products",
];

const ANIMAL_FLESH_CATEGORIES = [
  "Poultry Products",
  "Beef Products",
  "Pork Products",
  "Lamb, Veal, and Game Products",
  "Sausages and Luncheon Meats",
];

/**
 * Categories that establish nothing about the pattern set and must fail closed.
 * "Fats and Oils" is here deliberately: USDA's Fats and Oils group holds lard,
 * tallow, the fish oils, margarine and mayonnaise alongside the plant oils, and
 * `Mayonnaise, reduced fat, with olive oil` plus three `Fish oil, …` records are
 * in the current allowlist. A plant tag set derived from that category would
 * offer a vegan client cod liver oil.
 */
const FALLBACK_CATEGORIES = [
  "Fats and Oils",
  "Fast Foods",
  "Restaurant Foods",
  "Sweets",
  "Snacks",
  "Baby Foods",
  "Beverages",
  "Soups, Sauces, and Gravies",
  "Meals, Entrees, and Side Dishes",
  "Spices and Herbs",
  "American Indian/Alaska Native Foods",
  "Baked Products",
  "Breakfast Cereals",
  "SYNTHETIC CATEGORY - plant item",
  "A category string USDA has never used",
];

describe("T-2016 — curation derived from the record's own USDA food category", () => {
  it("the eating-pattern vocabulary is the artifact schema's, not a second copy", () => {
    // One vocabulary for the allowlist, the derivation and the catalog item. A
    // fifth pattern added to the artifact without being added here would make
    // the derivation silently unable to emit it.
    const itemPatterns = sourcedFoodCatalogItemSchema.shape.patternTags.unwrap().element.options;
    expect([...EATING_PATTERNS]).toEqual([...itemPatterns]);
  });

  describe("patternTags", () => {
    it("plant food groups establish all four patterns", () => {
      for (const category of PLANT_CATEGORIES) {
        const derived = derivePatternTags(category);
        expect(derived.basis, category).toBe("SOURCE_FOOD_CATEGORY");
        expect([...derived.patternTags].sort(), category).toEqual([...EATING_PATTERNS].sort());
      }
    });

    it("Dairy and Egg Products excludes VEGAN and nothing else", () => {
      const derived = derivePatternTags("Dairy and Egg Products");
      expect(derived.basis).toBe("SOURCE_FOOD_CATEGORY");
      expect([...derived.patternTags].sort()).toEqual([
        "LACTO_OVO_VEGETARIAN",
        "OMNIVORE",
        "PESCATARIAN",
      ]);
    });

    it("Finfish and Shellfish Products is pescatarian and omnivore", () => {
      const derived = derivePatternTags("Finfish and Shellfish Products");
      expect(derived.basis).toBe("SOURCE_FOOD_CATEGORY");
      expect([...derived.patternTags].sort()).toEqual(["OMNIVORE", "PESCATARIAN"]);
    });

    it("animal flesh groups are omnivore-only, and that is *derived*, not fallen back to", () => {
      // The distinction the ticket asks for: an entry whose tags were derived
      // from an unambiguous category must be distinguishable from one that fell
      // back. Both read ["OMNIVORE"]; only the basis tells them apart.
      for (const category of ANIMAL_FLESH_CATEGORIES) {
        const derived = derivePatternTags(category);
        expect(derived.patternTags, category).toEqual(["OMNIVORE"]);
        expect(derived.basis, category).toBe("SOURCE_FOOD_CATEGORY");
      }
    });

    it("every ambiguous, mixed, prepared or unrecognised category fails closed to omnivore-only", () => {
      for (const category of [...FALLBACK_CATEGORIES, "", "   ", null]) {
        const derived = derivePatternTags(category);
        expect(derived.patternTags, String(category)).toEqual(["OMNIVORE"]);
        expect(derived.basis, String(category)).toBe("FALLBACK_OMNIVORE_ONLY");
      }
    });

    it("no category outside the plant groups can produce VEGAN", () => {
      // The one-directional safety property: a vegan client may lose a food the
      // category could not vouch for, and may never be offered one it could not.
      const everyCategory = [
        ...PLANT_CATEGORIES,
        ...ANIMAL_FLESH_CATEGORIES,
        ...FALLBACK_CATEGORIES,
        "Dairy and Egg Products",
        "Finfish and Shellfish Products",
      ];
      for (const category of everyCategory) {
        const { patternTags } = derivePatternTags(category);
        if (patternTags.includes("VEGAN")) {
          expect(PLANT_CATEGORIES, category).toContain(category);
          // Anything acceptable to a vegan is acceptable on all four patterns.
          expect([...patternTags].sort(), category).toEqual([...EATING_PATTERNS].sort());
        }
      }
    });

    it("the food's name is never read: the same category derives the same tags for any description", () => {
      // `Spinach souffle` and `Broccoli, raw` share a USDA category. The
      // derivation cannot tell them apart and must not try — name-based
      // inference is what produced the allergen defects (review r2 MB-2/MB-3).
      const a = proposeCuration({
        description: "Broccoli, raw",
        foodCategory: "Vegetables and Vegetable Products",
        planCategoryId: "VEGETABLES",
      });
      const b = proposeCuration({
        description: "Spinach souffle",
        foodCategory: "Vegetables and Vegetable Products",
        planCategoryId: "VEGETABLES",
      });
      expect(a.patternTags).toEqual(b.patternTags);
      expect(a.patternTagsBasis).toEqual(b.patternTagsBasis);
    });

    it("is insensitive to case, padding and a trailing period", () => {
      for (const written of [
        "finfish and shellfish products",
        "  Finfish and Shellfish Products  ",
        "FINFISH AND SHELLFISH PRODUCTS.",
        "Finfish  and  Shellfish  Products",
      ]) {
        expect(derivePatternTags(written).basis, written).toBe("SOURCE_FOOD_CATEGORY");
      }
    });
  });

  describe("categoryId", () => {
    it("prefers the record's own category over the search term that returned it", () => {
      // The three examples review r2 FU-3 named, by their real plan assignment.
      expect(
        deriveCategoryId({ foodCategory: "Baked Products", planCategoryId: "FRUITS" })
      ).toEqual({ categoryId: "GRAINS_STARCHES", basis: "SOURCE_FOOD_CATEGORY" });
      expect(
        deriveCategoryId({
          foodCategory: "Finfish and Shellfish Products",
          planCategoryId: "SEAFOOD",
        })
      ).toEqual({ categoryId: "SEAFOOD", basis: "SOURCE_FOOD_CATEGORY" });
      expect(
        deriveCategoryId({ foodCategory: "Poultry Products", planCategoryId: "VEGETABLES" })
      ).toEqual({ categoryId: "POULTRY_AND_MEAT", basis: "SOURCE_FOOD_CATEGORY" });
    });

    it("keeps the plan's value and flags it when no confident mapping exists", () => {
      // `TACO BELL, Nachos` came back from the `tomato` search term, so the plan
      // says VEGETABLES. Its USDA group cannot say otherwise, so the plan value
      // is kept unchanged rather than guessed at, and the entry is flagged.
      const derived = deriveCategoryId({
        foodCategory: "Fast Foods",
        planCategoryId: "VEGETABLES",
      });
      expect(derived).toEqual({ categoryId: "VEGETABLES", basis: "COVERAGE_PLAN_SEARCH_TERM" });
      expect(
        computeTriageFlags({
          description: "TACO BELL, Nachos",
          foodCategory: "Fast Foods",
          categoryIdBasis: derived.basis,
        })
      ).toContain("CATEGORY_ID_NOT_DERIVED_FROM_SOURCE_CATEGORY");
    });

    it("Dairy and Egg Products is ambiguous, so the plan's DAIRY or EGGS is kept", () => {
      expect(
        deriveCategoryId({ foodCategory: "Dairy and Egg Products", planCategoryId: "DAIRY" })
      ).toEqual({ categoryId: "DAIRY", basis: "SOURCE_FOOD_CATEGORY_AMBIGUOUS_PLAN_KEPT" });
      expect(
        deriveCategoryId({ foodCategory: "Dairy and Egg Products", planCategoryId: "EGGS" })
      ).toEqual({ categoryId: "EGGS", basis: "SOURCE_FOOD_CATEGORY_AMBIGUOUS_PLAN_KEPT" });
      // And when the plan's value is neither, nothing is invented.
      expect(
        deriveCategoryId({ foodCategory: "Dairy and Egg Products", planCategoryId: "VEGETABLES" })
      ).toEqual({ categoryId: "VEGETABLES", basis: "COVERAGE_PLAN_SEARCH_TERM" });
    });

    it("a missing category keeps the plan's value", () => {
      for (const category of [null, "", "A category string USDA has never used"]) {
        expect(deriveCategoryId({ foodCategory: category, planCategoryId: "LEGUMES" })).toEqual({
          categoryId: "LEGUMES",
          basis: "COVERAGE_PLAN_SEARCH_TERM",
        });
      }
    });

    it("every derived categoryId is one of the coverage plan's ten ids", () => {
      // The allowlist schema fences `categoryId` to the plan, so a mapping that
      // lands anywhere else makes the whole run unparseable. Checked against the
      // plan file rather than a copied list.
      const plan = coveragePlanSchema.parse(JSON.parse(fs.readFileSync(COVERAGE_PLAN_PATH, "utf8")));
      const planIds = plan.categories.map((category) => category.categoryId);
      expect(planIds).toHaveLength(10);

      const everyCategory = [
        ...PLANT_CATEGORIES,
        ...ANIMAL_FLESH_CATEGORIES,
        ...FALLBACK_CATEGORIES,
        "Dairy and Egg Products",
        "Finfish and Shellfish Products",
        "Nuts and Seeds",
      ];
      for (const category of everyCategory) {
        for (const planCategoryId of planIds) {
          const derived = deriveCategoryId({ foodCategory: category, planCategoryId });
          expect(planIds, `${category} / ${planCategoryId}`).toContain(derived.categoryId);
        }
      }
    });
  });

  describe("triage flags", () => {
    it("flags the four groups the reviewer asked not to be handed 245 rows of", () => {
      const cases: Array<{ description: string; flag: string }> = [
        { description: "TACO BELL, Nachos", flag: "DESCRIPTION_CARRIES_AN_ALL_CAPS_BRAND_TOKEN" },
        {
          description: "APPLEBEE'S, Double Crunch Shrimp",
          flag: "DESCRIPTION_CARRIES_AN_ALL_CAPS_BRAND_TOKEN",
        },
        {
          description: "Pasta, gluten-free, corn flour and quinoa flour, cooked, ANCIENT HARVEST",
          flag: "DESCRIPTION_CARRIES_AN_ALL_CAPS_BRAND_TOKEN",
        },
        {
          description: "Babyfood, carrots, toddler",
          flag: "DESCRIPTION_NAMES_A_BABY_OR_TODDLER_FOOD",
        },
        {
          description: "Babyfood, dinner, pasta with vegetables",
          flag: "DESCRIPTION_NAMES_A_BABY_OR_TODDLER_FOOD",
        },
        {
          description: "Candies, nougat, with almonds",
          flag: "DESCRIPTION_NAMES_A_CONFECTIONERY_OR_DESSERT",
        },
        { description: "Ice creams, strawberry", flag: "DESCRIPTION_NAMES_A_CONFECTIONERY_OR_DESSERT" },
        { description: "Croissants, apple", flag: "DESCRIPTION_NAMES_A_CONFECTIONERY_OR_DESSERT" },
        {
          description: "Oil, industrial, canola (partially hydrogenated) oil for deep fat frying",
          flag: "DESCRIPTION_NAMES_AN_INDUSTRIAL_OR_HYDROGENATED_OIL",
        },
        {
          description: "Oil, industrial, coconut (hydrogenated), used for whipped toppings",
          flag: "DESCRIPTION_NAMES_AN_INDUSTRIAL_OR_HYDROGENATED_OIL",
        },
        {
          description: "Restaurant, Latino, black bean soup",
          flag: "DESCRIPTION_NAMES_A_RESTAURANT_OR_FAST_FOOD",
        },
        {
          description: "Soup, black bean, canned, condensed",
          flag: "DESCRIPTION_NAMES_A_SOUP_MIXED_DISH_OR_SNACK_PRODUCT",
        },
        {
          description: "Spinach souffle",
          flag: "DESCRIPTION_NAMES_A_SOUP_MIXED_DISH_OR_SNACK_PRODUCT",
        },
        {
          description: "Snacks, shrimp cracker",
          flag: "DESCRIPTION_NAMES_A_SOUP_MIXED_DISH_OR_SNACK_PRODUCT",
        },
      ];

      for (const { description, flag } of cases) {
        expect(
          computeTriageFlags({
            description,
            foodCategory: "Vegetables and Vegetable Products",
            categoryIdBasis: "SOURCE_FOOD_CATEGORY",
          }),
          description
        ).toContain(flag);
      }
    });

    it("does not flag the generic foods the catalog exists for", () => {
      // `baby` and `Grade A` are the false positives that matter: `Spinach,
      // baby` and `Eggs, Grade A, Large` are foods the RD wants, and a flag on
      // them makes the flag column noise.
      for (const description of [
        "Broccoli, raw",
        "Spinach, baby",
        "Carrots, baby, raw",
        "Squash, zucchini, baby, raw",
        "Eggs, Grade A, Large, egg whole",
        "Beef, short loin (NY strip steak), raw",
        "Chickpeas (garbanzo beans, bengal gram), mature seeds, raw",
        "Yogurt, Greek, plain, nonfat",
        "Oil, olive, extra virgin",
        "Fish, cod, Atlantic, raw",
      ]) {
        expect(
          computeTriageFlags({
            description,
            foodCategory: "Vegetables and Vegetable Products",
            categoryIdBasis: "SOURCE_FOOD_CATEGORY",
          }),
          description
        ).toEqual([]);
      }
    });

    it("flags a prepared USDA group and a record carrying no category at all", () => {
      expect(
        computeTriageFlags({
          description: "A plain-looking description",
          foodCategory: "Sweets",
          categoryIdBasis: "SOURCE_FOOD_CATEGORY",
        })
      ).toEqual(["SOURCE_CATEGORY_IS_NOT_A_WHOLE_FOOD_GROUP"]);

      expect(
        computeTriageFlags({
          description: "A plain-looking description",
          foodCategory: null,
          categoryIdBasis: "SOURCE_FOOD_CATEGORY",
        })
      ).toEqual(["SOURCE_CATEGORY_MISSING"]);
    });

    it("the all-caps detector needs three letters, so acronym-free generic names pass", () => {
      expect(descriptionCarriesAllCapsBrandToken("TACO BELL, Nachos")).toBe(true);
      expect(descriptionCarriesAllCapsBrandToken("DENNY'S, golden fried shrimp")).toBe(true);
      expect(descriptionCarriesAllCapsBrandToken("ON THE BORDER, soft taco")).toBe(true);
      expect(descriptionCarriesAllCapsBrandToken("Beef, short loin (NY strip steak), raw")).toBe(
        false
      );
      expect(descriptionCarriesAllCapsBrandToken("Eggs, Grade A, Large, egg white")).toBe(false);
      expect(descriptionCarriesAllCapsBrandToken("Beans, Dry, Black (0% moisture)")).toBe(false);
    });

    it("flags are returned in declaration order, so an unchanged record re-runs to an identical file", () => {
      const flags = computeTriageFlags({
        description: "TACO BELL, Nachos with candy topping, industrial",
        foodCategory: "Fast Foods",
        categoryIdBasis: "COVERAGE_PLAN_SEARCH_TERM",
      });
      expect(flags).toEqual(TRIAGE_FLAGS.filter((flag) => flags.includes(flag)));
      expect(flags.length).toBeGreaterThan(3);
    });
  });

  describe("proposeCuration", () => {
    it("never returns a reviewer field", () => {
      // `reviewState` and `reviewerNote` have exactly one writer, the RD. The
      // tool's proposal cannot reach them, and no key here can be mistaken for
      // one. This is the same separation as fdc-source-exclusions.v1.json.
      const proposal = proposeCuration({
        description: "Broccoli, raw",
        foodCategory: "Vegetables and Vegetable Products",
        planCategoryId: "VEGETABLES",
      });
      expect(Object.keys(proposal).sort()).toEqual([
        "categoryId",
        "categoryIdBasis",
        "patternTags",
        "patternTagsBasis",
        "triageFlags",
      ]);
    });

    it("is a pure function of description, category and plan assignment", () => {
      const input = {
        description: "Fish, cod, Atlantic, raw",
        foodCategory: "Finfish and Shellfish Products",
        planCategoryId: "SEAFOOD",
      };
      expect(proposeCuration(input)).toEqual(proposeCuration(input));
      expect(proposeCuration(input)).toEqual({
        categoryId: "SEAFOOD",
        categoryIdBasis: "SOURCE_FOOD_CATEGORY",
        patternTags: ["OMNIVORE", "PESCATARIAN"] as EatingPattern[],
        patternTagsBasis: "SOURCE_FOOD_CATEGORY",
        triageFlags: [],
      });
    });

    it("the tool never writes REVIEWER_SET", () => {
      // That basis exists for the RD's own edits; a proposal claiming it would
      // put the tool's value in the reviewer's voice.
      const categories = [
        ...PLANT_CATEGORIES,
        ...ANIMAL_FLESH_CATEGORIES,
        ...FALLBACK_CATEGORIES,
        "Dairy and Egg Products",
        "Finfish and Shellfish Products",
        null,
      ];
      for (const foodCategory of categories) {
        const proposal = proposeCuration({
          description: "Any description",
          foodCategory,
          planCategoryId: "VEGETABLES",
        });
        expect(proposal.patternTagsBasis, String(foodCategory)).not.toBe("REVIEWER_SET");
        expect(proposal.categoryIdBasis, String(foodCategory)).not.toBe("REVIEWER_SET");
        expect(PATTERN_TAG_BASES).toContain(proposal.patternTagsBasis);
        expect(CATEGORY_ID_BASES).toContain(proposal.categoryIdBasis);
      }
    });
  });
});
