import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { mealComposerConstraintsFromIntake } from "@/lib/ai-coach/meal-constraints";
import type { IntakeAnswers } from "@/lib/ai-coach/intake";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MEAL_CONSTRAINTS_FILE = path.resolve(REPO_ROOT, "lib/ai-coach/meal-constraints.ts");

const confirmedCookingAccess: NonNullable<IntakeAnswers["cookingAccess"]> = {
  equipment: ["STOVETOP"],
  refrigeration: "FRIDGE",
  mealPrepCapacity: "SOME",
  typicalPrepMinutesBand: "MIN_15_30",
};

const confirmedAllergenDeclarations: NonNullable<IntakeAnswers["allergenDeclarations"]> = {
  status: "CONFIRMED",
  noKnownAllergens: true,
  items: [],
};

function baseAnswers(overrides: Partial<IntakeAnswers> = {}): IntakeAnswers {
  return {
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    dietaryRestrictions: [],
    allergies: [],
    foodBudgetLevel: "MODERATE",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    intakeVersion: 2,
    cookingAccessStatus: "CONFIRMED",
    cookingAccess: confirmedCookingAccess,
    allergenDeclarations: confirmedAllergenDeclarations,
    ...overrides,
  };
}

describe("mealComposerConstraintsFromIntake — S-36 decision 3 fail-closed mapping", () => {
  it("blocks on COOKING_ACCESS_NOT_CONFIRMED when status is not CONFIRMED", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({ cookingAccessStatus: "DECLINED", cookingAccess: undefined })
    );
    expect(result).toEqual({ composable: false, block: "COOKING_ACCESS_NOT_CONFIRMED" });
  });

  it("blocks on COOKING_ACCESS_NOT_CONFIRMED when status is UNKNOWN", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({ cookingAccessStatus: "UNKNOWN", cookingAccess: undefined })
    );
    expect(result).toEqual({ composable: false, block: "COOKING_ACCESS_NOT_CONFIRMED" });
  });

  it("blocks on COOKING_ACCESS_NOT_CONFIRMED when status is CONFIRMED but cookingAccess is absent (defensive)", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({ cookingAccessStatus: "CONFIRMED", cookingAccess: undefined })
    );
    expect(result).toEqual({ composable: false, block: "COOKING_ACCESS_NOT_CONFIRMED" });
  });

  it("blocks on ALLERGENS_NOT_CONFIRMED when allergenDeclarations is absent", () => {
    const result = mealComposerConstraintsFromIntake(baseAnswers({ allergenDeclarations: undefined }));
    expect(result).toEqual({ composable: false, block: "ALLERGENS_NOT_CONFIRMED" });
  });

  it("blocks on ALLERGENS_NOT_CONFIRMED when status is UNKNOWN", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({
        allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
      })
    );
    expect(result).toEqual({ composable: false, block: "ALLERGENS_NOT_CONFIRMED" });
  });

  it("blocks on ALLERGENS_NOT_CONFIRMED when status is DECLINED", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({
        allergenDeclarations: { status: "DECLINED", noKnownAllergens: false, items: [] },
      })
    );
    expect(result).toEqual({ composable: false, block: "ALLERGENS_NOT_CONFIRMED" });
  });

  it("composes with an empty patternTags array when dietaryPattern is absent", () => {
    const result = mealComposerConstraintsFromIntake(baseAnswers());
    expect(result.composable).toBe(true);
    if (!result.composable) throw new Error("unreachable");
    expect(result.constraints.patternTags).toEqual([]);
    expect(result.constraints.patternMandatory).toBe(false);
  });

  it.each(["OTHER", "NONE_DECLARED"] as const)(
    "maps dietaryPattern %s to an empty patternTags array",
    (pattern) => {
      const result = mealComposerConstraintsFromIntake(
        baseAnswers({
          dietaryPattern: {
            pattern,
            otherLabel: pattern === "OTHER" ? "Something else" : null,
            mandatory: true,
            reason: "PREFERENCE",
            status: "CONFIRMED",
          },
        })
      );
      expect(result.composable).toBe(true);
      if (!result.composable) throw new Error("unreachable");
      expect(result.constraints.patternTags).toEqual([]);
    }
  );

  it("maps a declared VEGAN pattern to patternTags: ['VEGAN'] and passes mandatory through unchanged", () => {
    const mandatoryResult = mealComposerConstraintsFromIntake(
      baseAnswers({
        dietaryPattern: {
          pattern: "VEGAN",
          otherLabel: null,
          mandatory: true,
          reason: "RELIGIOUS_OR_ETHICAL",
          status: "CONFIRMED",
        },
      })
    );
    expect(mandatoryResult.composable).toBe(true);
    if (!mandatoryResult.composable) throw new Error("unreachable");
    expect(mandatoryResult.constraints.patternTags).toEqual(["VEGAN"]);
    expect(mandatoryResult.constraints.patternMandatory).toBe(true);

    // S-36 "Decisions reserved for Jaden" item 3 (Jaden's, not this
    // ticket's): a PREFERENCE-reason, non-mandatory pattern stays
    // non-mandatory -- today's behaviour, unchanged by this mapper.
    const preferenceResult = mealComposerConstraintsFromIntake(
      baseAnswers({
        dietaryPattern: {
          pattern: "VEGAN",
          otherLabel: null,
          mandatory: false,
          reason: "PREFERENCE",
          status: "CONFIRMED",
        },
      })
    );
    expect(preferenceResult.composable).toBe(true);
    if (!preferenceResult.composable) throw new Error("unreachable");
    expect(preferenceResult.constraints.patternTags).toEqual(["VEGAN"]);
    expect(preferenceResult.constraints.patternMandatory).toBe(false);
  });

  it("drops a dislike with canonicalFoodId: null, counts it, and never matches the label against the catalog", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({
        dislikes: [
          { label: "something slimy", canonicalFoodId: null },
          { label: "broccoli", canonicalFoodId: "fdc-170393" },
        ],
      })
    );
    expect(result.composable).toBe(true);
    if (!result.composable) throw new Error("unreachable");
    expect(result.constraints.dislikedFoodIds).toEqual(["fdc-170393"]);
    expect(result.droppedDislikes).toBe(1);
    expect(result.constraints.dislikedFoodIds).not.toContain("something slimy");
  });

  it("carries cookingAccess fields, budget, allergies, dietaryRestrictions and structured allergenDeclarations through unchanged", () => {
    const result = mealComposerConstraintsFromIntake(
      baseAnswers({
        foodBudgetLevel: "LOW",
        allergies: ["peanut"],
        dietaryRestrictions: ["VEGAN"],
        cookingAccess: {
          equipment: ["OVEN", "STOVETOP"],
          refrigeration: "FRIDGE_AND_FREEZER",
          mealPrepCapacity: "BATCH",
          typicalPrepMinutesBand: "MIN_30_60",
        },
      })
    );
    expect(result.composable).toBe(true);
    if (!result.composable) throw new Error("unreachable");
    expect(result.constraints.budgetBand).toBe("LOW");
    expect(result.constraints.prepTimeBand).toBe("MIN_30_60");
    expect(result.constraints.equipment).toEqual(["OVEN", "STOVETOP"]);
    expect(result.constraints.refrigeration).toBe("FRIDGE_AND_FREEZER");
    expect(result.constraints.allergies).toEqual(["peanut"]);
    expect(result.constraints.dietaryRestrictions).toEqual(["VEGAN"]);
    expect(result.constraints.allergenDeclarations).toEqual(confirmedAllergenDeclarations);
  });

  describe("module purity (no numbers in module, strict AST checks)", () => {
    const ALLOWED_NUMERIC_LITERALS = new Set(["0", "1"]);
    const ALLOWED_STRING_LITERALS = new Set([
      "COOKING_ACCESS_NOT_CONFIRMED",
      "ALLERGENS_NOT_CONFIRMED",
      "typicalPrepMinutesBand",
      "foodBudgetLevel",
      "dietaryRestrictions",
      "allergenDeclarations",
      "dislikedFoodIds",
      "cookingAccessStatus",
    ]);
    const content = fs.readFileSync(MEAL_CONSTRAINTS_FILE, "utf8");
    const sourceFile = ts.createSourceFile(
      MEAL_CONSTRAINTS_FILE,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    it("contains no numeric literal other than 0 and 1", () => {
      const offenders: string[] = [];
      function visit(node: ts.Node) {
        if (ts.isNumericLiteral(node) && !ALLOWED_NUMERIC_LITERALS.has(node.text)) {
          offenders.push(`numeric literal ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      ts.forEachChild(sourceFile, visit);
      expect(offenders).toEqual([]);
    });

    it("contains no string literal > 30 chars outside the block codes and intake field names", () => {
      const offenders: string[] = [];
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const text = node.text;
          if (text.length > 30) {
            const isImport =
              node.parent &&
              (ts.isImportDeclaration(node.parent) ||
                ts.isExportDeclaration(node.parent) ||
                ts.isExternalModuleReference(node.parent));
            if (!isImport && !ALLOWED_STRING_LITERALS.has(text)) {
              offenders.push(`string literal > 30 chars: "${text}" (${text.length})`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      ts.forEachChild(sourceFile, visit);
      expect(offenders).toEqual([]);
    });
  });
});
