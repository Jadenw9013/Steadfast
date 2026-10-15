"use client";

import { useEffect, useState } from "react";
import {
  allergenDeclarationsSchema,
  dietaryPatternSchema,
  intakeV2ConfirmObjectSchema,
  intakeV2ConfirmSchema,
  type AllergenDeclaration,
  type AllergenDeclarations,
  type DietaryPattern,
  type IntakeV2ConfirmAnswers,
} from "@/lib/ai-coach/intake-contract";
import { button, inputStyle, primary } from "./controls";

/**
 * T-2028 — four-step AI Coach onboarding.
 *
 * Plain-language choices are mapped into the existing v2 intake contract at
 * the boundary. Unasked governed fields stay UNKNOWN and their values stay
 * absent. SAFETY and ALLERGIES still run before CONFIRM_INTAKE so the server's
 * independent safety and draft-consistency guarantees remain intact.
 */

type Answers = Record<string, unknown>;
type GoalChoice = "FAT_LOSS" | "BUILD_MUSCLE" | "STRENGTH" | "GENERAL_FITNESS";
type ExperienceChoice = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
type EquipmentChoice = "BODYWEIGHT" | "HOME_DUMBBELLS" | "FULL_GYM";
type SessionLengthChoice = "MIN_30_45" | "MIN_45_60" | "MIN_60_PLUS";
type DietaryStyleChoice = "BALANCED" | "HIGH_PROTEIN" | "PLANT_BASED" | "LOW_CARB";
type TrackingStyleChoice = "PORTIONS" | "EXACT_MACROS";
type FoodBudgetChoice = "LOW" | "MODERATE" | "FLEXIBLE";
type AllergenChoice = "DAIRY" | "TREE_NUTS" | "PEANUTS" | "GLUTEN" | "SHELLFISH" | "NONE";
type UnitSystem = "IMPERIAL" | "METRIC";
type SafetyAnswer = "YES" | "NO" | "UNSURE";
type SafetyKey =
  | "chestPainDuringExercise"
  | "dizzinessOrFainting"
  | "heartCondition"
  | "pregnantOrPostpartum"
  | "recentInjuryOrSurgery"
  | "ageEligibilityConcern"
  | "eatingDisorderHistoryOrConcern"
  | "type1Diabetes";

export type SafetyAnswers = Partial<Record<SafetyKey, SafetyAnswer>>;

export interface IntakeSelections {
  goal?: GoalChoice;
  experience?: ExperienceChoice;
  trainingDaysPerWeek?: number;
  equipment?: EquipmentChoice;
  sessionLength?: SessionLengthChoice;
  dietaryStyle?: DietaryStyleChoice;
  trackingStyle?: TrackingStyleChoice;
  foodBudgetLevel?: FoodBudgetChoice;
  allergens: AllergenChoice[];
  unitSystem: UnitSystem;
  heightCm?: number;
  weightKg?: number;
  ageYears?: number;
  weightMeasuredOn: string;
  /**
   * T-2028 r2 (finding 1) — what is already on file and cannot be expressed
   * by the six chips. Carried through unchanged, shown read-only, and only
   * dropped by an explicit Remove. Never re-derived from the chips.
   */
  allergenSource?: AllergenDeclarations;
  retainedAllergenItems?: AllergenDeclaration[];
  retainedDietaryPattern?: DietaryPattern;
  /** Finding 2 — only a previously stated current-training answer, never inferred. */
  retainedResistanceTrainingContext?: IntakeV2ConfirmAnswers["resistanceTrainingContext"];
  /** Finding 8b — values entered elsewhere (iOS / T-2024) that this flow does not ask. */
  dislikes?: IntakeV2ConfirmAnswers["dislikes"];
  cuisinePreferences?: IntakeV2ConfirmAnswers["cuisinePreferences"];
}

const STAGES = ["Goal", "Training setup", "Nutrition & tracking", "Body stats & confirm"];

const SAFETY_FIELDS: { key: SafetyKey; label: string }[] = [
  { key: "chestPainDuringExercise", label: "Chest pain during exercise" },
  { key: "dizzinessOrFainting", label: "Dizziness or fainting" },
  { key: "heartCondition", label: "A known heart condition" },
  { key: "pregnantOrPostpartum", label: "Pregnant or postpartum" },
  { key: "recentInjuryOrSurgery", label: "A recent injury or surgery" },
  { key: "ageEligibilityConcern", label: "An age-related eligibility concern" },
  { key: "eatingDisorderHistoryOrConcern", label: "An eating-disorder history or concern" },
  { key: "type1Diabetes", label: "Type 1 diabetes" },
];

const EMPTY_ALLERGEN_DECLARATIONS: AllergenDeclarations = {
  status: "UNKNOWN",
  noKnownAllergens: false,
  items: [],
};

const INPUT_CLASS =
  "mt-2 min-h-12 w-full rounded-xl border border-white/[0.12] bg-zinc-950/70 px-4 py-3 text-base text-zinc-100 transition-colors motion-reduce:transition-none placeholder:text-zinc-600 focus-visible:border-blue-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30";
const CHOICE_BASE =
  "min-h-12 cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const GOAL_OPTIONS: {
  value: GoalChoice;
  label: string;
  description: string;
  badge: string;
  icon: "down" | "up" | "bar" | "spark";
}[] = [
  {
    value: "FAT_LOSS",
    label: "Fat Loss / Cut",
    description: "Tell the planner that reducing body fat is your current preference.",
    badge: "Body-composition preference",
    icon: "down",
  },
  {
    value: "BUILD_MUSCLE",
    label: "Build Muscle",
    description: "Tell the planner that building muscle is your current preference.",
    badge: "Muscle-building preference",
    icon: "up",
  },
  {
    value: "STRENGTH",
    label: "Strength",
    description: "Prioritize getting stronger within your available equipment and schedule.",
    badge: "Strength preference",
    icon: "bar",
  },
  {
    value: "GENERAL_FITNESS",
    label: "General Fitness",
    description: "Build a general routine around consistency, movement, and conditioning.",
    badge: "General routine preference",
    icon: "spark",
  },
];

const EXPERIENCE_OPTIONS = [
  { value: "BEGINNER", label: "Beginner", description: "< 1 year structured training" },
  { value: "INTERMEDIATE", label: "Intermediate", description: "1–3 years consistent lifting" },
  { value: "ADVANCED", label: "Advanced", description: "3+ years dedicated training" },
] satisfies { value: ExperienceChoice; label: string; description: string }[];

const EQUIPMENT_OPTIONS = [
  {
    value: "BODYWEIGHT",
    label: "Bodyweight",
    description: "Calisthenics, floor work, and pull-up bar (no weights needed).",
  },
  {
    value: "HOME_DUMBBELLS",
    label: "Home Dumbbells",
    description: "Adjustable dumbbells, incline bench, and resistance bands.",
  },
  {
    value: "FULL_GYM",
    label: "Full Gym",
    description: "Barbells, power racks, cable stacks, and selectorized machines.",
  },
] satisfies { value: EquipmentChoice; label: string; description: string }[];

const SESSION_OPTIONS = [
  { value: "MIN_30_45", label: "30–45m", description: "Fast, dense workouts" },
  { value: "MIN_45_60", label: "45–60m", description: "Standard complete session" },
  { value: "MIN_60_PLUS", label: "60m+", description: "Extended accessories & cardio" },
] satisfies { value: SessionLengthChoice; label: string; description: string }[];

