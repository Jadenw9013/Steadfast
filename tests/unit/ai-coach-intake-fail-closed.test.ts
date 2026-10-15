import { describe, expect, it } from "vitest";
import { checkMealComposition } from "@/lib/ai-coach/composition-feasibility";
import { deriveLegacyAllergyTokens } from "@/lib/ai-coach/intake-allergens";
import { getCurrentFoodCatalogVersion } from "@/lib/ai-coach/catalog/loader";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import type { AllergenDeclarations } from "@/lib/ai-coach/intake";

const FOOD_V = getCurrentFoodCatalogVersion();

/**
 * T-2024 — proves the derived-projection rule preserves the hard exclusion
 * that `checkMealComposition` actually enforces: a SESAME declaration (no
 * catalog tag yet, T-2004) fails closed, and a CRUSTACEAN_SHELLFISH
 * declaration correctly conflicts with a shellfish-tagged item rather than
 * being silently dropped by the projection.
 */
describe("T-2024 structured allergens still fail closed through the legacy projection", () => {
  it("a SESAME declaration projects to a token the catalog cannot verify -> UNVERIFIABLE_ALLERGY, feasible: false", () => {
    const declarations: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        {
          category: "SESAME",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
      ],
    };
    const tokens = deriveLegacyAllergyTokens(declarations);
    expect(tokens).toEqual(["SESAME"]);

    const result = checkMealComposition({
      components: [{ foodId: "broccoli-steamed", catalogVersion: FOOD_V, grams: 91 }],
      allergies: tokens,
      dietaryRestrictions: [],
      nutritionPermission: "ALLOW",
      policyVersion: ACTIVE_POLICY_VERSION,
    });
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    expect(result.reasons.some((reason) => reason.code === "UNVERIFIABLE_ALLERGY")).toBe(true);
  });

  it("a CRUSTACEAN_SHELLFISH declaration projects to SHELLFISH and conflicts with a shellfish-tagged item", () => {
    const declarations: AllergenDeclarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [
        {
          category: "CRUSTACEAN_SHELLFISH",
          specificity: null,
          kind: "ALLERGY",
          crossContactAvoidanceRequired: "YES",
        },
      ],
    };
    const tokens = deriveLegacyAllergyTokens(declarations);
    expect(tokens).toEqual(["SHELLFISH"]);

    const result = checkMealComposition({
      components: [{ foodId: "shrimp-cooked", catalogVersion: FOOD_V, grams: 85 }],
      allergies: tokens,
      dietaryRestrictions: [],
      nutritionPermission: "ALLOW",
      policyVersion: ACTIVE_POLICY_VERSION,
    });
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    expect(result.reasons.some((reason) => reason.code === "ALLERGEN_CONFLICT")).toBe(true);
  });

  it("T-2002 2026-09-25 lead decision: a DECLINED/UNKNOWN allergen status fails composition closed rather than reading as no known allergens", () => {
    const declined: AllergenDeclarations = { status: "DECLINED", noKnownAllergens: false, items: [] };
    const tokens = deriveLegacyAllergyTokens(declined);
    expect(tokens).not.toEqual([]); // the fail-open shape this decision forbids

    const result = checkMealComposition({
      components: [{ foodId: "broccoli-steamed", catalogVersion: FOOD_V, grams: 91 }],
      allergies: tokens,
      dietaryRestrictions: [],
      nutritionPermission: "ALLOW",
      policyVersion: ACTIVE_POLICY_VERSION,
    });
    expect(result.feasible).toBe(false);
    if (result.feasible) throw new Error("unreachable");
    expect(result.reasons.some((reason) => reason.code === "UNVERIFIABLE_ALLERGY")).toBe(true);
  });
});
