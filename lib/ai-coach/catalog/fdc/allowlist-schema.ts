import { z } from "zod";
import { allergenCategorySchema } from "@/lib/ai-coach/artifacts/schema";
import {
  CATEGORY_ID_BASES,
  EATING_PATTERNS,
  PATTERN_TAG_BASES,
  TRIAGE_FLAGS,
  derivePatternTags,
} from "./curation";

/**
 * T-2016 — `singleIngredientWholeFood` is deliberately **not** a field here.
 *
 * It was `true` on 245 of 245 entries, including `TACO BELL, Nachos`,
 * `Candies, nougat, with almonds` and
 * `Oil, industrial, canola (partially hydrogenated) oil for deep fat frying`.
 * The allergen rule that once read it was removed in the T-2035 repair and a
 * unit test pins that toggling it changed no fact, so it was an unverified claim
 * about every food with no reader left. A field nobody reads that asserts
 * something unverified is strictly a liability. `.strict()` means an allowlist
 * that still carries it does not parse, which is how it stays gone.
 */
export const allowlistEntrySchema = z
  .object({
    fdcId: z.number().int().positive(),
    dataType: z.enum(["Foundation", "SR Legacy"]), // hard v1 fence; anything else is an error
    canonicalName: z.string().trim().min(1).max(240), // human-chosen, never raw FDC description
    synonyms: z.array(z.string().trim().min(1).max(120)).max(10),
    /**
     * The record's own USDA `foodCategory`, verbatim, or `null` when the record
     * carried none. It is the input `categoryId` and `patternTags` are derived
     * from, so the RD can see the basis of both without opening the API.
     */
    sourceFoodCategory: z.string().trim().min(1).max(160).nullable(),
    categoryId: z.string().regex(/^[A-Z][A-Z0-9_]*$/), // must exist in the coverage plan
    /** Which input produced `categoryId`. See `curation.ts`. */
    categoryIdBasis: z.enum(CATEGORY_ID_BASES),
    foodState: z.enum(["RAW", "COOKED", "PREPARED", "NOT_APPLICABLE"]),
    patternTags: z.array(z.enum(EATING_PATTERNS)).min(1),
    /**
     * Whether `patternTags` was derived from an unambiguous USDA food category
     * or fell back to omnivore-only. An entry that fell back is not a claim
     * that the food is omnivore-only; it is a claim that the category did not
     * establish the set.
     */
    patternTagsBasis: z.enum(PATTERN_TAG_BASES),
    /**
     * Machine-written triage flags. The tool's field; `reviewState` is the
     * reviewer's, and the two never mix — same separation as
     * `fdc-source-exclusions.v1.json`. Recomputed on every `--propose` run, so
     * a hand-edit here is overwritten rather than trusted.
     */
    triageFlags: z.array(z.enum(TRIAGE_FLAGS)).max(TRIAGE_FLAGS.length),
    ownAllergenCategories: z.array(allergenCategorySchema).max(9), // e.g. ["MILK"] for milk
    reviewState: z.enum(["PROPOSED", "ACCEPTED", "STRUCK"]),
    reviewerNote: z.string().max(500).nullable(),
  })
  .strict();

export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

