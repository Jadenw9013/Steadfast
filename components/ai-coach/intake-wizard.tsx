"use client";

import { useState } from "react";
import {
  allergenDeclarationsSchema,
  intakeV2ConfirmObjectSchema,
  intakeV2ConfirmSchema,
  type AllergenDeclaration,
  type AllergenDeclarations,
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
  allergens: AllergenChoice[];
  unitSystem: UnitSystem;
  heightCm?: number;
  weightKg?: number;
  ageYears?: number;
  weightMeasuredOn: string;
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
  "mt-2 min-h-12 w-full rounded-xl border border-white/[0.12] bg-zinc-950/70 px-4 py-3 text-base text-zinc-100 transition-colors placeholder:text-zinc-600 focus-visible:border-blue-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30";
const CHOICE_BASE =
  "min-h-12 cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const GOAL_OPTIONS: {
  value: GoalChoice;
  label: string;
  description: string;
  icon: "down" | "up" | "bar" | "spark";
}[] = [
  {
    value: "FAT_LOSS",
    label: "Fat Loss / Cut",
    description: "Build a sustainable routine around leaning out.",
    icon: "down",
  },
  {
    value: "BUILD_MUSCLE",
    label: "Build Muscle",
    description: "Prioritize muscle gain and consistent training.",
    icon: "up",
  },
  {
    value: "STRENGTH",
    label: "Strength",
    description: "Focus your plan on getting stronger.",
    icon: "bar",
  },
  {
    value: "GENERAL_FITNESS",
    label: "General Fitness",
    description: "Create a balanced routine you can stick with.",
    icon: "spark",
  },
];

const EXPERIENCE_OPTIONS = [
  { value: "BEGINNER", label: "Beginner" },
  { value: "INTERMEDIATE", label: "Intermediate" },
  { value: "ADVANCED", label: "Advanced" },
] satisfies { value: ExperienceChoice; label: string }[];

const EQUIPMENT_OPTIONS = [
  { value: "BODYWEIGHT", label: "Bodyweight", description: "No equipment needed" },
  { value: "HOME_DUMBBELLS", label: "Home Dumbbells", description: "A simple home setup" },
  { value: "FULL_GYM", label: "Full Gym", description: "Machines, cables, and free weights" },
] satisfies { value: EquipmentChoice; label: string; description: string }[];

const SESSION_OPTIONS = [
  { value: "MIN_30_45", label: "30–45m" },
  { value: "MIN_45_60", label: "45–60m" },
  { value: "MIN_60_PLUS", label: "60m+" },
] satisfies { value: SessionLengthChoice; label: string }[];

const DIETARY_OPTIONS = [
  { value: "BALANCED", label: "Balanced" },
  { value: "HIGH_PROTEIN", label: "High Protein" },
  { value: "PLANT_BASED", label: "Plant-Based" },
  { value: "LOW_CARB", label: "Low Carb" },
] satisfies { value: DietaryStyleChoice; label: string }[];

const TRACKING_OPTIONS = [
  {
    value: "PORTIONS",
    label: "Portions",
    description: "Simple serving guidance without weighing everything.",
  },
  {
    value: "EXACT_MACROS",
    label: "Exact Macros",
    description: "Show calories, protein, carbs, and fats.",
  },
] satisfies { value: TrackingStyleChoice; label: string; description: string }[];

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
  const label = typeof pattern.otherLabel === "string" ? pattern.otherLabel.toLowerCase() : "";
  if (label === "balanced") return "BALANCED";
  if (label === "high protein") return "HIGH_PROTEIN";
  if (label === "plant-based" || label === "plant based") return "PLANT_BASED";
  if (label === "low carb") return "LOW_CARB";
  return undefined;
}

