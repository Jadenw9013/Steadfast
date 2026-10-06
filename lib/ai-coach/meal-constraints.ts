import type { IntakeAnswers } from "./intake";
import type { ComposeConstraints } from "./meal-composer";

export type MealConstraintBlock = "COOKING_ACCESS_NOT_CONFIRMED" | "ALLERGENS_NOT_CONFIRMED";

export type MealConstraintResult =
  | { composable: true; constraints: ComposeConstraints; droppedDislikes: number }
  | { composable: false; block: MealConstraintBlock };

/**
 * The single mapping from a confirmed intake to composer constraints (S-36
 * decision 3). Used by the initial path and (from S-36b) the representation
 * path, so the two can never disagree about what a client asked for
 * (CLAUDE.md rule 1). Pure: no clock, no catalog, no I/O, no default that the
 * client did not state.
 */
export function mealComposerConstraintsFromIntake(answers: IntakeAnswers): MealConstraintResult {
  if (answers.cookingAccessStatus !== "CONFIRMED" || answers.cookingAccess === undefined) {
    return { composable: false, block: "COOKING_ACCESS_NOT_CONFIRMED" };
  }

  if (
    answers.allergenDeclarations === undefined ||
    answers.allergenDeclarations.status !== "CONFIRMED"
  ) {
    return { composable: false, block: "ALLERGENS_NOT_CONFIRMED" };
  }

  const dietaryPattern = answers.dietaryPattern;
  const patternTags: ComposeConstraints["patternTags"] =
    dietaryPattern !== undefined &&
    dietaryPattern.pattern !== "OTHER" &&
    dietaryPattern.pattern !== "NONE_DECLARED"
      ? [dietaryPattern.pattern]
      : [];

  // S-36 decision 4 is reserved for Jaden (whether a non-mandatory declared
  // pattern should still act as a hard filter). This line implements today's
  // behaviour unchanged: `patternMandatory` is passed through exactly as the
  // client declared it, so a PREFERENCE-reason pattern stays a ranking-only
  // tie-break downstream (meal-composer.ts's `patternMismatch`), never a hard
  // exclusion, until that decision changes it.
  const patternMandatory = dietaryPattern?.mandatory ?? false;

  let droppedDislikes = 0;
  const dislikedFoodIds: string[] = [];
  for (const dislike of answers.dislikes ?? []) {
    if (dislike.canonicalFoodId === null) {
      droppedDislikes += 1;
    } else {
      dislikedFoodIds.push(dislike.canonicalFoodId);
    }
  }

  const constraints: ComposeConstraints = {
    patternTags,
    patternMandatory,
    budgetBand: answers.foodBudgetLevel,
    prepTimeBand: answers.cookingAccess.typicalPrepMinutesBand,
    equipment: answers.cookingAccess.equipment,
    refrigeration: answers.cookingAccess.refrigeration,
    allergies: answers.allergies,
    allergenDeclarations: answers.allergenDeclarations,
    dietaryRestrictions: answers.dietaryRestrictions,
    dislikedFoodIds,
  };

  return { composable: true, constraints, droppedDislikes };
}