export const coveragePlanCategorySchema = z
  .object({
    categoryId: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    targetCount: z.number().int().positive(),
    searchTerms: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const coveragePlanSchema = z
  .object({
    planVersion: z.literal(1),
    market: z.literal("US"),
    categories: z.array(coveragePlanCategorySchema).min(1),
  })
  .strict();

export type CoveragePlan = z.infer<typeof coveragePlanSchema>;

const allowlistBaseSchema = z
  .object({
    allowlistVersion: z.literal(1),
    market: z.literal("US"),
    curationState: z.enum(["ENGINEER_DRAFT", "REVIEWER_IN_PROGRESS", "REVIEWER_COMPLETE"]),
    generatedAt: z.string().datetime({ offset: true }),
    coveragePlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z.array(allowlistEntrySchema).min(1).max(400),
  })
  .strict();

/**
 * Structural allowlist validation: unique `fdcId`, unique `canonicalName`.
 * `categoryId` is only checked for *shape* here, because this module is pure
 * (no fs) and the coverage plan lives in a file. Use
 * {@link allowlistSchemaForPlan} wherever the plan is available — the CLI
 * always has it — so an entry pointing at a category the plan does not define
 * is rejected rather than silently ingested.
 */
export const allowlistSchema = allowlistBaseSchema.superRefine((val, ctx) => {
  checkAllowlistInvariants(val, ctx, null);
});

/**
 * The same schema plus the spec's "categoryId is known" check, bound to a
 * parsed coverage plan (review r1, MINOR 2).
 */
export function allowlistSchemaForPlan(plan: CoveragePlan) {
  const knownCategoryIds = new Set(plan.categories.map((category) => category.categoryId));
  return allowlistBaseSchema.superRefine((val, ctx) => {
    checkAllowlistInvariants(val, ctx, knownCategoryIds);
  });
}

function checkAllowlistInvariants(
  val: z.infer<typeof allowlistBaseSchema>,
  ctx: z.RefinementCtx,
  knownCategoryIds: ReadonlySet<string> | null
): void {
  const seenFdcIds = new Set<number>();
  const seenNames = new Set<string>();

  for (let i = 0; i < val.entries.length; i++) {
    const entry = val.entries[i];

    if (knownCategoryIds && !knownCategoryIds.has(entry.categoryId)) {
      ctx.addIssue({
        code: "custom",
        path: ["entries", i, "categoryId"],
        message: `Unknown categoryId '${entry.categoryId}': not defined in the coverage plan`,
      });
    }

    if (seenFdcIds.has(entry.fdcId)) {
      ctx.addIssue({
        code: "custom",
        path: ["entries", i, "fdcId"],
        message: `Duplicate fdcId: ${entry.fdcId}`,
      });
    }
    seenFdcIds.add(entry.fdcId);

    const normalizedName = entry.canonicalName.toLowerCase();
    if (seenNames.has(normalizedName)) {
      ctx.addIssue({
        code: "custom",
        path: ["entries", i, "canonicalName"],
        message: `Duplicate canonicalName: ${entry.canonicalName}`,
      });
    }
    seenNames.add(normalizedName);

    checkDerivationIsReproducible(entry, i, ctx);
  }
}

/**
 * T-2016 — a stated basis must be reproducible from the stated input.
 *
 * `patternTagsBasis: "SOURCE_FOOD_CATEGORY"` is a claim that the record's own
 * `sourceFoodCategory` produced these tags. Here that claim is re-derived and
 * compared, so an entry cannot carry a derivation the recorded category does
 * not support — including a hand-edited one. `"FALLBACK_OMNIVORE_ONLY"` is the
 * matching claim in the other direction: the category established nothing, so
 * the tags are omnivore-only and nothing else.
 *
 * A reviewer who wants different tags sets `"REVIEWER_SET"`, which is exempt:
 * it says the value is theirs rather than the category's, which is exactly the
 * distinction this check exists to keep visible.
 */
function checkDerivationIsReproducible(
  entry: z.infer<typeof allowlistEntrySchema>,
  index: number,
  ctx: z.RefinementCtx
): void {
  if (entry.patternTagsBasis === "REVIEWER_SET") return;

  const derived = derivePatternTags(entry.sourceFoodCategory);

  if (derived.basis !== entry.patternTagsBasis) {
    ctx.addIssue({
      code: "custom",
      path: ["entries", index, "patternTagsBasis"],
      message:
        `patternTagsBasis '${entry.patternTagsBasis}' is not what sourceFoodCategory ` +
        `'${entry.sourceFoodCategory ?? "(none)"}' derives ('${derived.basis}'). ` +
        `Re-run --propose, or set REVIEWER_SET if this is the reviewer's own value.`,
    });
    return;
  }

  const stated = [...entry.patternTags].sort().join(",");
  const expected = [...derived.patternTags].sort().join(",");
  if (stated !== expected) {
    ctx.addIssue({
      code: "custom",
      path: ["entries", index, "patternTags"],
      message:
        `patternTags [${stated}] claims basis '${entry.patternTagsBasis}' but ` +
        `sourceFoodCategory '${entry.sourceFoodCategory ?? "(none)"}' derives [${expected}]. ` +
        `Set REVIEWER_SET if this is the reviewer's own value.`,
    });
  }
}

export type Allowlist = z.infer<typeof allowlistSchema>;
