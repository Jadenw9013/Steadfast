import type { AllergenCategory, AllergenDeclarations, DietaryPattern } from "./intake-contract";

/**
 * T-2002/T-2024 — the single writer of the derived legacy `allergies` and
 * `dietaryRestrictions` arrays. Pure, no DB, no network I/O. Both
 * `ALLERGIES` (v2 shape) and `CONFIRM_INTAKE` (v2) call these functions
 * before writing — never compute the legacy arrays anywhere else.
 */

/** Default state when neither a confirmed profile nor a draft has ever
 * recorded a v2 allergen declaration. Mirrors the ALLERGIES command's
 * `previous` default and the `dietaryPattern`-less confirm precondition. */
export const EMPTY_ALLERGEN_DECLARATIONS: AllergenDeclarations = {
  status: "UNKNOWN",
  noKnownAllergens: false,
  items: [],
};

/**
 * The single translation table between T-2002's nine catalog allergen
 * categories and the legacy exclusion tokens that `matchAllergen`
 * (`composition-feasibility.ts`) and `lib/ai-coach/catalog/schema.ts`'s
 * `allergenSchema` speak. Exported for T-2035's FDC mapper, which writes
 * `allergenFacts.contains` in the *legacy* vocabulary so a future comparison
 * against a declared token cannot miss (review r1, finding F1). `OTHER` is
 * deliberately unmapped — it must fail closed.
 */
export const LEGACY_TOKEN_BY_CATEGORY: Partial<Record<AllergenCategory, string>> = {
  MILK: "MILK",
  EGG: "EGG",
  PEANUT: "PEANUT",
  WHEAT: "WHEAT",
  SOYBEAN: "SOY",
  TREE_NUT: "TREE_NUT",
  FISH: "FISH",
  CRUSTACEAN_SHELLFISH: "SHELLFISH",
  SESAME: "SESAME",
};

/**
 * T-2002 2026-09-25 lead decision (contract amendment, recorded in
 * T-2002's log): a `DECLINED`/`UNKNOWN` allergen status must fail closed
 * for meal composition, never read downstream as "no known allergens."
 * This sentinel deliberately matches no `allergenSchema` value, so
 * `matchAllergen` (`composition-feasibility.ts`) returns `null` and the
 * composition fails closed with `UNVERIFIABLE_ALLERGY` — exactly the same
 * fail-closed path an unmapped free-text allergy already takes. Applies
 * server-side only — this function is the composer's read path, not a
 * client-facing label.
 *
 * Known, accepted consequence (T-2024 review round 3, MINOR 6 / parity
 * MINOR 10 — do not "fix" by changing the projection): `getAiWorkspace`
 * (`lib/queries/ai-coach.ts`) returns `confirmedIntake`/`draft` raw, and
 * the shipped pre-T-2025 iOS build renders `allergies` into its v1 intake
 * form's free-text field. A client with a v2 profile whose allergen status
 * is DECLINED/UNKNOWN can therefore see this literal string in the
 * Allergies box on an old app build (degraded, not crashed — the new
 * ALLERGIES/CONFIRM_INTAKE v1 guards then correctly reject any edit of
 * that stale state). Recorded in `docs/ai-coach/14-Handoff-Status.md` for
 * the release packet; T-2004 must keep this token unmapped, never treat it
 * as a real category to "clean up."
 */
export const UNVERIFIABLE_ALLERGEN_STATUS_SENTINEL = "UNVERIFIABLE_ALLERGEN_STATUS_NOT_CONFIRMED";

/**
 * Deterministic, sorted, de-duplicated legacy exclusion-token list. Both
 * `ALLERGY` and `INTOLERANCE_OR_SENSITIVITY` items project into the token
 * list — the legacy array is an *exclusion token list*, not an allergy
 * list, and today's free-text field already behaves that way. `OTHER` maps
 * to its raw `specificity`, which `matchAllergen` cannot resolve to a known
 * catalog tag, so `composition-feasibility.ts` correctly emits
 * `UNVERIFIABLE_ALLERGY` and fails closed — by design, until T-2004 extends
 * the catalog.
 */
export function deriveLegacyAllergyTokens(declarations: AllergenDeclarations): string[] {
  if (declarations.status !== "CONFIRMED") return [UNVERIFIABLE_ALLERGEN_STATUS_SENTINEL];
  const tokens = declarations.items
    .map((item) => (item.category === "OTHER" ? (item.specificity ?? "") : LEGACY_TOKEN_BY_CATEGORY[item.category]))
    .filter((token): token is string => Boolean(token && token.length > 0));
  return Array.from(new Set(tokens)).sort();
}

/** `VEGAN` -> `["VEGAN"]`, `LACTO_OVO_VEGETARIAN` -> `["VEGETARIAN"]`,
 * everything else `[]`, and only when the pattern is `mandatory` (a
 * preference is never enforced as a hard exclusion). */
export function deriveLegacyDietaryRestrictions(pattern: DietaryPattern): string[] {
  if (!pattern.mandatory) return [];
  if (pattern.pattern === "VEGAN") return ["VEGAN"];
  if (pattern.pattern === "LACTO_OVO_VEGETARIAN") return ["VEGETARIAN"];
  return [];
}

/** Order-insensitive canonical form of an `allergenDeclarations` value for
 * content hashing: sorts `items` by `(category, specificity ?? "", kind)`.
 * `contentHash`'s underlying `canonicalJson` already sorts object keys at
 * every level, so this only needs to normalize array order. Accepts
 * `unknown` because callers read this off raw stored JSON (draft/confirmed
 * intake), not always a schema-validated value. */
export function canonicalDeclarations(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as { status?: unknown; noKnownAllergens?: unknown; items?: unknown };
  const items = Array.isArray(record.items) ? record.items : [];
  const sortKey = (item: unknown) => {
    const declaration = item as { category?: unknown; specificity?: unknown; kind?: unknown };
    return JSON.stringify([
      declaration.category ?? "",
      declaration.specificity ?? "",
      declaration.kind ?? "",
    ]);
  };
  const sortedItems = [...items].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return {
    status: record.status,
    noKnownAllergens: record.noKnownAllergens,
    items: sortedItems,
  };
}