function allergenChoiceFor(item: AllergenDeclaration): AllergenChoice | undefined {
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

export function createIntakeSelections(seed: Answers, today = localDateString()): IntakeSelections {
  const parsedDeclarations = allergenDeclarationsSchema.safeParse(seed.allergenDeclarations);
  const sourceAllergenDeclarations = parsedDeclarations.success
    ? parsedDeclarations.data
    : undefined;
  return {
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

function mappedResistanceContext(
  choice?: ExperienceChoice
): IntakeV2ConfirmAnswers["resistanceTrainingContext"] | undefined {
  // Conservative compatibility mapping for the jointly-governed legacy pair.
  if (choice === "BEGINNER") return "NONE";
  if (choice === "INTERMEDIATE") return "OCCASIONAL";
  if (choice === "ADVANCED") return "REGULAR";
  return undefined;
}

function mappedSessionLength(
  choice?: SessionLengthChoice
): IntakeV2ConfirmAnswers["sessionLengthBand"] | undefined {
  if (choice === "MIN_60_PLUS") return "MIN_60_90";
  return choice;
}

function mappedDietaryPattern(
  choice?: DietaryStyleChoice
): IntakeV2ConfirmAnswers["dietaryPattern"] {
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

export function buildAllergenDeclarations(selections: IntakeSelections): AllergenDeclarations {
  if (selections.allergens.includes("NONE"))
    return { status: "CONFIRMED", noKnownAllergens: true, items: [] };
  if (selections.allergens.length === 0) return EMPTY_ALLERGEN_DECLARATIONS;

  const selected = selections.allergens.filter(
    (choice): choice is Exclude<AllergenChoice, "NONE"> => choice !== "NONE"
  );
  // The compact flow only re-confirms what its visible tags can express.
  // It deliberately does not copy hidden species, kind, or cross-contact
  // detail from an older intake into a new user confirmation.
  const items = selected.map(declarationForChoice);
  return allergenDeclarationsSchema.parse({
    status: "CONFIRMED",
    noKnownAllergens: false,
    items,
  });
}

export function mapSelectionsToAnswers(selections: IntakeSelections): Answers {
  const goal = mappedGoal(selections.goal);
  const experienceLevel = mappedExperience(selections.experience);
  const equipmentAccess = mappedEquipment(selections.equipment);
  const resistanceTrainingContext = mappedResistanceContext(selections.experience);
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
    foodBudgetLevel: "MODERATE",
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
    ...(hasTrainingContext ? { resistanceTrainingContext, sessionLengthBand } : {}),
    cookingAccessStatus: "UNKNOWN",
    dislikes: [],
    cuisinePreferences: [],
    allergenDeclarations: buildAllergenDeclarations(selections),
    dietaryPattern: mappedDietaryPattern(selections.dietaryStyle),
  };
}

export function buildConfirmPayload(selections: IntakeSelections): IntakeV2ConfirmAnswers {
  const mapped = mapSelectionsToAnswers(selections);
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
    if (!selections.dietaryStyle) issues.push("Choose a dietary style.");
    if (!selections.trackingStyle) issues.push("Choose a tracking style.");
    if (selections.allergens.length === 0) issues.push("Choose any allergens, or choose None.");
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
}: {
  label: string;
  value?: string | number;
  options: { value: string | number; label: string }[];
  onChange: (value: string | number) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-zinc-200">{label}</legend>
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
              {option.label}
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
    <div role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
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
  initialStage = 0,
}: {
  view: { confirmedIntake: unknown; draft: unknown };
  busy: boolean;
  act: (work: () => Promise<unknown>, success: string) => Promise<void>;
  command: (input: Record<string, unknown>) => Promise<unknown>;
  post: (url: string, input: Record<string, unknown>) => Promise<unknown>;
  initialStage?: number;
}) {
  const seed = { ...record(view.confirmedIntake), ...record(view.draft) };
  const [stage, setStage] = useState(initialStage);
  const [selections, setSelections] = useState<IntakeSelections>(() =>
    createIntakeSelections(seed)
  );
  const [safetyAnswers, setSafetyAnswers] = useState<SafetyAnswers>({});
  const [showSafetyDetails, setShowSafetyDetails] = useState(false);
  const [issueStage, setIssueStage] = useState<number | null>(null);
  const needsSafetyDisclosure = view.confirmedIntake === null;

  const update = (patch: Partial<IntakeSelections>) =>
    setSelections((current) => ({ ...current, ...patch }));

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
                className={`h-1.5 rounded-full transition-colors duration-200 ${
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
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <ChoicePills
              label="Experience level"
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
              value={selections.trainingDaysPerWeek}
              options={[2, 3, 4, 5, 6].map((day) => ({ value: day, label: String(day) }))}
              onChange={(value) => update({ trainingDaysPerWeek: Number(value) })}
            />

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-zinc-200">Equipment</legend>
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
                      <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <ChoicePills
              label="Typical session length"
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

            <ChoicePills
              label="Dietary style"
              value={selections.dietaryStyle}
              options={DIETARY_OPTIONS}
              onChange={(value) => update({ dietaryStyle: value as DietaryStyleChoice })}
            />

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-zinc-200">
                How do you want to track?
              </legend>
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
              <legend className="text-sm font-semibold text-zinc-200">
                Allergies or foods that must be avoided
              </legend>
              <p className="text-sm text-zinc-500">
                Choose every item that applies, or choose None.
              </p>
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
                    </button>
                  );
                })}
              </div>
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
                These help size the starting plan. We will not guess missing details.
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
                          update({
                            heightCm:
                              feet === undefined
                                ? undefined
                                : feetAndInchesToCentimeters(feet, imperialHeight.inches ?? 0),
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
                        value={imperialHeight.inches ?? ""}
                        onChange={(event) => {
                          const inches =
                            event.target.value === "" ? undefined : Number(event.target.value);
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
                    We need this once before building a plan. If none apply, it is one tap.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
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
                    "Intake confirmed. Returning to your coaching plan..."
                  );
                }}
              >
                {busy ? "Building your plan..." : "Confirm & Build Plan"}
              </button>
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
