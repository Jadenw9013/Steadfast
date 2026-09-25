import { describe, expect, it } from "vitest";
import {
  canonicalDeclarations,
  deriveLegacyAllergyTokens,
  deriveLegacyDietaryRestrictions,
  UNVERIFIABLE_ALLERGEN_STATUS_SENTINEL,
} from "@/lib/ai-coach/intake-allergens";
import type { AllergenDeclaration, AllergenDeclarations, DietaryPattern } from "@/lib/ai-coach/intake";

function item(overrides: Partial<AllergenDeclaration>): AllergenDeclaration {
  return {
    category: "MILK",
    specificity: null,
    kind: "ALLERGY",
    crossContactAvoidanceRequired: "YES",
    ...overrides,
  };
}

describe("T-2024 deriveLegacyAllergyTokens", () => {
  it("maps all ten categories to their legacy token, incl. SOYBEAN->SOY, CRUSTACEAN_SHELLFISH->SHELLFISH, SESAME->SESAME, OTHER->specificity", () => {
    const declarations: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        item({ category: "MILK" }),
        item({ category: "EGG" }),
        item({ category: "FISH", specificity: "salmon" }),
        item({ category: "CRUSTACEAN_SHELLFISH", specificity: "shrimp" }),
        item({ category: "TREE_NUT", specificity: "cashew" }),
        item({ category: "PEANUT" }),
        item({ category: "WHEAT" }),
        item({ category: "SOYBEAN" }),
        item({ category: "SESAME" }),
        item({ category: "OTHER", specificity: "sunflower seed" }),
      ],
    };
    const expectedTokens = [
      "MILK",
      "EGG",
      "FISH",
      "SHELLFISH",
      "TREE_NUT",
      "PEANUT",
      "WHEAT",
      "SOY",
      "SESAME",
      "sunflower seed",
    ].sort();
    expect(deriveLegacyAllergyTokens(declarations)).toEqual(expectedTokens);
  });

  it("sorts and de-duplicates the output", () => {
    const declarations: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        item({ category: "WHEAT" }),
        item({ category: "MILK" }),
        item({ category: "WHEAT" }),
      ],
    };
    expect(deriveLegacyAllergyTokens(declarations)).toEqual(["MILK", "WHEAT"]);
  });

  it("includes INTOLERANCE_OR_SENSITIVITY items, not just ALLERGY", () => {
    const declarations: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [item({ category: "MILK", kind: "INTOLERANCE_OR_SENSITIVITY" })],
    };
    expect(deriveLegacyAllergyTokens(declarations)).toEqual(["MILK"]);
  });

  it("returns an empty array for noKnownAllergens", () => {
    const declarations: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: true,
      items: [],
    };
    expect(deriveLegacyAllergyTokens(declarations)).toEqual([]);
  });

  it("T-2002 2026-09-25 lead decision: DECLINED or UNKNOWN status emits a fail-closed sentinel, never an empty (fail-open) list", () => {
    const declined: AllergenDeclarations = { status: "DECLINED", noKnownAllergens: false, items: [] };
    const unknown: AllergenDeclarations = { status: "UNKNOWN", noKnownAllergens: false, items: [] };
    expect(deriveLegacyAllergyTokens(declined)).toEqual([UNVERIFIABLE_ALLERGEN_STATUS_SENTINEL]);
    expect(deriveLegacyAllergyTokens(unknown)).toEqual([UNVERIFIABLE_ALLERGEN_STATUS_SENTINEL]);
  });
});

describe("T-2024 canonicalDeclarations", () => {
  it("is order-insensitive across items", () => {
    const a: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [item({ category: "WHEAT" }), item({ category: "MILK" })],
    };
    const b: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [item({ category: "MILK" }), item({ category: "WHEAT" })],
    };
    expect(canonicalDeclarations(a)).toEqual(canonicalDeclarations(b));
  });

  it("distinguishes a real content difference (a narrowing)", () => {
    const before: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [item({ category: "TREE_NUT", specificity: null })],
    };
    const after: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [item({ category: "TREE_NUT", specificity: "cashew" })],
    };
    expect(canonicalDeclarations(before)).not.toEqual(canonicalDeclarations(after));
  });
});

describe("T-2024 deriveLegacyDietaryRestrictions", () => {
  const base: DietaryPattern = {
    pattern: "VEGAN",
    otherLabel: null,
    mandatory: true,
    reason: "PREFERENCE",
    status: "CONFIRMED",
  };

  it("VEGAN + mandatory -> [VEGAN]", () => {
    expect(deriveLegacyDietaryRestrictions(base)).toEqual(["VEGAN"]);
  });

  it("LACTO_OVO_VEGETARIAN + mandatory -> [VEGETARIAN]", () => {
    expect(deriveLegacyDietaryRestrictions({ ...base, pattern: "LACTO_OVO_VEGETARIAN" })).toEqual([
      "VEGETARIAN",
    ]);
  });

  it("returns [] when mandatory is false, regardless of pattern", () => {
    expect(deriveLegacyDietaryRestrictions({ ...base, mandatory: false })).toEqual([]);
  });

  it("returns [] for a pattern with no legacy mapping", () => {
    expect(deriveLegacyDietaryRestrictions({ ...base, pattern: "PESCATARIAN" })).toEqual([]);
  });
});
