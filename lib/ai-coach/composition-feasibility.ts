import type { RecipeComponent } from "./nutrition-totals";
import { getFoodItem } from "./catalog/loader";
import { checkPolicyVersionUsable } from "./policy/policy-version";
import { allergenSchema, dietaryTagSchema, type Allergen, type DietaryTag } from "./catalog/schema";
import type { AiDomainPermission } from "@/app/generated/prisma/client";

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

export interface CheckMealCompositionInput {
  components: RecipeComponent[];
  allergies: string[];
  dietaryRestrictions: string[];
  nutritionPermission: AiDomainPermission;
  policyVersion: string;
}

export function checkMealComposition(input: CheckMealCompositionInput): FeasibilityResult {
  const reasons: FeasibilityReason[] = [];

  if (input.nutritionPermission !== "ALLOW") {
    reasons.push({ code: "NUTRITION_DOMAIN_NOT_ALLOWED" });
  }

  const policyCheck = checkPolicyVersionUsable(input.policyVersion);
  if (!policyCheck.usable) {
    reasons.push({ code: policyCheck.error === "POLICY_REVOKED" ? "POLICY_VERSION_REVOKED" : "POLICY_UNKNOWN_VERSION" });
  }

  // A free-text allergy/restriction this catalog cannot map to a known
  // structured tag can never be verified as satisfied — conservatively
  // block rather than silently skip the check (V19: "concealed allergy
  // ingredient").
  const declaredAllergens: Allergen[] = [];
  for (const allergyText of input.allergies) {
    const matched = matchAllergen(allergyText);
    if (matched) {
      declaredAllergens.push(matched);
    } else {
      reasons.push({ code: "UNVERIFIABLE_ALLERGY", detail: { allergyText } });
    }
  }

  const requiredDietaryTags: DietaryTag[] = [];
  for (const restrictionText of input.dietaryRestrictions) {
    const matched = matchDietaryTag(restrictionText);
    if (matched) requiredDietaryTags.push(matched);
    // An unmapped dietary restriction (e.g. a free-text preference with no
    // structured equivalent) has no catalog tag to check against; it is
    // not a safety concern the way an unmapped allergy is, so it is
    // simply not enforceable here rather than blocking composition.
  }

  for (const component of input.components) {
    const lookup = getFoodItem(component.foodId, component.catalogVersion);
    if (!lookup.success) {
      reasons.push({ code: "CATALOG_REFERENCE_INVALID", detail: { foodId: component.foodId, error: lookup.error } });
      continue;
    }

    for (const allergen of declaredAllergens) {
      if (lookup.item.allergens.includes(allergen)) {
        reasons.push({ code: "ALLERGEN_CONFLICT", detail: { foodId: component.foodId, allergen } });
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
