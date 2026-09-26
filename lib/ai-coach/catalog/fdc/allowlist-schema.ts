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

export const allowlistSchema = z
  .object({
    allowlistVersion: z.literal(1),
    market: z.literal("US"),
    curationState: z.enum(["ENGINEER_DRAFT", "REVIEWER_IN_PROGRESS", "REVIEWER_COMPLETE"]),
    generatedAt: z.string().datetime({ offset: true }),
    coveragePlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z.array(allowlistEntrySchema).min(1).max(400),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seenFdcIds = new Set<number>();
    const seenNames = new Set<string>();

    for (let i = 0; i < val.entries.length; i++) {
      const entry = val.entries[i];

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
  });

export type Allowlist = z.infer<typeof allowlistSchema>;
