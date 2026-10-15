import type { RecipeComponent } from "./nutrition-totals";
import { inCodeFoodCatalogSource, type FoodCatalogSource } from "./catalog/food-source";
import { checkPolicyVersionUsable } from "./policy/policy-version";
import { allergenSchema, dietaryTagSchema, type Allergen, type DietaryTag } from "./catalog/schema";
import type { AiDomainPermission } from "@/app/generated/prisma/client";
import type { AllergenCategory, AllergenDeclarations } from "./intake-contract";
import { deriveLegacyAllergyTokens } from "./intake-allergens";

/**
 * A04 — deterministic feasible-composition check.
 *
 * A closed, policy-owned reason registry (docs/ai-coach/05: "closed
 * policy-owned registry, not arbitrary model text") rather than free
 * text, so a caller can act on *why* a composition was rejected instead
 * of just that it was. This never composes or substitutes content
 * itself — that is A07's job once a composition already passes here.
 */

export type FeasibilityReasonCode =
  | "NUTRITION_DOMAIN_NOT_ALLOWED"
  | "POLICY_UNKNOWN_VERSION"
  | "POLICY_VERSION_REVOKED"
  | "CATALOG_REFERENCE_INVALID"
  | "ALLERGEN_CONFLICT"
  | "UNVERIFIABLE_ALLERGY"
  | "DIETARY_RESTRICTION_UNSATISFIED";

export interface FeasibilityReason {
  code: FeasibilityReasonCode;
  detail?: Record<string, string>;
}

export type FeasibilityResult = { feasible: true } | { feasible: false; reasons: FeasibilityReason[] };