const DIETARY_OPTIONS = [
  { value: "BALANCED", label: "Balanced", description: "Whole-food carbs, lean proteins, healthy fats" },
  {
    value: "HIGH_PROTEIN",
    label: "High Protein",
    description: "Prefer meals centered on protein-rich foods",
  },
  { value: "PLANT_BASED", label: "Plant-Based", description: "Vegetarian/vegan whole foods" },
  { value: "LOW_CARB", label: "Low Carb", description: "Higher healthy fats and vegetables" },
] satisfies { value: DietaryStyleChoice; label: string; description: string }[];

const TRACKING_OPTIONS = [
  {
    value: "PORTIONS",
    label: "Portions",
    description:
      "Follow exact ingredient measurements (e.g. 100 g rice, 150 g chicken, 1 cup oats) without having to calculate or track daily macro totals.",
  },
  {
    value: "EXACT_MACROS",
    label: "Exact Macros",
    description:
      "Exact measured meals plus full daily calories and macronutrient targets (protein, carbs, fats) for detailed daily tracking.",
  },
] satisfies { value: TrackingStyleChoice; label: string; description: string }[];

const BUDGET_OPTIONS = [
  { value: "LOW", label: "Budget-conscious", description: "Prefer lower-cost ingredients" },
  { value: "MODERATE", label: "Moderate", description: "Balance cost and variety" },
  { value: "FLEXIBLE", label: "No preference", description: "Do not narrow choices by cost" },
] satisfies { value: FoodBudgetChoice; label: string; description: string }[];

const ALLERGEN_OPTIONS = [
  { value: "DAIRY", label: "Dairy" },
  { value: "TREE_NUTS", label: "Tree Nuts" },
  { value: "PEANUTS", label: "Peanuts" },
  { value: "GLUTEN", label: "Gluten" },
  { value: "SHELLFISH", label: "Shellfish" },
  { value: "NONE", label: "None" },
] satisfies { value: AllergenChoice; label: string }[];

const CONFIRM_KEYS = Object.keys(intakeV2ConfirmObjectSchema.shape);

function record(value: unknown): Answers {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Answers)
    : {};
}

