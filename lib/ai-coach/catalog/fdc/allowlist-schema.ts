import { z } from "zod";
import { allergenCategorySchema } from "@/lib/ai-coach/artifacts/schema";

export const allowlistEntrySchema = z
  .object({
    fdcId: z.number().int().positive(),
    dataType: z.enum(["Foundation", "SR Legacy"]), // hard v1 fence; anything else is an error
    canonicalName: z.string().trim().min(1).max(240), // human-chosen, never raw FDC description
    synonyms: z.array(z.string().trim().min(1).max(120)).max(10),
    categoryId: z.string().regex(/^[A-Z][A-Z0-9_]*$/), // must exist in the coverage plan
    foodState: z.enum(["RAW", "COOKED", "PREPARED", "NOT_APPLICABLE"]),
    singleIngredientWholeFood: z.boolean(),
    patternTags: z
      .array(z.enum(["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN"]))
      .min(1),
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
  }
}

export type Allowlist = z.infer<typeof allowlistSchema>;