function normalizeFreeText(text: string): string {
  return text.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function matchAllergen(freeText: string): Allergen | null {
  const parsed = allergenSchema.safeParse(normalizeFreeText(freeText));
  return parsed.success ? parsed.data : null;
}

function matchDietaryTag(freeText: string): DietaryTag | null {
  const parsed = dietaryTagSchema.safeParse(normalizeFreeText(freeText));
  return parsed.success ? parsed.data : null;
}

const CATEGORY_BY_LEGACY_TOKEN: Record<string, AllergenCategory> = {
  MILK: "MILK",
  EGG: "EGG",
  PEANUT: "PEANUT",
  WHEAT: "WHEAT",
  SOY: "SOYBEAN",
  SOYBEAN: "SOYBEAN",
  TREE_NUT: "TREE_NUT",
  FISH: "FISH",
  SHELLFISH: "CRUSTACEAN_SHELLFISH",
  CRUSTACEAN_SHELLFISH: "CRUSTACEAN_SHELLFISH",
  SESAME: "SESAME",
};

export interface CheckMealCompositionInput {
  components: RecipeComponent[];
  allergies: string[];
  dietaryRestrictions: string[];
  nutritionPermission: AiDomainPermission;
  policyVersion: string;
  allergenDeclarations?: AllergenDeclarations;
  source?: FoodCatalogSource;
  /** T-2000's two-argument policy check, reached from the composed path.
   *  Omitted => the existing one-argument ACTIVE_POLICY_VERSION comparison. */
  runtimePolicyArtifactKey?: string;
}

export function checkMealComposition(input: CheckMealCompositionInput): FeasibilityResult {
  const reasons: FeasibilityReason[] = [];

  if (input.nutritionPermission !== "ALLOW") {
    reasons.push({ code: "NUTRITION_DOMAIN_NOT_ALLOWED" });
  }

  const policyCheck = checkPolicyVersionUsable(input.policyVersion, input.runtimePolicyArtifactKey);
  if (!policyCheck.usable) {
    reasons.push({
      code: policyCheck.error === "POLICY_REVOKED" ? "POLICY_VERSION_REVOKED" : "POLICY_UNKNOWN_VERSION",
    });
  }

  // Parse structured declarations or legacy allergies
  type DeclaredCheck = {
    category: AllergenCategory;
    crossContactRequired: boolean;
  };
  const structuredChecks: DeclaredCheck[] = [];
  const legacyAllergensToCheck: Allergen[] = [];

  if (input.allergenDeclarations) {
    if (input.allergenDeclarations.status !== "CONFIRMED") {
      reasons.push({
        code: "UNVERIFIABLE_ALLERGY",
        detail: { reason: "ALLERGEN_STATUS_NOT_CONFIRMED" },
      });
    } else if (!input.allergenDeclarations.noKnownAllergens) {
      for (const item of input.allergenDeclarations.items) {
        if (item.category === "OTHER") {
          reasons.push({
            code: "UNVERIFIABLE_ALLERGY",
            detail: { allergyText: item.specificity ?? "OTHER" },
          });
        } else {
          structuredChecks.push({
            category: item.category,
            crossContactRequired: item.crossContactAvoidanceRequired === "YES",
          });
        }
      }
    }

    // For legacy items without allergenFactsV2, derive legacy allergy tokens
    const derivedTokens = deriveLegacyAllergyTokens(input.allergenDeclarations);
    for (const token of derivedTokens) {
      const matched = matchAllergen(token);
      if (matched) {
        legacyAllergensToCheck.push(matched);
      } else {
        reasons.push({ code: "UNVERIFIABLE_ALLERGY", detail: { allergyText: token } });
      }
    }
  } else {
    for (const allergyText of input.allergies) {
      const normalized = normalizeFreeText(allergyText);
      const cat = CATEGORY_BY_LEGACY_TOKEN[normalized];
      if (cat) {
        structuredChecks.push({
          category: cat,
          crossContactRequired: false,
        });
      }

      const matched = matchAllergen(allergyText);
      if (matched) {
        legacyAllergensToCheck.push(matched);
      } else {
        reasons.push({ code: "UNVERIFIABLE_ALLERGY", detail: { allergyText } });
      }
    }
  }

  const requiredDietaryTags: DietaryTag[] = [];
  for (const restrictionText of input.dietaryRestrictions) {
    const matched = matchDietaryTag(restrictionText);
    if (matched) requiredDietaryTags.push(matched);
  }

  const catalogSource = input.source ?? inCodeFoodCatalogSource;

  for (const component of input.components) {
    const lookup = catalogSource.get(component.foodId, component.catalogVersion);
    if (!lookup.success) {
      reasons.push({ code: "CATALOG_REFERENCE_INVALID", detail: { foodId: component.foodId, error: lookup.error } });
      continue;
    }

    // Tri-state allergen evaluation if allergenFactsV2 is present
    if (lookup.item.allergenFactsV2) {
      for (const check of structuredChecks) {
        const catEntry = lookup.item.allergenFactsV2.categories.find(
          (c) => c.category === check.category
        );
        if (!catEntry || catEntry.presence === "UNKNOWN") {
          reasons.push({
            code: "UNVERIFIABLE_ALLERGY",
            detail: { foodId: component.foodId, allergen: check.category },
          });
        } else if (catEntry.presence === "PRESENT") {
          reasons.push({
            code: "ALLERGEN_CONFLICT",
            detail: { foodId: component.foodId, allergen: check.category },
          });
        } else if (catEntry.presence === "VERIFIED_ABSENT") {
          if (check.crossContactRequired && catEntry.crossContact !== "VERIFIED_ABSENT") {
            reasons.push({
              code: "UNVERIFIABLE_ALLERGY",
              detail: {
                foodId: component.foodId,
                allergen: check.category,
                crossContact: catEntry.crossContact,
              },
            });
          }
        }
      }
    } else {
      // Legacy item without allergenFactsV2: array semantics
      for (const allergen of legacyAllergensToCheck) {
        if (lookup.item.allergens.includes(allergen)) {
          reasons.push({ code: "ALLERGEN_CONFLICT", detail: { foodId: component.foodId, allergen } });
        }
      }
    }

    for (const tag of requiredDietaryTags) {
      if (!lookup.item.dietaryTags.includes(tag)) {
        reasons.push({ code: "DIETARY_RESTRICTION_UNSATISFIED", detail: { foodId: component.foodId, restriction: tag } });
      }
    }
  }

  return reasons.length === 0 ? { feasible: true } : { feasible: false, reasons };
}