function localDateString(now = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function round(value: number, precision = 1): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function poundsToKilograms(pounds: number): number {
  return round(pounds / 2.2046226218, 2);
}

export function kilogramsToPounds(kilograms: number): number {
  return round(kilograms * 2.2046226218, 1);
}

export function feetAndInchesToCentimeters(feet: number, inches: number): number {
  return round((feet * 12 + inches) * 2.54, 1);
}

export function centimetersToFeetAndInches(centimeters?: number): {
  feet?: number;
  inches?: number;
} {
  if (centimeters === undefined) return {};
  const totalInches = centimeters / 2.54;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

function goalFromSeed(seed: Answers): GoalChoice | undefined {
  if (seed.goal === "STRENGTH") return "STRENGTH";
  if (seed.goal === "GENERAL_FITNESS") return "GENERAL_FITNESS";
  if (seed.goal === "BODY_COMPOSITION" && seed.bodyWeightIntent === "GAIN") return "BUILD_MUSCLE";
  if (seed.goal === "BODY_COMPOSITION" && seed.bodyWeightIntent === "LOSE") return "FAT_LOSS";
  return undefined;
}

function experienceFromSeed(seed: Answers): ExperienceChoice | undefined {
  if (seed.experienceLevel === "NEW") return "BEGINNER";
  if (seed.experienceLevel === "RETURNING") return "INTERMEDIATE";
  if (seed.experienceLevel === "EXPERIENCED") return "ADVANCED";
  return undefined;
}

function equipmentFromSeed(seed: Answers): EquipmentChoice | undefined {
  const values = Array.isArray(seed.equipmentAccess) ? seed.equipmentAccess : [];
  if (values.includes("FULL_GYM")) return "FULL_GYM";
  if (values.includes("HOME_BASIC")) return "HOME_DUMBBELLS";
  if (values.includes("NONE")) return "BODYWEIGHT";
  return undefined;
}

function sessionLengthFromSeed(seed: Answers): SessionLengthChoice | undefined {
  if (seed.sessionLengthBand === "MIN_30_45") return "MIN_30_45";
  if (seed.sessionLengthBand === "MIN_45_60") return "MIN_45_60";
  if (seed.sessionLengthBand === "MIN_60_90" || seed.sessionLengthBand === "OVER_90")
    return "MIN_60_PLUS";
  return undefined;
}

function dietaryStyleFromSeed(seed: Answers): DietaryStyleChoice | undefined {
  const pattern = record(seed.dietaryPattern);
  // Only a pattern this flow itself could have written maps back to a chip.
  // Anything stricter (mandatory, medical/religious) is retained instead,
  // so choosing a chip can never quietly downgrade it to a preference.
  if (pattern.pattern !== "OTHER" || pattern.mandatory !== false) return undefined;
  const label = typeof pattern.otherLabel === "string" ? pattern.otherLabel.toLowerCase() : "";
  if (label === "balanced") return "BALANCED";
  if (label === "high protein") return "HIGH_PROTEIN";
  if (label === "plant-based" || label === "plant based") return "PLANT_BASED";
  if (label === "low carb") return "LOW_CARB";
  return undefined;
}

function allergenChoiceFor(
  item: AllergenDeclaration
): Exclude<AllergenChoice, "NONE"> | undefined {
  if (item.category === "MILK") return "DAIRY";
  if (item.category === "TREE_NUT") return "TREE_NUTS";
  if (item.category === "PEANUT") return "PEANUTS";
  if (item.category === "CRUSTACEAN_SHELLFISH") return "SHELLFISH";
  if (item.category === "OTHER" && item.specificity?.toLowerCase() === "gluten") return "GLUTEN";
  return undefined;
}

function allergensFromSeed(declarations?: AllergenDeclarations): AllergenChoice[] {
  if (!declarations || declarations.status !== "CONFIRMED") return [];
  if (declarations.noKnownAllergens) return ["NONE"];
  return [
    ...new Set(declarations.items.map(allergenChoiceFor).filter(Boolean)),
  ] as AllergenChoice[];
}

function unmappedAllergenItems(declarations?: AllergenDeclarations): AllergenDeclaration[] {
  if (!declarations || declarations.status !== "CONFIRMED") return [];
  return declarations.items.filter((item) => allergenChoiceFor(item) === undefined);
}

function retainedDietaryPatternFromSeed(seed: Answers): DietaryPattern | undefined {
  const parsed = dietaryPatternSchema.safeParse(seed.dietaryPattern);
  // A mandatory pattern is a hard exclusion (`deriveLegacyDietaryRestrictions`
  // only emits tokens for mandatory patterns). The chips are preferences
  // only, so a mandatory pattern is kept verbatim until explicitly removed.
  return parsed.success && parsed.data.mandatory ? parsed.data : undefined;
}

function seededList<K extends "dislikes" | "cuisinePreferences">(
  seed: Answers,
  key: K
): IntakeV2ConfirmAnswers[K] | undefined {
  const parsed = intakeV2ConfirmObjectSchema.shape[key].safeParse(seed[key]);
  return parsed.success ? (parsed.data as IntakeV2ConfirmAnswers[K]) : undefined;
}

export function createIntakeSelections(seed: Answers, today = localDateString()): IntakeSelections {
  const parsedDeclarations = allergenDeclarationsSchema.safeParse(seed.allergenDeclarations);
  const sourceAllergenDeclarations = parsedDeclarations.success
    ? parsedDeclarations.data
    : undefined;
  const retainedContext =
    seed.trainingContextStatus === "CONFIRMED" &&
    (seed.resistanceTrainingContext === "NONE" ||
      seed.resistanceTrainingContext === "OCCASIONAL" ||
      seed.resistanceTrainingContext === "REGULAR")
      ? seed.resistanceTrainingContext
      : undefined;
  return {
    allergenSource: sourceAllergenDeclarations,
    retainedAllergenItems: unmappedAllergenItems(sourceAllergenDeclarations),
    retainedDietaryPattern: retainedDietaryPatternFromSeed(seed),
    retainedResistanceTrainingContext: retainedContext,
    dislikes: seededList(seed, "dislikes"),
    cuisinePreferences: seededList(seed, "cuisinePreferences"),
    goal: goalFromSeed(seed),
    experience: experienceFromSeed(seed),
    trainingDaysPerWeek:
      typeof seed.trainingDaysPerWeek === "number" ? seed.trainingDaysPerWeek : undefined,
    equipment: equipmentFromSeed(seed),
    sessionLength: sessionLengthFromSeed(seed),
    dietaryStyle: dietaryStyleFromSeed(seed),
    trackingStyle:
      seed.trackingPreference === "PORTIONS_ONLY"
        ? "PORTIONS"
        : seed.trackingPreference === "NUMBERS_VISIBLE"
          ? "EXACT_MACROS"
          : undefined,
    foodBudgetLevel:
      seed.foodBudgetLevel === "LOW" ||
      seed.foodBudgetLevel === "MODERATE" ||
      seed.foodBudgetLevel === "FLEXIBLE"
        ? seed.foodBudgetLevel
        : undefined,
    allergens: allergensFromSeed(sourceAllergenDeclarations),
    unitSystem: seed.unitsPreference === "METRIC" ? "METRIC" : "IMPERIAL",
    heightCm: typeof seed.heightCm === "number" ? seed.heightCm : undefined,
    weightKg: typeof seed.weightKg === "number" ? seed.weightKg : undefined,
    ageYears: typeof seed.ageYears === "number" ? seed.ageYears : undefined,
    weightMeasuredOn: typeof seed.weightMeasuredOn === "string" ? seed.weightMeasuredOn : today,
  };
}

function mappedGoal(choice?: GoalChoice): IntakeV2ConfirmAnswers["goal"] | undefined {
  if (choice === "FAT_LOSS" || choice === "BUILD_MUSCLE") return "BODY_COMPOSITION";
  if (choice === "STRENGTH") return "STRENGTH";
  if (choice === "GENERAL_FITNESS") return "GENERAL_FITNESS";
  return undefined;
}

function mappedGoalDetails(
  choice?: GoalChoice
):
  | Pick<
      IntakeV2ConfirmAnswers,
      "goalStatus" | "bodyWeightIntent" | "goalPaceClass" | "weightNeutralAccepted"
    >
  | { goalStatus: "UNKNOWN" } {
  if (choice === "FAT_LOSS") {
    return {
      goalStatus: "CONFIRMED",
      bodyWeightIntent: "LOSE",
      goalPaceClass: "UNDECIDED",
      weightNeutralAccepted: false,
    };
  }
  if (choice === "BUILD_MUSCLE") {
    return {
      goalStatus: "CONFIRMED",
      bodyWeightIntent: "GAIN",
      goalPaceClass: "UNDECIDED",
      weightNeutralAccepted: false,
    };
  }
  return { goalStatus: "UNKNOWN" };
}

function mappedExperience(
  choice?: ExperienceChoice
): IntakeV2ConfirmAnswers["experienceLevel"] | undefined {
  if (choice === "BEGINNER") return "NEW";
  if (choice === "INTERMEDIATE") return "RETURNING";
  if (choice === "ADVANCED") return "EXPERIENCED";
  return undefined;
}

function mappedEquipment(
  choice?: EquipmentChoice
): IntakeV2ConfirmAnswers["equipmentAccess"] | undefined {
  if (choice === "BODYWEIGHT") return ["NONE"];
  if (choice === "HOME_DUMBBELLS") return ["HOME_BASIC"];
  if (choice === "FULL_GYM") return ["FULL_GYM"];
  return undefined;
}

function mappedSessionLength(
  choice?: SessionLengthChoice
): IntakeV2ConfirmAnswers["sessionLengthBand"] | undefined {
  if (choice === "MIN_60_PLUS") return "MIN_60_90";
  return choice;
}

function mappedDietaryPattern(
  choice?: DietaryStyleChoice,
  retained?: DietaryPattern
): IntakeV2ConfirmAnswers["dietaryPattern"] {
  if (retained) return retained;
  const label: Record<DietaryStyleChoice, string> = {
    BALANCED: "Balanced",
    HIGH_PROTEIN: "High protein",
    PLANT_BASED: "Plant-based",
    LOW_CARB: "Low carb",
  };
  if (!choice)
    return {
      pattern: "NONE_DECLARED",
      otherLabel: null,
      mandatory: false,
      reason: "NOT_STATED",
      status: "UNKNOWN",
    };
  // Preserve the user's exact preference instead of translating
  // "plant-based" into vegan or "high protein" into omnivore.
  return {
    pattern: "OTHER",
    otherLabel: label[choice],
    mandatory: false,
    reason: "PREFERENCE",
    status: "CONFIRMED",
  };
}

function declarationForChoice(choice: Exclude<AllergenChoice, "NONE">): AllergenDeclaration {
  const common = { kind: "ALLERGY" as const, crossContactAvoidanceRequired: "UNSURE" as const };
  if (choice === "DAIRY") return { category: "MILK", specificity: null, ...common };
  if (choice === "TREE_NUTS") return { category: "TREE_NUT", specificity: null, ...common };
  if (choice === "PEANUTS") return { category: "PEANUT", specificity: null, ...common };
  if (choice === "SHELLFISH")
    return { category: "CRUSTACEAN_SHELLFISH", specificity: null, ...common };
  // Gluten is broader than wheat, so keep it explicit and fail-closed.
  return { category: "OTHER", specificity: "gluten", ...common };
}

/**
 * T-2028 r2 finding 1. The chips are a view over what is on file, never a
 * replacement for it:
 *  - a chip whose category is already on file re-emits those stored items
 *    byte-for-byte (species, kind and cross-contact answer included);
 *  - items no chip can express (Egg, Fish, Soy, Wheat, Sesame, other) are
 *    carried through until the client explicitly removes them;
 *  - only a newly selected chip produces a new item.
 * So an untouched pass re-sends exactly the stored declarations, which the
 * server's canonical hash treats as no new concern (no pause, no RESTRICTED).
 */
export function buildAllergenDeclarations(selections: IntakeSelections): AllergenDeclarations {
  const retained = selections.retainedAllergenItems ?? [];
  // Fail closed: "None" never erases items still on file. Step validation
  // refuses that combination; if it reaches here anyway the items win.
  if (selections.allergens.includes("NONE") && retained.length === 0)
    return { status: "CONFIRMED", noKnownAllergens: true, items: [] };
  if (selections.allergens.length === 0 && retained.length === 0)
    return EMPTY_ALLERGEN_DECLARATIONS;

  const selected = selections.allergens.filter(
    (choice): choice is Exclude<AllergenChoice, "NONE"> => choice !== "NONE"
  );
  const source =
    selections.allergenSource?.status === "CONFIRMED" ? selections.allergenSource.items : [];
  const items: AllergenDeclaration[] = [];
  for (const item of source) {
    const choice = allergenChoiceFor(item);
    if (choice === undefined ? retained.includes(item) : selected.includes(choice))
      items.push(item);
  }
  for (const item of retained) if (!items.includes(item)) items.push(item);
  for (const choice of selected) {
    if (!source.some((item) => allergenChoiceFor(item) === choice))
      items.push(declarationForChoice(choice));
  }
  return allergenDeclarationsSchema.parse({
    status: "CONFIRMED",
    noKnownAllergens: false,
    items,
  });
}

const ALLERGEN_CATEGORY_LABELS: Record<AllergenDeclaration["category"], string> = {
  MILK: "Dairy",
  EGG: "Egg",
  FISH: "Fish",
  CRUSTACEAN_SHELLFISH: "Shellfish",
  TREE_NUT: "Tree Nuts",
  PEANUT: "Peanuts",
  WHEAT: "Wheat",
  SOYBEAN: "Soy",
  SESAME: "Sesame",
  OTHER: "Other",
};

/** Read-only label for an item on file, e.g. "Fish (salmon)". */
export function describeAllergenItem(item: AllergenDeclaration): string {
  const base =
    item.category === "OTHER" && item.specificity
      ? item.specificity
      : item.specificity
        ? `${ALLERGEN_CATEGORY_LABELS[item.category]} (${item.specificity})`
        : ALLERGEN_CATEGORY_LABELS[item.category];
  return item.kind === "INTOLERANCE_OR_SENSITIVITY" ? `${base}, intolerance` : base;
}

const DIETARY_PATTERN_LABELS: Record<DietaryPattern["pattern"], string> = {
  OMNIVORE: "Omnivore",
  LACTO_OVO_VEGETARIAN: "Vegetarian (eggs and dairy)",
  VEGAN: "Vegan",
  PESCATARIAN: "Pescatarian",
  OTHER: "Other",
  NONE_DECLARED: "None declared",
};

export function mapSelectionsToAnswers(selections: IntakeSelections): Answers {
  const goal = mappedGoal(selections.goal);
  const experienceLevel = mappedExperience(selections.experience);
  const equipmentAccess = mappedEquipment(selections.equipment);
  // Finding 2: the experience pill is not a current-training answer. Only a
  // previously confirmed answer is carried; otherwise the pair stays UNKNOWN.
  const resistanceTrainingContext = selections.retainedResistanceTrainingContext;
  const sessionLengthBand = mappedSessionLength(selections.sessionLength);
  const goalDetails = mappedGoalDetails(selections.goal);
  const hasBodyMeasurements =
    selections.heightCm !== undefined &&
    selections.weightKg !== undefined &&
    Boolean(selections.weightMeasuredOn);
  const hasTrainingContext =
    resistanceTrainingContext !== undefined && sessionLengthBand !== undefined;

  return {
    intakeVersion: 2,
    ...(goal ? { goal } : {}),
    ...(experienceLevel ? { experienceLevel } : {}),
    ...(selections.trainingDaysPerWeek !== undefined
      ? { trainingDaysPerWeek: selections.trainingDaysPerWeek }
      : {}),
    ...(equipmentAccess ? { equipmentAccess } : {}),
    ...(selections.foodBudgetLevel ? { foodBudgetLevel: selections.foodBudgetLevel } : {}),
    ...(selections.trackingStyle
      ? {
          trackingPreference:
            selections.trackingStyle === "PORTIONS" ? "PORTIONS_ONLY" : "NUMBERS_VISIBLE",
        }
      : {}),
    unitsPreference: selections.unitSystem,
    ageStatus: selections.ageYears === undefined ? "UNKNOWN" : "CONFIRMED",
    ...(selections.ageYears === undefined ? {} : { ageYears: selections.ageYears }),
    energyMethodPopulationCategoryStatus: "UNKNOWN",
    physicalActivityCategoryStatus: "UNKNOWN",
    bodyMeasurementStatus: hasBodyMeasurements ? "CONFIRMED" : "UNKNOWN",
    ...(hasBodyMeasurements
      ? {
          heightCm: selections.heightCm,
          weightKg: selections.weightKg,
          weightMeasuredOn: selections.weightMeasuredOn,
        }
      : {}),
    ...goalDetails,
    trainingContextStatus: hasTrainingContext ? "CONFIRMED" : "UNKNOWN",
    ...(hasTrainingContext ? { resistanceTrainingContext } : {}),
    // The draft keeps the chosen session length so the step resumes; the
    // confirm payload drops it unless its jointly governed pair is CONFIRMED.
    ...(sessionLengthBand ? { sessionLengthBand } : {}),
    cookingAccessStatus: "UNKNOWN",
    dislikes: selections.dislikes ?? [],
    cuisinePreferences: selections.cuisinePreferences ?? [],
    allergenDeclarations: buildAllergenDeclarations(selections),
    dietaryPattern: mappedDietaryPattern(selections.dietaryStyle, selections.retainedDietaryPattern),
  };
}

export function buildConfirmPayload(selections: IntakeSelections): IntakeV2ConfirmAnswers {
  const mapped = mapSelectionsToAnswers(selections);
  if (mapped.trainingContextStatus !== "CONFIRMED") delete mapped.sessionLengthBand;
  const payload = Object.fromEntries(
    Object.entries(mapped).filter(
      ([key, value]) => CONFIRM_KEYS.includes(key) && value !== undefined
    )
  );
  return intakeV2ConfirmSchema.parse(payload);
}

export function toggleAllergen(
  selected: AllergenChoice[],
  choice: AllergenChoice
): AllergenChoice[] {
  if (choice === "NONE") return selected.includes("NONE") ? [] : ["NONE"];
  const withoutNone = selected.filter((item) => item !== "NONE");
  return withoutNone.includes(choice)
    ? withoutNone.filter((item) => item !== choice)
    : [...withoutNone, choice];
}

export function safetyAnswersComplete(
  answers: SafetyAnswers
): answers is Record<SafetyKey, SafetyAnswer> {
  return SAFETY_FIELDS.every(({ key }) => answers[key] !== undefined);
}

export function intakeStepIssues(
  stage: number,
  selections: IntakeSelections,
  safetyAnswers: SafetyAnswers,
  needsSafetyDisclosure: boolean
): string[] {
  const issues: string[] = [];
  if (stage === 0) {
    if (!selections.goal) issues.push("Choose your main goal.");
    if (!selections.experience) issues.push("Choose your experience level.");
  }
  if (stage === 1) {
    if (!selections.trainingDaysPerWeek) issues.push("Choose your training days.");
    if (!selections.equipment) issues.push("Choose your equipment setup.");
    if (!selections.sessionLength) issues.push("Choose a session length.");
  }
  if (stage === 2) {
    if (!selections.dietaryStyle && !selections.retainedDietaryPattern)
      issues.push("Choose a dietary style.");
    if (!selections.trackingStyle) issues.push("Choose a tracking style.");
    if (!selections.foodBudgetLevel) issues.push("Choose a food budget preference.");
    const retainedAllergens = selections.retainedAllergenItems?.length ?? 0;
    if (selections.allergens.length === 0 && retainedAllergens === 0)
      issues.push("Choose any allergens, or choose None.");
    if (selections.allergens.includes("NONE") && retainedAllergens > 0)
      issues.push("Remove the other allergens on file before choosing None.");
  }
  if (stage === 3) {
    if (
      selections.heightCm === undefined ||
      !Number.isFinite(selections.heightCm) ||
      selections.heightCm <= 0 ||
      selections.heightCm > 300
    )
      issues.push("Enter a valid height.");
    if (
      selections.weightKg === undefined ||
      !Number.isFinite(selections.weightKg) ||
      selections.weightKg <= 0 ||
      selections.weightKg > 400
    )
      issues.push("Enter a valid weight.");
    if (
      selections.ageYears === undefined ||
      !Number.isInteger(selections.ageYears) ||
      selections.ageYears <= 0 ||
      selections.ageYears > 120
    )
      issues.push("Enter your age in whole years.");
    if (needsSafetyDisclosure && !safetyAnswersComplete(safetyAnswers))
      issues.push("Complete the quick safety check.");
  }
  return issues;
}

/**
 * Where a client who already has a confirmed intake or an in-progress draft
 * should land — the first stage that still has outstanding issues, not
 * always stage 0. A client who filled in three of four steps and closed the
 * tab should not have to re-answer the three that were already fine.
 *
 * Stage 3 is the only destination once 0–2 are clean: it owns body-stat
 * validation, the safety prerequisite and final review, and the wizard has
 * no stage after it, so a complete draft always resumes there regardless of
 * whether the safety disclosure is itself still outstanding — stage 3's own
 * render handles that case.
 */
export function firstIncompleteIntakeStage(
  selections: IntakeSelections,
  safetyDisclosureCompleted: boolean
): number {
  for (let candidate = 0; candidate < 3; candidate += 1) {
    if (intakeStepIssues(candidate, selections, {}, false).length > 0) return candidate;
  }
  void safetyDisclosureCompleted;
  return 3;
}

/**
 * S-19 dead end 3 — whether the wizard must ask the eight safety questions.
 *
 * `CONFIRM_INTAKE` refuses unless an `AiSafetyDisclosureEvent` row exists, so
 * this must read that row's existence and nothing else. The previous
 * `view.confirmedIntake === null` was a proxy: a profile confirmed or seeded
 * without a disclosure row skipped the SAFETY command and then took a hard
 * 422 ("Complete the safety questions first.") with no way to satisfy it from
 * the UI.
 */
export function deriveNeedsSafetyDisclosure(view: {
  safetyDisclosureCompleted: boolean;
}): boolean {
  return !view.safetyDisclosureCompleted;
}

export async function confirmAndRedirect({
  selections,
  safetyAnswers,
  needsSafetyDisclosure,
  command,
  redirect,
}: {
  selections: IntakeSelections;
  safetyAnswers: SafetyAnswers;
  needsSafetyDisclosure: boolean;
  command: (input: Record<string, unknown>) => Promise<unknown>;
  redirect: () => void;
}) {
  if (needsSafetyDisclosure) {
    if (!safetyAnswersComplete(safetyAnswers)) throw new Error("Complete the quick safety check.");
    await command({ operation: "SAFETY", answers: safetyAnswers });
  }
  const allergenDeclarations = buildAllergenDeclarations(selections);
  await command({ operation: "ALLERGIES", allergenDeclarations });
  await command({ operation: "CONFIRM_INTAKE", answers: buildConfirmPayload(selections) });
  redirect();
}

function GoalIcon({ kind }: { kind: "down" | "up" | "bar" | "spark" }) {
  if (kind === "bar")
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M5 8v8M3 10v4m16-6v8m2-6v4M5 12h14" />
      </svg>
    );
  if (kind === "spark")
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4" />
      </svg>
    );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d={kind === "down" ? "M5 7l6 6 4-4 4 4" : "M5 17l6-6 4 4 4-8"} />
      <path d={kind === "down" ? "M19 9v4h-4" : "M15 7h4v4"} />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="m4 10 4 4 8-8" />
    </svg>
  );
}

