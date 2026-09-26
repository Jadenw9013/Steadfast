import { describe, expect, it } from "vitest";
import {
  loadDraftUnsignedMealTemplates,
  loadDraftUnsignedFoodCatalog,
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
      expect(group.memberFoodIds.length, `group ${group.id} member count`).toBeGreaterThanOrEqual(2);
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

  it("ensures requiresReviewerPortion === true iff some ingredient has DEFAULT_100G_BAND", () => {
    for (const template of draftTemplatesFile.content.templates) {
      let hasDefaultBand = false;
      for (const ing of template.ingredients) {
        if (ing.kind === "FOOD" && ing.portion.rangeBasis === "DEFAULT_100G_BAND") {
          hasDefaultBand = true;
          break;
        }
      }
      expect(
        template.requiresReviewerPortion,
        `Template ${template.id} requiresReviewerPortion mismatch`
      ).toBe(hasDefaultBand);
    }
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
});
