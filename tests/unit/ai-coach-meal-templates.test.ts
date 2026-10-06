import { describe, expect, it } from "vitest";
import {
  loadDraftUnsignedMealTemplates,
  loadDraftUnsignedFoodCatalog,
  loadDraftUnsignedFoodCatalogV2,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import { sourcedFoodCatalogSource } from "@/lib/ai-coach/catalog/food-source";
import {
  mealTemplateSetSchema,
  validateTemplateSetAgainstCatalog,
  type MealTemplate,
} from "@/lib/ai-coach/catalog/meal-template-schema";

const draftTemplatesFile = loadDraftUnsignedMealTemplates();
const draftCatalogFile = loadDraftUnsignedFoodCatalog();
const catalogSource = sourcedFoodCatalogSource(draftCatalogFile.content);

describe("A07 — meal template dataset contract and invariants", () => {
  it("loads and parses the checked-in draft meal templates file", () => {
    expect(draftTemplatesFile.fileSchemaVersion).toBe(1);
    expect(draftTemplatesFile.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    expect(draftTemplatesFile.content.templates.length).toBeGreaterThan(0);
  });

  it("contains between 30 and 60 non-component meal templates", () => {
    const nonComponents = draftTemplatesFile.content.templates.filter((t) => !t.isComponent);
    expect(nonComponents.length).toBeGreaterThanOrEqual(30);
    expect(nonComponents.length).toBeLessThanOrEqual(60);
  });

  it("ensures every template and substitution group ships reviewState === PROPOSED", () => {
    for (const template of draftTemplatesFile.content.templates) {
      expect(template.reviewState, `template ${template.id} reviewState`).toBe("PROPOSED");
    }
    for (const group of draftTemplatesFile.content.substitutionGroups) {
      expect(group.reviewState, `substitution group ${group.id} reviewState`).toBe("PROPOSED");
    }
  });

  it("validates template set against draft catalog with zero errors", () => {
    const result = validateTemplateSetAgainstCatalog(draftTemplatesFile.content, catalogSource);
    expect(result.valid).toBe(true);
    expect(result.templateErrors).toEqual([]);
    expect(result.substitutionGroupErrors).toEqual([]);
  });

  it("ensures every substitution group has >= 2 members and all members resolve in catalog", () => {
    for (const group of draftTemplatesFile.content.substitutionGroups) {
      expect(group.memberFoodIds.length, `group ${group.id} member count`).toBeGreaterThanOrEqual(
        2
      );
      for (const foodId of group.memberFoodIds) {
        const lookup = catalogSource.get(foodId, catalogSource.catalogVersion);
        expect(lookup.success, `group ${group.id} member foodId ${foodId}`).toBe(true);
      }
    }
  });

  it("enforces component nesting rules and fails on two-level nesting", () => {
    // Check that existing templates satisfy single-level nesting
    const componentMap = new Map(
      draftTemplatesFile.content.templates.filter((t) => t.isComponent).map((t) => [t.id, t])
    );

    for (const template of draftTemplatesFile.content.templates) {
      for (const ing of template.ingredients) {
        if (ing.kind === "COMPONENT_TEMPLATE") {
          const comp = componentMap.get(ing.templateId);
          expect(comp, `component ${ing.templateId} exists`).toBeDefined();
          expect(comp?.isComponent).toBe(true);
          // Nested component must not contain another nested component
          for (const nestedIng of comp!.ingredients) {
            expect(nestedIng.kind).toBe("FOOD");
          }
        }
      }
    }

    // Two-level nesting fixture must fail schema parse
    const invalidTwoLevelSet = {
      ...draftTemplatesFile.content,
      templates: [
        ...draftTemplatesFile.content.templates,
        {
          id: "comp-level-2",
          version: 1,
          name: "Illegal Second Level Component",
          isComponent: true,
          slot: "COMPONENT",
          patternTags: ["OMNIVORE"],
          budgetBand: "LOW",
          prepTimeBand: "UNDER_15",
          requiredEquipment: ["NONE"],
          requiredRefrigeration: "NONE",
          servings: 1,
          yieldGrams: null,
          yieldMethod: "UNKNOWN",
          ingredients: [
            {
              kind: "COMPONENT_TEMPLATE",
              templateId: "comp-steamed-broccoli",
              servings: 1,
            },
          ],
          preparation: "Illegal nested component.",
          reviewState: "PROPOSED",
          requiresReviewerPortion: false,
          notes: null,
        },
      ],
    };

    expect(() => mealTemplateSetSchema.parse(invalidTwoLevelSet)).toThrow();
  });

  it("covers the 3 patterns x 4 slots matrix with at least one template per cell", () => {
    const patterns = ["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN"] as const;
    const slots = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;

    for (const pattern of patterns) {
      for (const slot of slots) {
        const matches = draftTemplatesFile.content.templates.filter(
          (t) => !t.isComponent && t.slot === slot && t.patternTags.includes(pattern)
        );
        expect(
          matches.length,
          `Coverage matrix gap at pattern=${pattern}, slot=${slot}`
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("verifies preparation and notes contain none of the banned substrings", () => {
    const bannedSubstrings = [
      "temperature",
      "°",
      "safe",
      "healthy",
      "balanced",
      "recommended",
      "should eat",
      "nutritious",
      "serving size",
    ];
    const bannedRegexes = [/\d+\s*kcal/i, /\d+\s*g\s+of\s+protein/i];

    for (const template of draftTemplatesFile.content.templates) {
      const texts = [template.preparation, template.notes ?? ""].filter(Boolean);
      for (const text of texts) {
        const lower = text.toLowerCase();
        for (const banned of bannedSubstrings) {
          expect(
            lower.includes(banned.toLowerCase()),
            `Template ${template.id} contains banned substring "${banned}" in: "${text}"`
          ).toBe(false);
        }
        for (const regex of bannedRegexes) {
          expect(
            regex.test(text),
            `Template ${template.id} matches banned pattern ${regex} in: "${text}"`
          ).toBe(false);
        }
      }
    }
  });

  it("enforces requiresReviewerPortion iff a direct food range is a fallback or exceeds 300g", () => {
    for (const template of draftTemplatesFile.content.templates) {
      const needsReviewerPortion = template.ingredients.some(
        (ing) =>
          ing.kind === "FOOD" &&
          (ing.portion.rangeBasis === "DEFAULT_100G_BAND" || ing.portion.maxGrams > 300)
      );
      expect(
        template.requiresReviewerPortion,
        `Template ${template.id} requiresReviewerPortion iff it has a fallback or >300g range`
      ).toBe(needsReviewerPortion);
    }
  });

  it("rejects either direction of the requiresReviewerPortion iff invariant", () => {
    const missingRequiredFlag = JSON.parse(JSON.stringify(draftTemplatesFile.content));
    const bulkTemplate = missingRequiredFlag.templates.find(
      (template: MealTemplate) =>
        template.requiresReviewerPortion &&
        template.ingredients.some(
          (ingredient) => ingredient.kind === "FOOD" && ingredient.portion.maxGrams > 300
        )
    );
    expect(bulkTemplate).toBeDefined();
    bulkTemplate.requiresReviewerPortion = false;
    expect(() => mealTemplateSetSchema.parse(missingRequiredFlag)).toThrow();

    const staleFlag = JSON.parse(JSON.stringify(draftTemplatesFile.content));
    const ordinaryTemplate = staleFlag.templates.find(
      (template: MealTemplate) => !template.requiresReviewerPortion
    );
    expect(ordinaryTemplate).toBeDefined();
    ordinaryTemplate.requiresReviewerPortion = true;
    expect(() => mealTemplateSetSchema.parse(staleFlag)).toThrow();
  });

  it("ensures minGrams <= nominalGrams <= maxGrams and sourcePortionText non-null for SOURCE_PORTION_SCALED", () => {
    for (const template of draftTemplatesFile.content.templates) {
      for (const ing of template.ingredients) {
        if (ing.kind === "FOOD") {
          const { minGrams, nominalGrams, maxGrams, rangeBasis, sourcePortionText } = ing.portion;
          expect(minGrams).toBeLessThanOrEqual(nominalGrams);
          expect(nominalGrams).toBeLessThanOrEqual(maxGrams);
          if (rangeBasis === "SOURCE_PORTION_SCALED") {
            expect(
              sourcePortionText,
              `Template ${template.id} food ${ing.foodId} sourcePortionText`
            ).not.toBeNull();
          }
        }
      }
    }
  });

  it("keeps the 20 raw-catalog cooking ingredients RAW and marks their 19 templates weigh raw", () => {
    const expectedTemplateIds = new Set([
      "comp-steamed-broccoli",
      "comp-sauteed-spinach",
      "comp-roasted-carrots",
      "comp-grilled-chicken-prep",
      "comp-seared-salmon-prep",
      "bf-lacto-low-scrambled-eggs",
      "bf-omni-low-egg-and-turkey",
      "bf-omni-mod-chicken-omelet",
      "lu-vegan-low-black-bean-bowl",
      "lu-omni-low-chicken-rice-bowl",
      "lu-omni-mod-turkey-quinoa-salad",
      "lu-omni-flex-steak-pita",
      "din-vegan-low-chickpea-curry",
      "din-vegan-flex-mediterranean-platter",
      "din-lacto-low-egg-rice-bowl",
      "din-lacto-mod-quinoa-frittata",
      "din-omni-mod-salmon-quinoa",
      "din-omni-flex-sirloin-steak",
      "sn-omni-flex-turkey-avocado-roll",
    ]);
    const actualTemplateIds = new Set(
      draftTemplatesFile.content.templates
        .filter((template) => template.notes?.toLowerCase().includes("weigh raw"))
        .map((template) => template.id)
    );
    expect(actualTemplateIds).toEqual(expectedTemplateIds);
    const correctedFoodIds = new Set([
      "fdc-747447",
      "fdc-168462",
      "fdc-170393",
      "fdc-2646170",
      "fdc-175138",
      "fdc-174515",
      "fdc-2727574",
      "fdc-169291",
    ]);

    let rawCookingIngredientCount = 0;
    for (const template of draftTemplatesFile.content.templates) {
      if (!expectedTemplateIds.has(template.id)) continue;
      for (const ingredient of template.ingredients) {
        if (ingredient.kind !== "FOOD") continue;
        const lookup = catalogSource.get(ingredient.foodId, ingredient.catalogVersion);
        expect(lookup.success).toBe(true);
        if (
          lookup.success &&
          lookup.item.foodState === "RAW" &&
          correctedFoodIds.has(ingredient.foodId)
        ) {
          rawCookingIngredientCount++;
          expect(ingredient.state, `${template.id}/${ingredient.foodId}`).toBe("RAW");
        }
      }
    }
    expect(rawCookingIngredientCount).toBe(20);
  });

  it("catches pattern tag contradictions in validateTemplateSetAgainstCatalog", () => {
    // Clone first template and add an unsupported pattern tag (e.g. VEGAN to an omnivore-only item)
    const cloned = JSON.parse(JSON.stringify(draftTemplatesFile.content)) as {
      templates: MealTemplate[];
    } & typeof draftTemplatesFile.content;
    const omniTemplate = cloned.templates.find((t) => t.id === "bf-omni-low-egg-and-turkey");
    if (!omniTemplate) throw new Error("expected omnivore template fixture");
    // Claim VEGAN when egg and turkey are not vegan
    omniTemplate.patternTags = ["VEGAN", "OMNIVORE"];

    const result = validateTemplateSetAgainstCatalog(cloned, catalogSource);
    expect(result.valid).toBe(false);
    expect(result.templateErrors.some((e) => e.error === "PATTERN_TAG_UNSATISFIED")).toBe(true);
  });

  it("(14) S-36a/S-36 decision 2: all 29 referenced ids (templates and substitution groups) exist in the signed v1 catalog, and none is one of v2's 24 additional ids", () => {
    const referencedIds = new Set<string>();
    for (const template of draftTemplatesFile.content.templates) {
      for (const ing of template.ingredients) {
        if (ing.kind === "FOOD") referencedIds.add(ing.foodId);
      }
    }
    for (const group of draftTemplatesFile.content.substitutionGroups) {
      for (const foodId of group.memberFoodIds) referencedIds.add(foodId);
    }
    expect(referencedIds.size).toBe(29);

    const v1Ids = new Set(draftCatalogFile.content.items.map((item) => item.id));
    for (const id of referencedIds) {
      expect(v1Ids.has(id), `referenced id ${id} must exist in the signed v1 catalog`).toBe(true);
    }

    const v2File = loadDraftUnsignedFoodCatalogV2();
    const v2OnlyIds = new Set(
      v2File.content.items.map((item) => item.id).filter((id) => !v1Ids.has(id))
    );
    expect(v2OnlyIds.size).toBe(24);
    for (const id of referencedIds) {
      expect(v2OnlyIds.has(id), `referenced id ${id} must not be one of v2's new ids`).toBe(false);
    }
  });

  it("(15) widening a template's patternTags beyond the intersection of its ingredients' (including a nested component template) reports PATTERN_TAG_UNSATISFIED -- patterns come from the catalog, not from names", () => {
    const cloned = JSON.parse(JSON.stringify(draftTemplatesFile.content)) as {
      templates: MealTemplate[];
    } & typeof draftTemplatesFile.content;
    // This template nests a COMPONENT_TEMPLATE ingredient (chicken/egg are
    // not vegan), so widening to VEGAN must fail through the flattened
    // nested-component path, not only a direct FOOD ingredient.
    const target = cloned.templates.find((t) => t.id === "bf-omni-mod-chicken-omelet");
    if (!target) throw new Error("expected bf-omni-mod-chicken-omelet fixture");
    expect(target.patternTags).toEqual(["OMNIVORE"]);
    target.patternTags = ["OMNIVORE", "VEGAN"];

    const result = validateTemplateSetAgainstCatalog(cloned, catalogSource);
    expect(result.valid).toBe(false);
    expect(
      result.templateErrors.some(
        (e) => e.templateId === "bf-omni-mod-chicken-omelet" && e.error === "PATTERN_TAG_UNSATISFIED"
      )
    ).toBe(true);
  });
});