function ChoicePills({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value?: string | number;
  options: { value: string | number; label: string; description?: string }[];
  onChange: (value: string | number) => void;
  hint?: string;
}) {
  return (
    <fieldset className="space-y-2.5">
      <div>
        <legend className="text-sm font-semibold text-zinc-200">{label}</legend>
        {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={`${CHOICE_BASE} inline-flex items-center justify-center gap-2 ${
                selected
                  ? "border-blue-500 bg-blue-500/15 text-blue-100"
                  : "border-white/[0.1] bg-zinc-900/60 text-zinc-300 hover:border-white/[0.2] hover:bg-zinc-800/70"
              }`}
              onClick={() => onChange(option.value)}
            >
              {selected && <CheckIcon />}
              <span>
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <span className="ml-1.5 text-xs opacity-75 font-normal">· {option.description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div
      id="intake-issues"
      role="alert"
      tabIndex={-1}
      className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
    >
      <p className="text-sm font-semibold text-amber-200">A couple of choices are still needed:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/90">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

export function IntakeWizard({
  view,
  busy,
  act,
  command,
  initialStage,
}: {
  view: { confirmedIntake: unknown; draft: unknown; safetyDisclosureCompleted: boolean };
  busy: boolean;
  act: (work: () => Promise<unknown>, success: string) => Promise<void>;
  command: (input: Record<string, unknown>) => Promise<unknown>;
  post: (url: string, input: Record<string, unknown>) => Promise<unknown>;
  initialStage?: number;
}) {
  const seed = { ...record(view.confirmedIntake), ...record(view.draft) };
  const [selections, setSelections] = useState<IntakeSelections>(() =>
    createIntakeSelections(seed)
  );
  const [stage, setStage] = useState(
    () =>
      initialStage ??
      firstIncompleteIntakeStage(createIntakeSelections(seed), view.safetyDisclosureCompleted)
  );
  const [safetyAnswers, setSafetyAnswers] = useState<SafetyAnswers>({});
  const [showSafetyDetails, setShowSafetyDetails] = useState(false);
  const [issueStage, setIssueStage] = useState<number | null>(null);
  const needsSafetyDisclosure = deriveNeedsSafetyDisclosure(view);
  // A second pass over an already-confirmed intake is the case that silently
  // restricted the account (S-19 dead end 1): a changed allergen declaration
  // records a new safety concern, pauses nutrition and cancels the queued
  // run, and only an authorized reviewer can lift it. Say so before the
  // client changes anything rather than after.
  const intakeAlreadyConfirmed = view.confirmedIntake !== null;

  const update = (patch: Partial<IntakeSelections>) =>
    setSelections((current) => ({ ...current, ...patch }));
  // Finding 9c: inches typed before feet are held here instead of discarded.
  const [pendingInches, setPendingInches] = useState<number | undefined>(undefined);
  // Stored species/type detail behind a selected chip, e.g. "cashew".
  const chipDetail = (choice: AllergenChoice): string | undefined => {
    if (choice === "GLUTEN" || selections.allergenSource?.status !== "CONFIRMED") return undefined;
    const details = selections.allergenSource.items
      .filter((item) => allergenChoiceFor(item) === choice && item.specificity)
      .map((item) => item.specificity);
    return details.length > 0 ? details.join(", ") : undefined;
  };

  const saveFields = (keys: string[]) => {
    const mapped = mapSelectionsToAnswers(selections);
    return command({
      operation: "SAVE_INTAKE",
      answers: Object.fromEntries(Object.entries(mapped).filter(([key]) => keys.includes(key))),
    });
  };

  async function advance(next: number, keys: string[], saveAllergens = false) {
    if (busy) return;
    let succeeded = false;
    await act(async () => {
      if (saveAllergens)
        await command({
          operation: "ALLERGIES",
          allergenDeclarations: buildAllergenDeclarations(selections),
        });
      await saveFields(keys);
      succeeded = true;
    }, "Saved. You can pick up here anytime.");
    if (succeeded) setStage(next);
  }

  const currentIssues = intakeStepIssues(stage, selections, safetyAnswers, needsSafetyDisclosure);
  const visibleIssues = issueStage === stage ? currentIssues : [];
  useEffect(() => {
    if (visibleIssues.length > 0) document.getElementById("intake-issues")?.focus();
  }, [stage, visibleIssues.length]);
  const continueFromStage = (next: number, keys: string[], saveAllergens = false) => {
    if (currentIssues.length > 0) {
      setIssueStage(stage);
      return;
    }
    setIssueStage(null);
    void advance(next, keys, saveAllergens);
  };
  const imperialHeight = centimetersToFeetAndInches(selections.heightCm);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a1224]">
        <div className="border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">
                Your setup
              </p>
              <p className="mt-1 text-sm text-zinc-400">Four focused steps.</p>
            </div>
            <p className="font-mono text-sm tabular-nums text-zinc-300">{stage + 1} / 4</p>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2" aria-hidden="true">
            {STAGES.map((label, index) => (
              <div
                key={label}
                className={`h-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                  index <= stage ? "bg-blue-500" : "bg-zinc-800"
                }`}
              />
            ))}
          </div>
        </div>

        <ol aria-label="Intake steps" className="sr-only">
          {STAGES.map((label, index) => (
            <li key={label} aria-current={index === stage ? "step" : undefined}>
              Step {index + 1}: {label}
            </li>
          ))}
        </ol>

        {stage === 0 && (
          <section aria-labelledby="intake-goal-heading" className="space-y-7 p-5 sm:p-6">
            <div>
              <p className="text-sm font-medium text-blue-400">Step 1</p>
              <h2 id="intake-goal-heading" className="mt-1 text-2xl font-bold text-zinc-100">
                What are we building toward?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Pick the goal that matters most right now. You can change it later.
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-zinc-200">Main goal</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {GOAL_OPTIONS.map((option) => {
                  const selected = selections.goal === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      className={`${CHOICE_BASE} relative p-4 ${
                        selected
                          ? "border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/[0.06]"
                          : "border-white/[0.08] bg-zinc-950/40 hover:border-blue-500/30 hover:bg-zinc-900/80"
                      }`}
                      onClick={() => update({ goal: option.value })}
                    >
                      <span className="flex items-start gap-3">
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                            selected ? "bg-blue-500/20 text-blue-300" : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          <GoalIcon kind={option.icon} />
                        </span>
                        <span>
                          <span className="flex items-center gap-2 font-semibold text-zinc-100">
                            {option.label}
                            {selected && (
                              <span className="inline-flex items-center gap-1 text-xs text-blue-300">
                                <CheckIcon /> Selected
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-sm leading-relaxed text-zinc-400">
                            {option.description}
                          </span>
                          <span className="mt-2 inline-flex items-center rounded-md bg-white/[0.05] px-2 py-0.5 text-xs font-medium text-blue-200/90 border border-white/[0.06]">
                            {option.badge}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <ChoicePills
              label="Experience level"
              hint="How long you have consistently engaged in structured lifting or training."
              value={selections.experience}
              options={EXPERIENCE_OPTIONS}
              onChange={(value) => update({ experience: value as ExperienceChoice })}
            />

            <IssueList issues={visibleIssues} />
            <div className="flex justify-end">
              <button
                className={`${primary} min-w-36 cursor-pointer`}
                disabled={busy}
                onClick={() =>
                  continueFromStage(1, [
                    "intakeVersion",
                    "goal",
                    "experienceLevel",
                    "goalStatus",
                    "bodyWeightIntent",
                    "goalPaceClass",
                    "weightNeutralAccepted",
                  ])
                }
              >
                {busy ? "Saving..." : "Continue"}
              </button>
            </div>
          </section>
        )}

        {stage === 1 && (
          <section aria-labelledby="intake-training-heading" className="space-y-7 p-5 sm:p-6">
            <div>
              <p className="text-sm font-medium text-blue-400">Step 2</p>
              <h2 id="intake-training-heading" className="mt-1 text-2xl font-bold text-zinc-100">
                Set up your training week
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                We will shape the plan around the time and equipment you actually have.
              </p>
            </div>

            <ChoicePills
              label="Days per week"
              hint="Choose how many days you can realistically commit to training every week."
              value={selections.trainingDaysPerWeek}
              options={[
                { value: 2, label: "2 days", description: "Minimal" },
                { value: 3, label: "3 days", description: "Full body" },
                { value: 4, label: "4 days", description: "Upper / Lower" },
                { value: 5, label: "5 days", description: "Body-part split" },
                { value: 6, label: "6 days", description: "Push / Pull / Legs" },
              ]}
              onChange={(value) => update({ trainingDaysPerWeek: Number(value) })}
            />

            <fieldset className="space-y-3">
              <div>
                <legend className="text-sm font-semibold text-zinc-200">Equipment setup</legend>
                <p className="mt-0.5 text-xs text-zinc-400">
                  The plan will select exercise variations that strictly match your equipment access.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {EQUIPMENT_OPTIONS.map((option) => {
                  const selected = selections.equipment === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      className={`${CHOICE_BASE} ${
                        selected
                          ? "border-blue-500 bg-blue-500/15 text-zinc-100"
                          : "border-white/[0.1] bg-zinc-950/40 text-zinc-300 hover:border-white/[0.2]"
                      }`}
                      onClick={() => update({ equipment: option.value })}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        {selected && <CheckIcon />}
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-zinc-400">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <ChoicePills
              label="Typical session length"
              hint="Total workout duration including warm-up."
              value={selections.sessionLength}
              options={SESSION_OPTIONS}
              onChange={(value) => update({ sessionLength: value as SessionLengthChoice })}
            />

            <IssueList issues={visibleIssues} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                className={`${button} cursor-pointer`}
                disabled={busy}
                onClick={() => setStage(0)}
              >
                Back
              </button>
              <button
                className={`${primary} min-w-36 cursor-pointer`}
                disabled={busy}
                onClick={() =>
                  continueFromStage(2, [
                    "intakeVersion",
                    "trainingDaysPerWeek",
                    "equipmentAccess",
                    "trainingContextStatus",
                    "resistanceTrainingContext",
                    "sessionLengthBand",
                  ])
                }
              >
                {busy ? "Saving..." : "Continue"}
              </button>
            </div>
          </section>
        )}

        {stage === 2 && (
          <section aria-labelledby="intake-nutrition-heading" className="space-y-7 p-5 sm:p-6">
            <div>
              <p className="text-sm font-medium text-blue-400">Step 3</p>
              <h2 id="intake-nutrition-heading" className="mt-1 text-2xl font-bold text-zinc-100">
                Make nutrition fit your style
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                A few clear preferences are more useful than a long food questionnaire.
              </p>
            </div>

            {selections.retainedDietaryPattern ? (
              <div className="space-y-2.5">
                <p className="text-sm font-semibold text-zinc-200">Dietary style</p>
                <div
                  role="note"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.1] bg-zinc-900/60 p-3 text-sm text-zinc-200"
                >
                  <p>
                    On file as a requirement:{" "}
                    <strong>
                      {selections.retainedDietaryPattern.pattern === "OTHER"
                        ? selections.retainedDietaryPattern.otherLabel
                        : DIETARY_PATTERN_LABELS[selections.retainedDietaryPattern.pattern]}
                    </strong>
                    . It stays in place unless you remove it.
                  </p>
                  <button
                    type="button"
                    className={`${button} cursor-pointer`}
                    onClick={() => update({ retainedDietaryPattern: undefined })}
                  >
                    Remove requirement
                  </button>
                </div>
              </div>
            ) : (
              <ChoicePills
                label="Dietary style"
                hint="Select the pattern you prefer. This is a preference, not a promise that a plan is available."
                value={selections.dietaryStyle}
                options={DIETARY_OPTIONS}
                onChange={(value) => update({ dietaryStyle: value as DietaryStyleChoice })}
              />
            )}

            <ChoicePills
              label="Food budget"
              hint="This choice can affect which meal templates are considered, so it is never filled in for you."
              value={selections.foodBudgetLevel}
              options={BUDGET_OPTIONS}
              onChange={(value) => update({ foodBudgetLevel: value as FoodBudgetChoice })}
            />

            <fieldset className="space-y-3">
              <div>
                <legend className="text-sm font-semibold text-zinc-200">
                  How do you want to track?
                </legend>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Choose how your meal and nutrition targets are presented on your dashboard.
                </p>
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-200 space-y-1.5">
                <p className="font-semibold text-blue-100">
                  Both tracking styles use the same saved plan data
                </p>
                <p className="text-blue-200/90 leading-relaxed">
                  Every proposed meal gives precise gram and cup quantities (e.g. <strong>100 g Jasmine Rice</strong>, <strong>150 g Chicken Breast</strong>, <strong>1 cup Rolled Oats</strong>).
                </p>
                <p className="text-zinc-300 leading-relaxed">
                  Choose <strong>Meal Portions</strong> to follow exact food weights on your plate without logging daily macro math. Choose <strong>Exact Macros</strong> to also see your daily calorie, protein, carb, and fat targets displayed on your dashboard.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {TRACKING_OPTIONS.map((option) => {
                  const selected = selections.trackingStyle === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      className={`${CHOICE_BASE} ${
                        selected
                          ? "border-blue-500 bg-blue-500/15"
                          : "border-white/[0.1] bg-zinc-950/40 hover:border-white/[0.2]"
                      }`}
                      onClick={() => update({ trackingStyle: option.value })}
                    >
                      <span className="flex items-center gap-2 font-semibold text-zinc-100">
                        {selected && <CheckIcon />}
                        {option.label}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-zinc-400">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <div>
                <legend className="text-sm font-semibold text-zinc-200">
                  Allergies or foods that must be avoided
                </legend>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Choose every item to exclude from your meals, or choose None if you have no restrictions.
                </p>
              </div>
              {intakeAlreadyConfirmed && (
                <p
                  role="note"
                  className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm leading-relaxed text-amber-100/90"
                >
                  Your intake is already confirmed. If you change these answers, that counts as new
                  safety information: nutrition recommendations are paused and any plan being
                  prepared is cancelled, until an authorized Steadfast reviewer reviews the change.
                  You cannot lift that pause yourself.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {ALLERGEN_OPTIONS.map((option) => {
                  const selected = selections.allergens.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      className={`${CHOICE_BASE} inline-flex items-center gap-2 ${
                        selected
                          ? option.value === "NONE"
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                            : "border-blue-500 bg-blue-500/15 text-blue-100"
                          : "border-white/[0.1] bg-zinc-900/60 text-zinc-300 hover:border-white/[0.2]"
                      }`}
                      onClick={() =>
                        update({ allergens: toggleAllergen(selections.allergens, option.value) })
                      }
                    >
                      {selected && <CheckIcon />}
                      {option.label}
                      {selected && chipDetail(option.value) && (
                        <span className="text-xs opacity-75">({chipDetail(option.value)})</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(selections.retainedAllergenItems?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-zinc-200">Also on file</p>
                  <p className="text-xs text-zinc-400">
                    These stay excluded unless you remove them.
                  </p>
                  <ul className="space-y-2">
                    {selections.retainedAllergenItems?.map((item, index) => (
                      <li
                        key={`${item.category}-${item.specificity ?? ""}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.1] bg-zinc-900/60 p-3 text-sm text-zinc-200"
                      >
                        <span>{describeAllergenItem(item)}</span>
                        <button
                          type="button"
                          className={`${button} cursor-pointer`}
                          aria-label={`Remove ${describeAllergenItem(item)}`}
                          onClick={() =>
                            update({
                              retainedAllergenItems: selections.retainedAllergenItems?.filter(
                                (kept) => kept !== item
                              ),
                            })
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </fieldset>

            <IssueList issues={visibleIssues} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                className={`${button} cursor-pointer`}
                disabled={busy}
                onClick={() => setStage(1)}
              >
                Back
              </button>
              <button
                className={`${primary} min-w-36 cursor-pointer`}
                disabled={busy}
                onClick={() =>
                  continueFromStage(
                    3,
                    [
                      "intakeVersion",
                      "foodBudgetLevel",
                      "trackingPreference",
                      "dietaryPattern",
                      "dislikes",
                      "cuisinePreferences",
                    ],
                    true
                  )
                }
              >
                {busy ? "Saving..." : "Continue"}
              </button>
            </div>
          </section>
        )}

        {stage === 3 && (
          <section aria-labelledby="intake-stats-heading" className="space-y-7 p-5 sm:p-6">
            <div>
              <p className="text-sm font-medium text-blue-400">Step 4</p>
              <h2 id="intake-stats-heading" className="mt-1 text-2xl font-bold text-zinc-100">
                Last step: your starting stats
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Height, weight, and age are saved for the reviewed preparation rules. If required
                inputs or reviewed content are unavailable, preparation stays on hold instead of
                guessing.
              </p>
            </div>

            <ChoicePills
              label="Units"
              value={selections.unitSystem}
              options={[
                { value: "IMPERIAL", label: "lb / ft–in" },
                { value: "METRIC", label: "kg / cm" },
              ]}
              onChange={(value) => update({ unitSystem: value as UnitSystem })}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              {selections.unitSystem === "IMPERIAL" ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-zinc-200">Height</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-sm text-zinc-400">
                      Feet
                      <input
                        aria-label="Height in feet"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={9}
                        className={INPUT_CLASS}
                        style={inputStyle}
                        value={imperialHeight.feet ?? ""}
                        onChange={(event) => {
                          const feet =
                            event.target.value === "" ? undefined : Number(event.target.value);
                          const inches = imperialHeight.inches ?? pendingInches ?? 0;
                          if (feet === undefined) setPendingInches(imperialHeight.inches);
                          else setPendingInches(undefined);
                          update({
                            heightCm:
                              feet === undefined
                                ? undefined
                                : feetAndInchesToCentimeters(feet, inches),
                          });
                        }}
                      />
                    </label>
                    <label className="text-sm text-zinc-400">
                      Inches
                      <input
                        aria-label="Additional height in inches"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={11}
                        className={INPUT_CLASS}
                        style={inputStyle}
                        value={imperialHeight.inches ?? pendingInches ?? ""}
                        onChange={(event) => {
                          const inches =
                            event.target.value === "" ? undefined : Number(event.target.value);
                          if (imperialHeight.feet === undefined) {
                            setPendingInches(inches);
                            return;
                          }
                          update({
                            heightCm:
                              inches === undefined || imperialHeight.feet === undefined
                                ? undefined
                                : feetAndInchesToCentimeters(imperialHeight.feet, inches),
                          });
                        }}
                      />
                    </label>
                  </div>
                </fieldset>
              ) : (
                <label className="text-sm font-semibold text-zinc-200">
                  Height (cm)
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={300}
                    step="0.1"
                    className={INPUT_CLASS}
                    style={inputStyle}
                    value={selections.heightCm ?? ""}
                    onChange={(event) =>
                      update({
                        heightCm:
                          event.target.value === "" ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </label>
              )}

              <label className="text-sm font-semibold text-zinc-200">
                Weight ({selections.unitSystem === "IMPERIAL" ? "lb" : "kg"})
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="0.1"
                  className={INPUT_CLASS}
                  style={inputStyle}
                  value={
                    selections.weightKg === undefined
                      ? ""
                      : selections.unitSystem === "IMPERIAL"
                        ? kilogramsToPounds(selections.weightKg)
                        : round(selections.weightKg, 1)
                  }
                  onChange={(event) => {
                    const value =
                      event.target.value === "" ? undefined : Number(event.target.value);
                    update({
                      weightKg:
                        value === undefined
                          ? undefined
                          : selections.unitSystem === "IMPERIAL"
                            ? poundsToKilograms(value)
                            : value,
                      ...(value === undefined ? {} : { weightMeasuredOn: localDateString() }),
                    });
                  }}
                />
              </label>

              <label className="text-sm font-semibold text-zinc-200 sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
                Age
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  step={1}
                  className={INPUT_CLASS}
                  style={inputStyle}
                  value={selections.ageYears ?? ""}
                  onChange={(event) =>
                    update({
                      ageYears: event.target.value === "" ? undefined : Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>

            {needsSafetyDisclosure && (
              <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-zinc-950/40 p-4 sm:p-5">
                <div>
                  <h3 className="font-semibold text-zinc-100">Quick safety check</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                    These answers tell the server whether preparation can continue or must pause.
                    Do any of the following apply to you?
                  </p>
                  {/* Finding 4: every condition is visible before a one-tap No can be recorded. */}
                  <ul
                    id="intake-safety-conditions"
                    className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-200"
                  >
                    {SAFETY_FIELDS.map(({ key, label }) => (
                      <li key={key}>{label}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                    If none of them apply, choose &ldquo;None of these apply&rdquo;; otherwise open
                    the questions and answer each one.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-describedby="intake-safety-conditions"
                    aria-pressed={
                      safetyAnswersComplete(safetyAnswers) &&
                      Object.values(safetyAnswers).every((answer) => answer === "NO")
                    }
                    className={`${CHOICE_BASE} ${
                      safetyAnswersComplete(safetyAnswers) &&
                      Object.values(safetyAnswers).every((answer) => answer === "NO")
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                        : "border-white/[0.1] bg-zinc-900/60 text-zinc-200 hover:border-white/[0.2]"
                    }`}
                    onClick={() => {
                      setSafetyAnswers(
                        Object.fromEntries(SAFETY_FIELDS.map(({ key }) => [key, "NO"])) as Record<
                          SafetyKey,
                          SafetyAnswer
                        >
                      );
                      setShowSafetyDetails(false);
                    }}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {safetyAnswersComplete(safetyAnswers) &&
                        Object.values(safetyAnswers).every((answer) => answer === "NO") && (
                          <CheckIcon />
                        )}
                      None of these apply
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-expanded={showSafetyDetails}
                    className={`${CHOICE_BASE} border-white/[0.1] bg-zinc-900/60 text-zinc-200 hover:border-white/[0.2]`}
                    onClick={() => setShowSafetyDetails((shown) => !shown)}
                  >
                    Something applies or I’m unsure
                  </button>
                </div>

                {showSafetyDetails && (
                  <div className="space-y-4 border-t border-white/[0.06] pt-4">
                    {SAFETY_FIELDS.map(({ key, label }) => (
                      <ChoicePills
                        key={key}
                        label={label}
                        value={safetyAnswers[key]}
                        options={[
                          { value: "YES", label: "Yes" },
                          { value: "NO", label: "No" },
                          { value: "UNSURE", label: "Not sure" },
                        ]}
                        onChange={(value) =>
                          setSafetyAnswers((current) => ({
                            ...current,
                            [key]: value as SafetyAnswer,
                          }))
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-zinc-950/30 p-3 text-center">
              <div>
                <p className="text-xs text-zinc-500">Goal</p>
                <p className="mt-1 text-sm font-medium text-zinc-200">
                  {GOAL_OPTIONS.find((option) => option.value === selections.goal)?.label ??
                    "Not set"}
                </p>
              </div>
              <div className="border-x border-white/[0.06] px-2">
                <p className="text-xs text-zinc-500">Training</p>
                <p className="mt-1 text-sm font-medium text-zinc-200">
                  {selections.trainingDaysPerWeek ?? "–"} days
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Tracking</p>
                <p className="mt-1 text-sm font-medium text-zinc-200">
                  {selections.trackingStyle === "EXACT_MACROS"
                    ? "Macros"
                    : selections.trackingStyle === "PORTIONS"
                      ? "Portions"
                      : "Not set"}
                </p>
              </div>
            </div>

            {intakeAlreadyConfirmed && (
              // Finding 5: resume lands a confirmed client here, past step 3's warning.
              <p
                role="note"
                className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm leading-relaxed text-amber-100/90"
              >
                Your intake is already confirmed. If you changed your allergy answers,
                confirming counts as new safety information: nutrition
                recommendations are paused and any plan being prepared is cancelled, until an
                authorized Steadfast reviewer reviews the change. You cannot lift that pause
                yourself. Allergy answers you left unchanged do not trigger this.
              </p>
            )}

            <IssueList issues={visibleIssues} />
            <div className="space-y-3">
              <button
                className={`${primary} inline-flex w-full cursor-pointer items-center justify-center text-base font-semibold`}
                disabled={busy}
                onClick={() => {
                  if (currentIssues.length > 0) {
                    setIssueStage(stage);
                    return;
                  }
                  void act(
                    () =>
                      confirmAndRedirect({
                        selections,
                        safetyAnswers,
                        needsSafetyDisclosure,
                        command,
                        redirect: () => {
                          // A hard navigation reloads the confirmed workspace instead of
                          // leaving stale wizard state mounted after the command succeeds.
                          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                          window.location.assign("/client/ai-coach");
                        },
                      }),
                    "Intake confirmed. Review the coaching disclosure and consent to continue."
                  );
                }}
              >
                {busy ? "Saving your answers..." : "Confirm my answers"}
              </button>
              {/* S-19 dead end 2: this button confirms the intake. It does not
                  enrol and it does not build a plan — enrolment records a
                  consent decision against disclosure text the client has to
                  have been shown, and that text lives on the next screen. The
                  label now says what happens; the caption says what is left. */}
              <p className="text-sm leading-relaxed text-zinc-400">
                Next you will review the AI coaching disclosure and give consent. Your plan is
                prepared after that — this step does not start it.
              </p>
              <button
                className={`${button} inline-flex w-full cursor-pointer items-center justify-center`}
                disabled={busy}
                onClick={() => setStage(2)}
              >
                Back
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
