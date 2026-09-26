import { z } from "zod";
import type { FoodCatalogSource } from "./food-source";
import type { CatalogLookupError } from "./loader";

export const portionRangeSchema = z
  .object({
    minGrams: z.number().positive().max(3000),
    nominalGrams: z.number().positive().max(3000),
    maxGrams: z.number().positive().max(3000),
    rangeBasis: z.enum(["SOURCE_PORTION_SCALED", "DEFAULT_100G_BAND"]),
    sourcePortionText: z.string().max(160).nullable(), // the FDC household measure it came from
  })
  .strict()
  .refine((r) => r.minGrams <= r.nominalGrams && r.nominalGrams <= r.maxGrams, {
    message: "Portion range must satisfy minGrams <= nominalGrams <= maxGrams",
  });

export type PortionRange = z.infer<typeof portionRangeSchema>;

export const templateIngredientSchema = z
  .object({
    kind: z.literal("FOOD"),
    foodId: z.string().min(1).max(120),
    catalogVersion: z.string().min(1).max(120),
    state: z.enum(["RAW", "COOKED", "READY_TO_EAT"]),
    portion: portionRangeSchema,
    scaling: z.enum(["SCALES", "FIXED"]), // FIXED = seasonings/condiments, never scaled
    householdMeasure: z
      .object({
        text: z.string().min(1).max(160),
        gramWeight: z.number().positive(),
        provenance: z.literal("SOURCE_PORTION"),
      })
      .strict()
      .nullable(),
    purchaseUnit: z
      .object({
        unit: z.enum(["GRAM", "MILLILITRE", "EACH"]),
        gramsPerUnit: z.number().positive().nullable(), // null = UNKNOWN
        packSizeGrams: z.number().positive().nullable(), // null = UNKNOWN
        provenance: z.enum(["SOURCE_PORTION", "UNKNOWN"]),
      })
      .strict()
      .nullable(),
    substitutionGroupId: z.string().max(120).nullable(),
  })
  .strict();

export type TemplateIngredient = z.infer<typeof templateIngredientSchema>;

export const nestedComponentSchema = z
  .object({
    kind: z.literal("COMPONENT_TEMPLATE"),
    templateId: z.string().min(1).max(120), // must be a template with isComponent === true
    servings: z.number().positive().max(10),
  })
  .strict();

export type NestedComponent = z.infer<typeof nestedComponentSchema>;

export const mealTemplateSchema = z
  .object({
    id: z.string().min(1).max(120),
    version: z.number().int().positive(),
    name: z.string().min(1).max(120),
    isComponent: z.boolean(), // component templates are not scheduled directly
    slot: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "COMPONENT"]),
    patternTags: z.array(z.enum(["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN"])).min(1),
    budgetBand: z.enum(["LOW", "MODERATE", "FLEXIBLE"]), // = intake foodBudgetLevel
    prepTimeBand: z.enum(["UNDER_15", "MIN_15_30", "MIN_30_60", "OVER_60"]), // = T-2002 typicalPrepMinutesBand
    requiredEquipment: z.array(z.enum(["NONE", "MICROWAVE", "STOVETOP", "OVEN", "FULL_KITCHEN"])).min(1),
    requiredRefrigeration: z.enum(["NONE", "FRIDGE", "FRIDGE_AND_FREEZER"]),
    servings: z.number().positive().max(12),
    yieldGrams: z.number().positive().nullable(), // null = UNKNOWN; no yield factor is ever invented
    yieldMethod: z.enum(["SOURCE_REPORTED", "UNKNOWN"]),
    ingredients: z.array(z.union([templateIngredientSchema, nestedComponentSchema])).min(1).max(20),
    preparation: z.string().max(500), // plain steps; no food-safety or health claim
    reviewState: z.enum(["PROPOSED", "ACCEPTED"]),
    requiresReviewerPortion: z.boolean(), // true when any range is DEFAULT_100G_BAND
    notes: z.string().max(500).nullable(),
  })
  .strict();

export type MealTemplate = z.infer<typeof mealTemplateSchema>;

export const substitutionGroupSchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    basis: z.enum(["ROLE_IN_MEAL"]), // grouping is culinary role, never "nutritionally equivalent"
    memberFoodIds: z.array(z.string().min(1).max(120)).min(2).max(30),
    patternTags: z.array(z.enum(["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN"])).min(1),
    reviewState: z.enum(["PROPOSED", "ACCEPTED"]),
    note: z.string().max(300).nullable(),
  })
  .strict();

export type SubstitutionGroup = z.infer<typeof substitutionGroupSchema>;

export const mealTemplateSetSchema = z
  .object({
    artifactKey: z.string().min(1).max(160),
    version: z.number().int().positive(),
    foodCatalogRef: z.object({ artifactKey: z.string(), version: z.number().int().positive() }).strict(),
    substitutionGroups: z.array(substitutionGroupSchema).max(100),
    templates: z.array(mealTemplateSchema).min(1).max(200),
  })
  .strict()
  .superRefine((set, ctx) => {
    // 1. Unique template IDs
    const templateIds = new Set<string>();
    const templatesById = new Map<string, MealTemplate>();
    for (let i = 0; i < set.templates.length; i++) {
      const t = set.templates[i];
      if (templateIds.has(t.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["templates", i, "id"],
          message: `Duplicate template id: ${t.id}`,
        });
      }
      templateIds.add(t.id);
      templatesById.set(t.id, t);
    }

    // 2. Unique substitution group IDs
    const subGroupIds = new Set<string>();
    for (let i = 0; i < set.substitutionGroups.length; i++) {
      const g = set.substitutionGroups[i];
      if (subGroupIds.has(g.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["substitutionGroups", i, "id"],
          message: `Duplicate substitutionGroup id: ${g.id}`,
        });
      }
      subGroupIds.add(g.id);
    }

    // 3. Template-level constraints
    for (let i = 0; i < set.templates.length; i++) {
      const t = set.templates[i];

      // slot === "COMPONENT" iff isComponent === true
      if (t.isComponent && t.slot !== "COMPONENT") {
        ctx.addIssue({
          code: "custom",
          path: ["templates", i, "slot"],
          message: "slot must be COMPONENT when isComponent is true",
        });
      }
      if (!t.isComponent && t.slot === "COMPONENT") {
        ctx.addIssue({
          code: "custom",
          path: ["templates", i, "slot"],
          message: "slot cannot be COMPONENT when isComponent is false",
        });
      }

      let hasDefault100gBand = false;
      for (let j = 0; j < t.ingredients.length; j++) {
        const ing = t.ingredients[j];
        if (ing.kind === "FOOD") {
          if (ing.portion.rangeBasis === "DEFAULT_100G_BAND") {
            hasDefault100gBand = true;
          }
          if (ing.substitutionGroupId !== null && !subGroupIds.has(ing.substitutionGroupId)) {
            ctx.addIssue({
              code: "custom",
              path: ["templates", i, "ingredients", j, "substitutionGroupId"],
              message: `substitutionGroupId '${ing.substitutionGroupId}' does not exist`,
            });
          }
        } else if (ing.kind === "COMPONENT_TEMPLATE") {
          if (t.isComponent) {
            ctx.addIssue({
              code: "custom",
              path: ["templates", i, "ingredients", j, "kind"],
              message: `component template '${t.id}' cannot contain a nested component template (one level only)`,
            });
          }
          const target = templatesById.get(ing.templateId);
          if (!target) {
            ctx.addIssue({
              code: "custom",
              path: ["templates", i, "ingredients", j, "templateId"],
              message: `nested template '${ing.templateId}' does not exist`,
            });
          } else {
            if (!target.isComponent) {
              ctx.addIssue({
                code: "custom",
                path: ["templates", i, "ingredients", j, "templateId"],
                message: `nested template '${ing.templateId}' must have isComponent === true`,
              });
            }
            // No nested template itself contains a nested component (one level only)
            const nestedHasNested = target.ingredients.some(
              (nestedIng) => nestedIng.kind === "COMPONENT_TEMPLATE"
            );
            if (nestedHasNested) {
              ctx.addIssue({
                code: "custom",
                path: ["templates", i, "ingredients", j, "templateId"],
                message: `nested template '${ing.templateId}' cannot itself contain a nested component (one level only)`,
              });
            }
          }
        }
      }

      // requiresReviewerPortion true iff some range is DEFAULT_100G_BAND
      if (t.requiresReviewerPortion !== hasDefault100gBand) {
        ctx.addIssue({
          code: "custom",
          path: ["templates", i, "requiresReviewerPortion"],
          message: `requiresReviewerPortion must be ${hasDefault100gBand} because hasDefault100gBand is ${hasDefault100gBand}`,
        });
      }
    }
  });

export type MealTemplateSet = z.infer<typeof mealTemplateSetSchema>;

export type TemplateValidationError = {
  templateId: string;
  foodId: string;
  catalogVersion: string;
  error: CatalogLookupError;
};

export type SubstitutionGroupValidationError = {
  groupId: string;
  foodId: string;
  catalogVersion: string;
  error: CatalogLookupError;
};

export type TemplateSetValidationResult = {
  valid: boolean;
  templateErrors: TemplateValidationError[];
  substitutionGroupErrors: SubstitutionGroupValidationError[];
};

/**
 * Validates all food ingredient references and substitution group members
 * in a template set against a catalog source.
 */
export function validateTemplateSetAgainstCatalog(
  set: MealTemplateSet,
  source: FoodCatalogSource
): TemplateSetValidationResult {
  const templateErrors: TemplateValidationError[] = [];
  const templatesById = new Map<string, MealTemplate>();
  for (const t of set.templates) {
    templatesById.set(t.id, t);
  }

  for (const template of set.templates) {
    for (const ing of template.ingredients) {
      if (ing.kind === "FOOD") {
        const lookup = source.get(ing.foodId, ing.catalogVersion);
        if (!lookup.success) {
          templateErrors.push({
            templateId: template.id,
            foodId: ing.foodId,
            catalogVersion: ing.catalogVersion,
            error: lookup.error,
          });
        }
      } else if (ing.kind === "COMPONENT_TEMPLATE") {
        const target = templatesById.get(ing.templateId);
        if (target) {
          for (const nestedIng of target.ingredients) {
            if (nestedIng.kind === "FOOD") {
              const lookup = source.get(nestedIng.foodId, nestedIng.catalogVersion);
              if (!lookup.success) {
                templateErrors.push({
                  templateId: template.id,
                  foodId: nestedIng.foodId,
                  catalogVersion: nestedIng.catalogVersion,
                  error: lookup.error,
                });
              }
            }
          }
        }
      }
    }
  }

  const substitutionGroupErrors: SubstitutionGroupValidationError[] = [];
  for (const group of set.substitutionGroups) {
    for (const foodId of group.memberFoodIds) {
      const lookup = source.get(foodId, source.catalogVersion);
      if (!lookup.success) {
        substitutionGroupErrors.push({
          groupId: group.id,
          foodId,
          catalogVersion: source.catalogVersion,
          error: lookup.error,
        });
      }
    }
  }

  return {
    valid: templateErrors.length === 0 && substitutionGroupErrors.length === 0,
    templateErrors,
    substitutionGroupErrors,
  };
}
