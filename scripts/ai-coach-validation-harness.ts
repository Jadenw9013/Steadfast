/**
 * AI Coach v1 validation harness — an engineering TOOL, never product code.
 *
 * WHY THIS FILE IS IN `scripts/`
 * ------------------------------
 * It statically imports the DRAFT_UNSIGNED artifact loaders, which in turn
 * statically import the draft JSON (policy bundle, exercise catalog, evidence
 * registry, escalation templates). Any module under `lib/`, `app/` or
 * `components/` that imported this file would drag that content into a server
 * or browser bundle — exactly how T-2038 shipped a whole unsigned movement
 * catalog into a client chunk. `scripts/` is outside every Next.js bundle
 * graph and outside `tsconfig.json`'s `include`, so nothing product-facing can
 * reach it. Do not import this module from anywhere.
 *
 * WHAT IT DOES
 * ------------
 * Runs the real, checked-in AI Coach engines over a systematically enumerated
 * grid of SYNTHETIC client profiles and reports the *distribution* of what the
 * engines produce. It never reads, writes or connects to a database, so it
 * cannot touch a real client's health information; `assertNoDatabaseReachable()`
 * below removes the connection string from the process environment before any
 * engine module is used, so an accidental query fails instead of connecting.
 *
 * Every profile is machine-generated from a declared axis grid. Nothing in the
 * output describes a real person, and no distribution here is a statement
 * about Steadfast's real clients.
 *
 * ENGINES EXERCISED (all pure, all the real shipped implementations)
 *   lib/ai-coach/prescription            resolvePrescriptionParameters, computePrescription
 *   lib/ai-coach/training                resolveTrainingParameters, composeTraining
 *   lib/ai-coach/initial-plan            composeInitialPlan (v2 prescription-first path)
 *   lib/ai-coach/composition-feasibility checkMealComposition
 *   lib/ai-coach/nutrition-safety        resolveNutritionSafetyPolicy, evaluateNutritionSafety
 *   lib/ai-coach/autonomy/gate           evaluateAutonomyGate
 *
 * NOT EXERCISED, AND WHY (also stated in the report)
 *   - `resolvePrescriptionParametersForArtifacts` and
 *     `resolveReviewedPrescriptionExplanationTexts` take a `ReviewedArtifactSet`
 *     whose members must be in `artifacts/repository.ts`'s private WeakSet,
 *     populated only by the DB-backed loader. The harness therefore composes
 *     the same three calls that wrapper makes (`getReviewedPolicyBundleContent`
 *     -> the raw parsed bundle, `resolveNutritionSafetyPolicy`,
 *     `resolvePrescriptionParameters`) and re-creates only the six-line
 *     bundle-order template lookup. That divergence is named in the report.
 *   - Artifact publication, revocation, expiry, digest verification and the
 *     account-classification checks: all DB-bound.
 *
 * USAGE
 *   pnpm exec tsx scripts/ai-coach-validation-harness.ts \
 *     [--runs draft,fixture] [--bundle <path-to-draft-bundle.json>] \
 *     [--seed 20260927] [--random 1000] [--evaluated-on 2026-09-27] \
 *     [--out <report.md>]
 *
 *   --runs     which parameter sources to report on, in order.
 *              `draft`   = the checked-in DRAFT_UNSIGNED artifacts (mode 1: the
 *                          fail-closed proof, which is what today's repository
 *                          can honestly produce).
 *              `fixture` = the repository's already-labelled SYNTHETIC fixture
 *                          policy bundle, whose 121 parameters are all present.
 *                          This is the *shape* demonstration of mode 2; its
 *                          numbers are fixture numbers and mean nothing
 *                          clinically.
 *              `bundle`  = a caller-supplied draft-bundle JSON file with the
 *                          same envelope as the checked-in draft. This is how
 *                          mode 2 runs for real once the values are signed —
 *                          no code change.
 *   --out      write the markdown report here (default: stdout).
 *
 * Deterministic for a given (--seed, --random, --evaluated-on, artifact
 * digests). The report prints a run key over exactly those inputs.
 */

import fs from "node:fs";
import path from "node:path";

import { contentHash } from "../lib/ai-coach/canonical-json";
import {
  escalationTemplatesContentSchema,
  evidenceRegistryContentSchema,
  policyBundleContentSchema,
  type PolicyBundleContent,
} from "../lib/ai-coach/artifacts/schema";
import { loadDraftUnsignedPolicyBundle } from "../lib/ai-coach/artifacts/drafts/loader";
import { loadDraftUnsignedEscalationTemplates } from "../lib/ai-coach/artifacts/drafts/escalation-templates";
import { loadDraftUnsignedEvidenceRegistry } from "../lib/ai-coach/artifacts/drafts/evidence-registry";
import { loadDraftUnsignedExerciseCatalog } from "../lib/ai-coach/artifacts/drafts/exercise-catalog";
import {
  DRAFT_FOOD_CATALOG_FILENAME,
  draftFoodCatalogFileSchema,
} from "../lib/ai-coach/artifacts/drafts/loader";
import { buildSyntheticArtifactSet } from "../lib/ai-coach/artifacts/synthetic-fixtures";
import { trainingCatalogSourceFromArtifactContent } from "../lib/ai-coach/training/catalog-source";
import type {
  ResolvedTrainingParameters,
  TrainingCatalogSource,
} from "../lib/ai-coach/training/types";
import { composeTraining } from "../lib/ai-coach/training";
import {
  TRAINING_COMPOSER_PARAMETER_IDS,
  TRAINING_PROGRESSION_PARAMETER_IDS,
  resolveTrainingParameters,
  EFFORT_CARDIO_TEMPLATE_ID,
  EFFORT_STRENGTH_TEMPLATE_ID,
} from "../lib/ai-coach/training/parameters";
import {
  ENERGY_PER_KG_BODY_MASS_ID,
  PRESCRIPTION_PARAMETER_SPECS,
  resolvePrescriptionParameters,
  type ResolvedPrescriptionParameters,
} from "../lib/ai-coach/prescription/parameters";
import {
  buildPrescriptionInput,
  computePrescription,
  nutritionRequiredForGoal,
  type PrescriptionInput,
} from "../lib/ai-coach/prescription";
import { classifyPrescriptionReasonCodes } from "../lib/ai-coach/prescription-reason-classes";
import {
  evaluateNutritionSafety,
  resolveNutritionSafetyPolicy,
  type NutritionSafetyHistory,
  type NutritionSafetyPolicy,
} from "../lib/ai-coach/nutrition-safety";
import { evaluateAutonomyGate } from "../lib/ai-coach/autonomy/gate";
import type { AutonomyGateFacts, ServerAutonomyGateInput } from "../lib/ai-coach/autonomy/gate";
import {
  deriveEvidenceGateEntries,
  unsubstantiatedEvidenceRuleIds,
  type EvidenceClaimCoverage,
} from "../lib/ai-coach/autonomy/evidence-status";
import { composeInitialPlan } from "../lib/ai-coach/initial-plan";
import { checkMealComposition } from "../lib/ai-coach/composition-feasibility";
import { getFoodItem } from "../lib/ai-coach/catalog/loader";
import { FOOD_CATALOG_VERSION } from "../lib/ai-coach/catalog/food-catalog";
import { ACTIVE_POLICY_VERSION } from "../lib/ai-coach/policy/policy-version";
import { intakeAnswersSchema, type FieldStatus } from "../lib/ai-coach/intake-contract";
import {
  ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID,
  resolveAdaptiveParameters,
  type ResolvedAdaptiveParameters,
} from "../lib/ai-coach/adaptive/parameters";
import type { WeightReading } from "../lib/ai-coach/adaptive/weight-trend";
import type { NutritionLogDay } from "../lib/ai-coach/adaptive/intake-window";
import { estimateObservedExpenditure } from "../lib/ai-coach/adaptive/expenditure";
import { evaluateAdaptiveGate } from "../lib/ai-coach/adaptive/gate";

/* ------------------------------------------------------------------ guards */

/**
 * The hard boundary. This tool runs on synthetic profiles only; there is no
 * reason for it ever to open a connection, so we make one impossible rather
 * than merely unlikely. `lib/db.ts` builds its client lazily inside a Proxy
 * and throws when `DATABASE_URL` is absent, so removing the variable turns any
 * accidental query into an immediate, loud failure instead of a live read.
 */
function assertNoDatabaseReachable(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The validation harness never runs with NODE_ENV=production.");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL", "POSTGRES_URL", "SHADOW_DATABASE_URL"]) {
    delete process.env[key];
  }
}

/* --------------------------------------------------------------- utilities */

type Stats = { n: number; min: number; median: number; max: number; mean: number };

function stats(values: readonly number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    // Lower median: deterministic and never invents a value between samples.
    median: sorted[Math.floor((sorted.length - 1) / 2)],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

class Counter {
  private readonly counts = new Map<string, number>();
  add(key: string, by = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + by);
  }
  /** Declares a key with zero so "never fired" is reportable, not just absent. */
  declare(key: string): void {
    if (!this.counts.has(key)) this.counts.set(key, 0);
  }
  get total(): number {
    let total = 0;
    for (const value of this.counts.values()) total += value;
    return total;
  }
  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }
  entries(): [string, number][] {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  zeroKeys(): string[] {
    return this.entries()
      .filter(([, count]) => count === 0)
      .map(([key]) => key);
  }
}

/** Deterministic 32-bit LCG. No crypto, no Math.random: a seed must reproduce. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length) % values.length];
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function fmt(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return String(round(value, decimals));
}

function statsRow(label: string, unit: string, s: Stats | null): string {
  if (!s) return `| ${label} | ${unit} | 0 | — | — | — | — |`;
  return `| ${label} | ${unit} | ${s.n} | ${fmt(s.min)} | ${fmt(s.median)} | ${fmt(s.max)} | ${fmt(s.mean)} |`;
}

function shiftDate(isoDate: string, deltaDays: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`) + deltaDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------- axes */

const POPULATIONS = ["MALE_ADULT", "FEMALE_ADULT", "PREGNANCY", "LACTATION", "NOT_LISTED"] as const;
const ACTIVITIES = ["INACTIVE", "LOW_ACTIVE", "ACTIVE", "VERY_ACTIVE"] as const;
const INTENTS = ["LOSE", "MAINTAIN", "GAIN", "NO_PREFERENCE"] as const;
const PACES = ["MAINTAIN", "GRADUAL", "MODERATE", "UNDECIDED"] as const;
const RESISTANCE = ["NONE", "OCCASIONAL", "REGULAR"] as const;
const PATTERNS = [
  "OMNIVORE",
  "LACTO_OVO_VEGETARIAN",
  "VEGAN",
  "PESCATARIAN",
  "OTHER",
  "NONE_DECLARED",
] as const;
const PATTERN_REASONS = [
  "PREFERENCE",
  "RELIGIOUS_OR_ETHICAL",
  "MEDICAL_OR_CLINICIAN_DIRECTED",
  "NOT_STATED",
] as const;
const EXPERIENCES = ["NEW", "RETURNING", "EXPERIENCED"] as const;
const BANDS = ["UNDER_30", "MIN_30_45", "MIN_45_60", "MIN_60_90", "OVER_90"] as const;
const EQUIPMENT_SUBSETS: readonly ("NONE" | "HOME_BASIC" | "FULL_GYM")[][] = [
  ["NONE"],
  ["HOME_BASIC"],
  ["FULL_GYM"],
  ["NONE", "HOME_BASIC"],
  ["NONE", "FULL_GYM"],
  ["HOME_BASIC", "FULL_GYM"],
  ["NONE", "HOME_BASIC", "FULL_GYM"],
];
const TRAINING_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DIETARY_RESTRICTION_SETS: readonly string[][] = [
  [],
  ["GLUTEN_FREE"],
  ["DAIRY_FREE"],
  ["VEGAN"],
];
const ALLERGY_SETS: readonly string[][] = [[], ["PEANUT"], ["MILK"]];
/** Weighted status draw for the random block: CONFIRMED is the common case. */
const STATUS_DRAW: readonly FieldStatus[] = [
  "CONFIRMED",
  "CONFIRMED",
  "CONFIRMED",
  "DECLINED",
  "UNKNOWN",
];
const PATTERN_STATUS_DRAW: readonly FieldStatus[] = [
  "CONFIRMED",
  "CONFIRMED",
  "DECLINED",
  "UNKNOWN",
];
const BANDS_OR_NULL: readonly ((typeof BANDS)[number] | null)[] = [...BANDS, null];
const SCREENING_DRAW: readonly ("CLEAR" | "FLAGGED" | "UNKNOWN")[] = [
  "CLEAR",
  "CLEAR",
  "CLEAR",
  "FLAGGED",
  "UNKNOWN",
];
const CONTRA_STATUS_DRAW: readonly ("CLEAR" | "EXCLUDED" | "UNKNOWN")[] = [
  "CLEAR",
  "CLEAR",
  "CLEAR",
  "EXCLUDED",
  "UNKNOWN",
];
const MEASUREMENT_OFFSET_DRAW: readonly number[] = [0, 0, 1, 7, 30, 90, 365, -1];

const NUTRITION_CONTRA_KEYS = [
  "AGE_ELIGIBILITY",
  "PREGNANCY_POSTPARTUM",
  "EATING_DISORDER_HISTORY_OR_CONCERN",
  "TYPE_1_DIABETES",
  "CARDIAC_CONDITION",
] as const;
type NutritionContraKey = (typeof NUTRITION_CONTRA_KEYS)[number];

type Axes = {
  ageYears: number | null;
  ageStatus: FieldStatus;
  population: (typeof POPULATIONS)[number] | null;
  populationStatus: FieldStatus;
  activity: (typeof ACTIVITIES)[number] | null;
  activityStatus: FieldStatus;
  heightCm: number | null;
  weightKg: number | null;
  weightMeasuredOffsetDays: number | null;
  bodyMeasurementStatus: FieldStatus;
  intent: (typeof INTENTS)[number] | null;
  pace: (typeof PACES)[number] | null;
  goalStatus: FieldStatus;
  resistance: (typeof RESISTANCE)[number] | null;
  sessionLengthBand: (typeof BANDS)[number] | null;
  trainingContextStatus: FieldStatus;
  pattern: (typeof PATTERNS)[number] | null;
  patternReason: (typeof PATTERN_REASONS)[number];
  patternStatus: FieldStatus;
  trainingDaysPerWeek: number;
  equipmentAccess: readonly ("NONE" | "HOME_BASIC" | "FULL_GYM")[];
  experienceLevel: (typeof EXPERIENCES)[number];
  dietaryRestrictions: readonly string[];
  allergies: readonly string[];
  intakeVersion: 1 | 2;
  /** Movement-level contraindication rule IDs active for this profile. */
  movementContraindications: readonly string[];
  /** Nutrition-safety screening result and the five contraindication inputs. */
  screeningResult: "CLEAR" | "FLAGGED" | "UNKNOWN";
  nutritionContraindications: Record<NutritionContraKey, "CLEAR" | "EXCLUDED" | "UNKNOWN">;
  history: NutritionSafetyHistory;
};

type Profile = { id: string; block: string; axes: Axes };

const CLEAR_NUTRITION_CONTRA: Record<NutritionContraKey, "CLEAR"> = {
  AGE_ELIGIBILITY: "CLEAR",
  PREGNANCY_POSTPARTUM: "CLEAR",
  EATING_DISORDER_HISTORY_OR_CONCERN: "CLEAR",
  TYPE_1_DIABETES: "CLEAR",
  CARDIAC_CONDITION: "CLEAR",
};

const NEUTRAL_HISTORY: NutritionSafetyHistory = {
  currentDailyEnergyKcal: null,
  lastMaterialEnergyDirection: "NONE",
  sourcePlanVersionIds: [],
};

/* ---------------------------------------------------------- grid building */

type BodyGrid = { ages: number[]; heights: number[]; weights: number[] };

/**
 * The body-metric grid is derived from the **bundle's own** declared input
 * ranges, never from a number invented here: for each dimension we take
 * `min-1, min, min+1, midpoint, max-1, max, max+1`. A bound that is wrong is
 * wrong at its edge, and the two out-of-range points prove the range check
 * fires on the correct side.
 */
function bodyGridFromBundle(policy: PolicyBundleContent): BodyGrid {
  const value = (id: string, fallback: number): number =>
    policy.numericParameters.find((parameter) => parameter.id === id)?.value ?? fallback;
  const dimension = (minId: string, maxId: string, minFallback: number, maxFallback: number) => {
    const min = value(minId, minFallback);
    const max = value(maxId, maxFallback);
    const mid = Math.round((min + max) / 2);
    return [min - 1, min, min + 1, mid, max - 1, max, max + 1];
  };
  return {
    ages: dimension(
      "ENERGY.EER.NASEM2023.INPUT_RANGE.AGE_YEARS.MIN",
      "ENERGY.EER.NASEM2023.INPUT_RANGE.AGE_YEARS.MAX",
      19,
      80
    ),
    heights: dimension(
      "ENERGY.EER.NASEM2023.INPUT_RANGE.HEIGHT_CM.MIN",
      "ENERGY.EER.NASEM2023.INPUT_RANGE.HEIGHT_CM.MAX",
      140,
      220
    ),
    weights: dimension(
      "ENERGY.EER.NASEM2023.INPUT_RANGE.WEIGHT_KG.MIN",
      "ENERGY.EER.NASEM2023.INPUT_RANGE.WEIGHT_KG.MAX",
      40,
      200
    ),
  };
}

function baselineAxes(body: BodyGrid): Axes {
  return {
    ageYears: body.ages[3],
    ageStatus: "CONFIRMED",
    population: "MALE_ADULT",
    populationStatus: "CONFIRMED",
    activity: "LOW_ACTIVE",
    activityStatus: "CONFIRMED",
    heightCm: body.heights[3],
    weightKg: body.weights[3],
    weightMeasuredOffsetDays: 0,
    bodyMeasurementStatus: "CONFIRMED",
    intent: "LOSE",
    pace: "GRADUAL",
    goalStatus: "CONFIRMED",
    resistance: "OCCASIONAL",
    sessionLengthBand: "MIN_30_45",
    trainingContextStatus: "CONFIRMED",
    pattern: "OMNIVORE",
    patternReason: "PREFERENCE",
    patternStatus: "CONFIRMED",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["HOME_BASIC"],
    experienceLevel: "NEW",
    dietaryRestrictions: [],
    allergies: [],
    intakeVersion: 2,
    movementContraindications: [],
    screeningResult: "CLEAR",
    nutritionContraindications: { ...CLEAR_NUTRITION_CONTRA },
    history: NEUTRAL_HISTORY,
  };
}

/**
 * Builds the profile grid. Each block enumerates the **full cross product** of
 * the axes it is responsible for; the axes it is not responsible for rotate
 * deterministically by profile index through their own value lists, so no
 * value of any axis is ever pinned to a single setting across the whole grid.
 * A final seeded-random block covers interactions no single block's factorial
 * reaches.
 */
function buildGrid(options: {
  body: BodyGrid;
  movementContraRules: readonly string[];
  seed: number;
  randomCount: number;
}): Profile[] {
  const { body, movementContraRules } = options;
  const profiles: Profile[] = [];
  const base = baselineAxes(body);
  let index = 0;
  // Background axes (the ones a block does not own) are drawn from their own
  // seeded stream, NOT from `index % length`. Index rotation aliases: two axes
  // whose lengths share a factor become correlated, and then a per-axis
  // marginal in the report is really measuring the other axis. The first draft
  // of this harness did exactly that and reported a 20x swing in prescription
  // rate across session-length bands, an input the prescription engine does not
  // read at all. Independent draws leave only sampling noise.
  const background = makeRandom(options.seed ^ 0x5f3759df);
  const rotate = <T>(values: readonly T[]): T => pick(background, values);

  const push = (block: string, overrides: Partial<Axes>): void => {
    // Background draws first, then the block's own axes on top.
    const rotating: Partial<Axes> = {
      ageYears: rotate(body.ages.slice(1, 6)),
      heightCm: rotate(body.heights.slice(1, 6)),
      weightKg: rotate(body.weights.slice(1, 6)),
      trainingDaysPerWeek: rotate(TRAINING_DAYS),
      equipmentAccess: rotate(EQUIPMENT_SUBSETS),
      experienceLevel: rotate(EXPERIENCES),
      sessionLengthBand: rotate(BANDS),
      resistance: rotate(RESISTANCE),
      activity: rotate(ACTIVITIES),
      population: rotate(POPULATIONS),
      intent: rotate(INTENTS),
      pace: rotate(PACES),
      pattern: rotate(PATTERNS),
      patternReason: rotate(PATTERN_REASONS),
    };
    profiles.push({
      id: `${block}-${String(index).padStart(5, "0")}`,
      block,
      axes: { ...base, ...rotating, ...overrides },
    });
    index += 1;
  };

  // Block N — nutrition routing factorial: every (population, activity,
  // intent, pace, resistance) combination. 5*4*4*4*3 = 960.
  for (const population of POPULATIONS)
    for (const activity of ACTIVITIES)
      for (const intent of INTENTS)
        for (const pace of PACES)
          for (const resistance of RESISTANCE)
            push("N", { population, activity, intent, pace, resistance });

  // Block P — eating pattern factorial, including vegan and pescatarian, which
  // only became non-empty axes two days ago. 6*4*2*4 = 192.
  for (const pattern of PATTERNS)
    for (const patternReason of PATTERN_REASONS)
      for (const patternStatus of ["CONFIRMED", "DECLINED"] as const)
        for (const intent of INTENTS) push("P", { pattern, patternReason, patternStatus, intent });

  // Block B — body-metric grid, boundaries and one point outside each. 7^3.
  for (const ageYears of body.ages)
    for (const heightCm of body.heights)
      for (const weightKg of body.weights) push("B", { ageYears, heightCm, weightKg });

  // Block T — training factorial: days x equipment x experience x band.
  // 7*7*3*5 = 735.
  for (const trainingDaysPerWeek of TRAINING_DAYS)
    for (const equipmentAccess of EQUIPMENT_SUBSETS)
      for (const experienceLevel of EXPERIENCES)
        for (const sessionLengthBand of BANDS)
          push("T", {
            trainingDaysPerWeek,
            equipmentAccess,
            experienceLevel,
            sessionLengthBand,
          });

  // Block C — movement contraindications: none, each singly, adjacent pairs,
  // and all at once, crossed with every equipment tier and three day counts.
  const contraSets: string[][] = [[]];
  for (const rule of movementContraRules) contraSets.push([rule]);
  for (let i = 0; i < movementContraRules.length; i += 1) {
    contraSets.push([
      movementContraRules[i],
      movementContraRules[(i + 1) % movementContraRules.length],
    ]);
  }
  contraSets.push([...movementContraRules]);
  for (const movementContraindications of contraSets)
    for (const equipmentAccess of EQUIPMENT_SUBSETS)
      for (const trainingDaysPerWeek of [1, 3, 5])
        push("C", { movementContraindications, equipmentAccess, trainingDaysPerWeek });

  // Block F — composition inputs: dietary restriction strings and allergy
  // strings crossed with intent and eating pattern. 4*3*4*6 = 288.
  for (const dietaryRestrictions of DIETARY_RESTRICTION_SETS)
    for (const allergies of ALLERGY_SETS)
      for (const intent of INTENTS)
        for (const pattern of PATTERNS)
          push("F", { dietaryRestrictions, allergies, intent, pattern });

  // Block S — nutrition-safety inputs: screening result, each contraindication
  // input EXCLUDED and UNKNOWN in turn, and each history state.
  const contraPatterns: Record<NutritionContraKey, "CLEAR" | "EXCLUDED" | "UNKNOWN">[] = [
    { ...CLEAR_NUTRITION_CONTRA },
  ];
  for (const key of NUTRITION_CONTRA_KEYS) {
    for (const status of ["EXCLUDED", "UNKNOWN"] as const) {
      const pattern: Record<NutritionContraKey, "CLEAR" | "EXCLUDED" | "UNKNOWN"> = {
        ...CLEAR_NUTRITION_CONTRA,
      };
      pattern[key] = status;
      contraPatterns.push(pattern);
    }
  }
  const histories: NutritionSafetyHistory[] = [
    NEUTRAL_HISTORY,
    {
      currentDailyEnergyKcal: 2600,
      lastMaterialEnergyDirection: "REDUCTION",
      sourcePlanVersionIds: [],
    },
    {
      currentDailyEnergyKcal: 2600,
      lastMaterialEnergyDirection: "NON_REDUCTION",
      sourcePlanVersionIds: [],
    },
    {
      currentDailyEnergyKcal: null,
      lastMaterialEnergyDirection: "UNVERIFIABLE",
      sourcePlanVersionIds: [],
    },
  ];
  for (const screeningResult of ["CLEAR", "FLAGGED", "UNKNOWN"] as const)
    for (const nutritionContraindications of contraPatterns)
      for (const history of histories)
        push("S", { screeningResult, nutritionContraindications, history });

  // Block D — degenerate inputs: drop each governed status, drop each value,
  // stale/future measurement dates, absent session band, v1 intake, and every
  // intent paired with the UNDECIDED pace.
  const statusFields: (keyof Axes)[] = [
    "ageStatus",
    "populationStatus",
    "activityStatus",
    "bodyMeasurementStatus",
    "goalStatus",
    "trainingContextStatus",
    "patternStatus",
  ];
  const override = (field: keyof Axes, value: unknown): Partial<Axes> => {
    const result: Record<string, unknown> = {};
    result[field] = value;
    return result as Partial<Axes>;
  };
  for (const field of statusFields)
    for (const status of ["DECLINED", "UNKNOWN"] as const) push("D", override(field, status));
  const valueFields: (keyof Axes)[] = [
    "ageYears",
    "population",
    "activity",
    "heightCm",
    "weightKg",
    "weightMeasuredOffsetDays",
    "intent",
    "pace",
    "resistance",
    "sessionLengthBand",
    "pattern",
  ];
  for (const field of valueFields) push("D", override(field, null));
  for (const weightMeasuredOffsetDays of [-1, 1, 30, 180, 365, 3650])
    push("D", { weightMeasuredOffsetDays });
  push("D", { intakeVersion: 1 });
  for (const intent of INTENTS) push("D", { intent, pace: "UNDECIDED" });

  // Block R — seeded random sample over the whole space.
  const random = makeRandom(options.seed);
  for (let i = 0; i < options.randomCount; i += 1) {
    const contraCount = Math.floor(random() * 3);
    const movementContraindications: string[] = [];
    for (let c = 0; c < contraCount; c += 1) {
      const rule = pick(random, movementContraRules);
      if (!movementContraindications.includes(rule)) movementContraindications.push(rule);
    }
    const nutritionContraindications = { ...CLEAR_NUTRITION_CONTRA } as Record<
      NutritionContraKey,
      "CLEAR" | "EXCLUDED" | "UNKNOWN"
    >;
    for (const key of NUTRITION_CONTRA_KEYS) {
      nutritionContraindications[key] = pick(random, CONTRA_STATUS_DRAW);
    }
    push("R", {
      ageYears: pick(random, body.ages),
      heightCm: pick(random, body.heights),
      weightKg: pick(random, body.weights),
      ageStatus: pick(random, STATUS_DRAW),
      populationStatus: pick(random, STATUS_DRAW),
      activityStatus: pick(random, STATUS_DRAW),
      bodyMeasurementStatus: pick(random, STATUS_DRAW),
      goalStatus: pick(random, STATUS_DRAW),
      trainingContextStatus: pick(random, STATUS_DRAW),
      patternStatus: pick(random, PATTERN_STATUS_DRAW),
      population: pick(random, POPULATIONS),
      activity: pick(random, ACTIVITIES),
      intent: pick(random, INTENTS),
      pace: pick(random, PACES),
      resistance: pick(random, RESISTANCE),
      pattern: pick(random, PATTERNS),
      patternReason: pick(random, PATTERN_REASONS),
      trainingDaysPerWeek: pick(random, TRAINING_DAYS),
      equipmentAccess: pick(random, EQUIPMENT_SUBSETS),
      experienceLevel: pick(random, EXPERIENCES),
      sessionLengthBand: pick(random, BANDS_OR_NULL),
      dietaryRestrictions: pick(random, DIETARY_RESTRICTION_SETS),
      allergies: pick(random, ALLERGY_SETS),
      weightMeasuredOffsetDays: pick(random, MEASUREMENT_OFFSET_DRAW),
      movementContraindications,
      screeningResult: pick(random, SCREENING_DRAW),
      nutritionContraindications,
      history: pick(random, [
        NEUTRAL_HISTORY,
        {
          currentDailyEnergyKcal: 2600,
          lastMaterialEnergyDirection: "REDUCTION",
          sourcePlanVersionIds: [],
        },
        {
          currentDailyEnergyKcal: 1800,
          lastMaterialEnergyDirection: "NON_REDUCTION",
          sourcePlanVersionIds: [],
        },
        {
          currentDailyEnergyKcal: null,
          lastMaterialEnergyDirection: "UNVERIFIABLE",
          sourcePlanVersionIds: [],
        },
      ]),
    });
  }

  return profiles;
}

/* ---------------------------------------------------- intake construction */

function answersFor(axes: Axes, evaluatedOn: string): Record<string, unknown> {
  const answers: Record<string, unknown> = {
    goal: "BODY_COMPOSITION",
    experienceLevel: axes.experienceLevel,
    trainingDaysPerWeek: axes.trainingDaysPerWeek,
    equipmentAccess: [...axes.equipmentAccess],
    dietaryRestrictions: [...axes.dietaryRestrictions],
    allergies: [...axes.allergies],
    foodBudgetLevel: "MODERATE",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
  };
  if (axes.heightCm !== null) answers.heightCm = axes.heightCm;
  if (axes.weightKg !== null) answers.weightKg = axes.weightKg;
  if (axes.intakeVersion === 1) return answers;

  answers.intakeVersion = 2;
  answers.capturedAt = `${evaluatedOn}T00:00:00.000Z`;
  answers.ageStatus = axes.ageStatus;
  if (axes.ageYears !== null) answers.ageYears = axes.ageYears;
  answers.energyMethodPopulationCategoryStatus = axes.populationStatus;
  if (axes.population !== null) answers.energyMethodPopulationCategory = axes.population;
  answers.physicalActivityCategoryStatus = axes.activityStatus;
  if (axes.activity !== null) answers.physicalActivityCategory = axes.activity;
  answers.bodyMeasurementStatus = axes.bodyMeasurementStatus;
  if (axes.weightMeasuredOffsetDays !== null) {
    answers.weightMeasuredOn = shiftDate(evaluatedOn, -axes.weightMeasuredOffsetDays);
  }
  answers.goalStatus = axes.goalStatus;
  if (axes.intent !== null) answers.bodyWeightIntent = axes.intent;
  if (axes.pace !== null) answers.goalPaceClass = axes.pace;
  answers.weightNeutralAccepted = axes.intent === "NO_PREFERENCE";
  answers.trainingContextStatus = axes.trainingContextStatus;
  if (axes.resistance !== null) answers.resistanceTrainingContext = axes.resistance;
  if (axes.sessionLengthBand !== null) answers.sessionLengthBand = axes.sessionLengthBand;
  answers.cookingAccessStatus = "CONFIRMED";
  answers.cookingAccess = {
    equipment: ["FULL_KITCHEN"],
    refrigeration: "FRIDGE_AND_FREEZER",
    mealPrepCapacity: "SOME",
    typicalPrepMinutesBand: "MIN_30_60",
  };
  answers.dislikes = [];
  answers.cuisinePreferences = [];
  answers.allergenDeclarations = { status: "UNKNOWN", noKnownAllergens: false, items: [] };
  if (axes.pattern !== null) {
    answers.dietaryPattern = {
      pattern: axes.pattern,
      otherLabel: axes.pattern === "OTHER" ? "Harness synthetic pattern" : null,
      mandatory: axes.patternReason !== "PREFERENCE",
      reason: axes.patternReason,
      status: axes.patternStatus,
    };
  }
  return answers;
}

/* -------------------------------------------------------- parameter source */

type ParameterSource = {
  key: "draft" | "fixture" | "bundle";
  label: string;
  provenance: string;
  policy: PolicyBundleContent;
  // S-29 — the claims the gate-input builders below derive `evidence[]`
  // status from (`deriveEvidenceGateEntries`), and where they came from.
  // `evidenceClaimsProvenance` is always stated in the report (risk 5): a
  // caller-supplied bundle file carries no registry of its own, so
  // `loadBundleFileSource` borrows the checked-in draft registry's claims
  // and says so explicitly rather than silently.
  evidenceClaims: EvidenceClaimCoverage;
  evidenceClaimsProvenance: string;
  escalationTemplates: { id: string; nextStepText: string }[];
  trainingCatalog: TrainingCatalogSource;
  foodCatalogVersionForComposition: string;
  exerciseCatalogVersionForPayload: string;
  policyVersionForPayload: string;
  artifactDigests: Record<string, string>;
  notes: string[];
};

/**
 * S-29 — one line per report source stating exactly what the gate-input
 * evidence status assumed, so the report can never again state an
 * auto-approval count without stating what it assumed about evidence
 * (risk 5).
 */
function evidenceCoverageNote(
  evidenceRuleIds: readonly string[],
  claims: EvidenceClaimCoverage,
  provenance: string
): string {
  const unsubstantiated = unsubstantiatedEvidenceRuleIds(evidenceRuleIds, claims);
  const substantiatedCount = evidenceRuleIds.length - unsubstantiated.length;
  return (
    `EVIDENCE: ${substantiatedCount} of ${evidenceRuleIds.length} policy evidence rules are ` +
    `substantiated by a covering claim in ${provenance}; unsubstantiated: ` +
    `[${unsubstantiated.join(", ")}]`
  );
}

function draftEscalationTemplateList(): { id: string; nextStepText: string }[] {
  const file = loadDraftUnsignedEscalationTemplates();
  return file.content.templates.map((template) => ({
    id: template.id,
    nextStepText: template.nextStepText,
  }));
}

/**
 * The one piece of `resolvePrescriptionParametersForArtifacts` the harness has
 * to re-create: `resolveReviewedPrescriptionExplanationTexts` needs a
 * DB-verified `ReviewedArtifactSet`. Kept to the same six lines and the same
 * skip-an-unresolvable-id rule so it cannot diverge in behaviour.
 */
function prescriptionExplanationTexts(
  policy: PolicyBundleContent,
  templates: readonly { id: string; nextStepText: string }[]
): string[] {
  const byId = new Map(templates.map((template) => [template.id, template]));
  const texts: string[] = [];
  for (const id of policy.prescriptionExplanationTemplateIds ?? []) {
    const template = byId.get(id);
    if (template) texts.push(template.nextStepText);
  }
  return texts;
}

function loadDraftSource(): ParameterSource {
  const bundleFile = loadDraftUnsignedPolicyBundle();
  const exerciseFile = loadDraftUnsignedExerciseCatalog();
  const evidenceFile = loadDraftUnsignedEvidenceRegistry();
  const escalationFile = loadDraftUnsignedEscalationTemplates();
  const notes: string[] = [];
  let foodItemCount = 0;
  let foodArtifactKey = "(not generated)";
  const foodPath = path.join(
    process.cwd(),
    "lib/ai-coach/artifacts/drafts",
    DRAFT_FOOD_CATALOG_FILENAME
  );
  if (fs.existsSync(foodPath)) {
    const food = draftFoodCatalogFileSchema.parse(JSON.parse(fs.readFileSync(foodPath, "utf8")));
    foodItemCount = food.content.items.length;
    foodArtifactKey = food.content.artifactKey;
    const composerIds = ["chicken-breast-raw", "brown-rice-cooked", "broccoli-steamed"];
    const present = composerIds.filter((id) => food.content.items.some((item) => item.id === id));
    notes.push(
      `Draft FOOD_CATALOG \`${foodArtifactKey}\` carries ${foodItemCount} items; ` +
        `${present.length} of the 3 food IDs \`composeMealsToPrescription\` is hard-wired to are present.`
    );
  } else {
    notes.push("Draft FOOD_CATALOG file is absent (the FDC ingest run has not been committed).");
  }
  notes.push(
    `Draft EVIDENCE_REGISTRY carries ${evidenceFile.content.claims.length} claims; ` +
      `draft ESCALATION_TEMPLATES carries ${escalationFile.content.templates.length} templates.`
  );
  const draftPolicy = policyBundleContentSchema.parse(bundleFile.content);
  const evidenceClaimsProvenance =
    "lib/ai-coach/artifacts/drafts/evidence-registry.draft-unsigned.v1.json";
  notes.push(
    evidenceCoverageNote(draftPolicy.evidenceRuleIds, evidenceFile.content.claims, evidenceClaimsProvenance)
  );
  return {
    key: "draft",
    label: "Checked-in DRAFT_UNSIGNED artifacts",
    provenance:
      "lib/ai-coach/artifacts/drafts/{policy-bundle-nutrition,exercise-catalog,evidence-registry,escalation-templates}.draft-unsigned.v1.json",
    policy: draftPolicy,
    evidenceClaims: evidenceFile.content.claims,
    evidenceClaimsProvenance,
    escalationTemplates: draftEscalationTemplateList(),
    trainingCatalog: trainingCatalogSourceFromArtifactContent(exerciseFile.content),
    // The composer resolves food IDs through `catalog/loader.ts`, which serves
    // only the in-code fixture keys. See the report's "not exercised" section.
    foodCatalogVersionForComposition: FOOD_CATALOG_VERSION,
    exerciseCatalogVersionForPayload: exerciseFile.content.artifactKey,
    policyVersionForPayload: ACTIVE_POLICY_VERSION,
    artifactDigests: {
      policyBundle: contentHash(bundleFile.content),
      exerciseCatalog: contentHash(exerciseFile.content),
      evidenceRegistry: contentHash(evidenceFile.content),
      escalationTemplates: contentHash(escalationFile.content),
      foodCatalog:
        foodArtifactKey === "(not generated)" ? "(absent)" : `${foodArtifactKey}:${foodItemCount}`,
    },
    notes,
  };
}

function loadFixtureSource(): ParameterSource {
  const set = buildSyntheticArtifactSet("t1008-runtime");
  const policy = policyBundleContentSchema.parse(set.policyBundle.content);
  const escalation = escalationTemplatesContentSchema.parse(set.escalationTemplates.content);
  const evidenceClaims = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content).claims;
  const evidenceClaimsProvenance =
    'lib/ai-coach/artifacts/synthetic-fixtures.ts buildSyntheticArtifactSet("t1008-runtime")';
  const exerciseFile = loadDraftUnsignedExerciseCatalog();
  return {
    key: "fixture",
    label: "Repository SYNTHETIC fixture policy bundle (shape demonstration of mode 2)",
    provenance:
      'lib/ai-coach/artifacts/synthetic-fixtures.ts buildSyntheticArtifactSet("t1008-runtime")',
    policy,
    evidenceClaims,
    evidenceClaimsProvenance,
    escalationTemplates: escalation.templates.map((template) => ({
      id: template.id,
      nextStepText: template.nextStepText,
    })),
    // The synthetic EXERCISE_CATALOG fixture has one movement and no usable
    // template set, so the training composer is run against the real draft
    // catalog here too; only the *parameters* come from the fixture bundle.
    trainingCatalog: trainingCatalogSourceFromArtifactContent(exerciseFile.content),
    foodCatalogVersionForComposition: FOOD_CATALOG_VERSION,
    exerciseCatalogVersionForPayload: exerciseFile.content.artifactKey,
    policyVersionForPayload: ACTIVE_POLICY_VERSION,
    artifactDigests: {
      policyBundle: contentHash(set.policyBundle.content),
      escalationTemplates: contentHash(set.escalationTemplates.content),
      exerciseCatalog: contentHash(exerciseFile.content),
    },
    notes: [
      "Every number in this run comes from `syntheticPrescriptionParameterValue` / " +
        "`syntheticTrainingParameterValue`. They are deliberately fake and say nothing " +
        "clinically. This run exists to prove the mode-2 report path works end to end and " +
        "to surface structural findings that do not depend on the values.",
      evidenceCoverageNote(policy.evidenceRuleIds, evidenceClaims, evidenceClaimsProvenance),
    ],
  };
}

function loadBundleFileSource(filePath: string): ParameterSource {
  const raw = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")) as {
    content: unknown;
  };
  const policy = policyBundleContentSchema.parse(raw.content);
  const exerciseFile = loadDraftUnsignedExerciseCatalog();
  // S-29 — a caller-supplied policy-bundle file carries no evidence registry
  // of its own, so this mode borrows the checked-in draft registry's claims.
  // This is stated explicitly in the provenance string and the report note
  // below, not implied (risk 5): an uncovered rule in the supplied bundle is
  // then a real finding about that bundle, never a silent `[]` that would
  // make every bundle-mode row `FOCUSED_CLARIFICATION`, and never a silent
  // `SUFFICIENT` that would reproduce the drift this ticket removes.
  const evidenceFile = loadDraftUnsignedEvidenceRegistry();
  const evidenceClaimsProvenance =
    "lib/ai-coach/artifacts/drafts/evidence-registry.draft-unsigned.v1.json (borrowed — the " +
    "caller-supplied bundle file carries no EVIDENCE_REGISTRY of its own)";
  return {
    key: "bundle",
    label: `Caller-supplied policy bundle (${path.basename(filePath)})`,
    provenance: path.resolve(filePath),
    policy,
    evidenceClaims: evidenceFile.content.claims,
    evidenceClaimsProvenance,
    escalationTemplates: draftEscalationTemplateList(),
    trainingCatalog: trainingCatalogSourceFromArtifactContent(exerciseFile.content),
    foodCatalogVersionForComposition: FOOD_CATALOG_VERSION,
    exerciseCatalogVersionForPayload: exerciseFile.content.artifactKey,
    policyVersionForPayload: ACTIVE_POLICY_VERSION,
    artifactDigests: {
      policyBundle: contentHash(policy),
      exerciseCatalog: contentHash(exerciseFile.content),
    },
    notes: [evidenceCoverageNote(policy.evidenceRuleIds, evidenceFile.content.claims, evidenceClaimsProvenance)],
  };
}

/* ------------------------------------------------------------- binding step */

type Binding = {
  safetyPolicy: NutritionSafetyPolicy | null;
  safetyPolicyError: string | null;
  explanationTexts: string[];
  prescriptionParameters: ResolvedPrescriptionParameters | null;
  prescriptionResolveReasonCodes: string[];
  prescriptionMissingIds: string[];
  trainingParameters: ReturnType<typeof resolveTrainingParameters>;
  trainingMissingIds: string[];
  trainingReasonCodes: string[];
  progressionMissingIds: string[];
};

function resolveBinding(source: ParameterSource): Binding {
  let safetyPolicy: NutritionSafetyPolicy | null = null;
  let safetyPolicyError: string | null = null;
  try {
    safetyPolicy = resolveNutritionSafetyPolicy(source.policy);
  } catch (error) {
    safetyPolicyError = error instanceof Error ? error.message : String(error);
  }

  const explanationTexts = prescriptionExplanationTexts(source.policy, source.escalationTemplates);

  let prescriptionParameters: ResolvedPrescriptionParameters | null = null;
  let prescriptionResolveReasonCodes: string[] = [];
  let prescriptionMissingIds: string[] = [];
  if (safetyPolicy?.resolutionStatus === "RESOLVED") {
    const resolved = resolvePrescriptionParameters(source.policy, explanationTexts, {
      minimumDailyEnergyKcal: safetyPolicy.nutritionLimits.minimumDailyEnergyKcal,
      minimumDailyEnergyParameterId: safetyPolicy.nutritionLimits.minimumDailyEnergyParameterId,
      maximumWeeklyLossRatePercent: safetyPolicy.nutritionLimits.maximumWeeklyLossRatePercent,
      maximumWeeklyLossRateParameterId:
        safetyPolicy.nutritionLimits.maximumWeeklyLossRateParameterId,
    });
    if (resolved.ok) {
      prescriptionParameters = resolved.parameters;
    } else {
      prescriptionResolveReasonCodes = resolved.reasonCodes;
      prescriptionMissingIds = resolved.missingParameterIds;
    }
  } else {
    // Pending floors or incompatible artifact data cannot authorize a
    // prescription parameter set. Pending review is a named HOLD; only
    // malformed non-pending content reaches the catch above.
    const declaredIds = new Set(source.policy.numericParameters.map((parameter) => parameter.id));
    prescriptionMissingIds = PRESCRIPTION_PARAMETER_SPECS.filter(
      (spec) => !declaredIds.has(spec.id)
    ).map((spec) => spec.id);
    prescriptionResolveReasonCodes = [
      safetyPolicy?.resolutionStatus === "PENDING"
        ? "PRESCRIPTION_PARAMETER_MISSING"
        : "SAFETY_FLOOR_RESOLUTION_THREW",
    ];
  }

  const trainingResolved = resolveTrainingParameters(
    source.policy,
    source.escalationTemplates.map((template) => ({ id: template.id, text: template.nextStepText }))
  );
  const declaredIds = new Set(source.policy.numericParameters.map((parameter) => parameter.id));
  return {
    safetyPolicy,
    safetyPolicyError,
    explanationTexts,
    prescriptionParameters,
    prescriptionResolveReasonCodes,
    prescriptionMissingIds,
    trainingParameters: trainingResolved,
    trainingMissingIds: TRAINING_COMPOSER_PARAMETER_IDS.filter((id) => !declaredIds.has(id)),
    trainingReasonCodes: trainingResolved.ok ? [] : trainingResolved.reasonCodes,
    progressionMissingIds: TRAINING_PROGRESSION_PARAMETER_IDS.filter((id) => !declaredIds.has(id)),
  };
}

/* ------------------------------------------------------- per-profile result */

type ProfileResult = {
  profile: Profile;
  prescriptionStatus: "PRESCRIBED" | "UNAVAILABLE" | "NOT_ATTEMPTED";
  prescriptionReasonCodes: string[];
  nutritionRequired: boolean;
  targetEnergyKcal: number | null;
  maintenanceEnergyKcal: number | null;
  proteinG: number | null;
  carbRange: { min: number; max: number } | null;
  fatRange: { min: number; max: number } | null;
  projectedWeeklyChangeKg: number | null;
  appliedBoundIds: string[];
  /**
   * Which of the five goal-adjustment fractions `computePrescription` step 7
   * routed this profile to, recomputed here from the same `(bodyWeightIntent,
   * goalPaceClass)` branch rather than from the raw intake axes, so the
   * per-class tables cannot disagree with the engine about routing.
   */
  goalAdjustmentClass: string | null;
  assumptions: string[];
  composerStatus: "COMPOSED_WITH_MEALS" | "MACROS_ONLY" | "UNAVAILABLE" | "THREW";
  composerThrew: string | null;
  compositionFailureBucket: string | null;
  decisionAction: string | null;
  decisionReasonCodes: string[];
  nutritionModesAgree: boolean | null;
  trainingStatus: "COMPOSED" | "UNAVAILABLE" | "NOT_ATTEMPTED";
  trainingReasonCodes: string[];
  strengthSessions: number;
  cardioSessions: number;
  weeklyTrainingMinutes: number | null;
  appliedCapIds: string[];
  safetyOutcome: string | null;
  safetyReasonCodes: string[];
  gateOutcome: string | null;
  gateReasonCodes: string[];
  envelopeFlags: string[];
};

const COMPOSER_FOOD_IDS = ["chicken-breast-raw", "brown-rice-cooked", "broccoli-steamed"] as const;

/**
 * `composeMealsToPrescription` returns bare `null` on failure, with no reason
 * code. The harness attributes what it can by calling the same public
 * functions the composer calls, and leaves the rest in one honest
 * `SOLVER_OR_TOLERANCE` bucket rather than guessing.
 */
function attributeCompositionFailure(
  axes: Axes,
  foodCatalogVersion: string,
  policyVersion: string
): string {
  for (const id of COMPOSER_FOOD_IDS) {
    const lookup = getFoodItem(id, foodCatalogVersion);
    if (!lookup.success) return `CATALOG_${lookup.error}`;
  }
  const probe = COMPOSER_FOOD_IDS.map((foodId) => ({
    foodId,
    catalogVersion: foodCatalogVersion,
    grams: 100,
    state: (foodId === "chicken-breast-raw" ? "RAW" : "COOKED") as "RAW" | "COOKED",
  }));
  const feasibility = checkMealComposition({
    components: probe,
    allergies: [...axes.allergies],
    dietaryRestrictions: [...axes.dietaryRestrictions],
    nutritionPermission: "ALLOW",
    policyVersion,
  });
  if (!feasibility.feasible) {
    return `FEASIBILITY_${feasibility.reasons
      .map((reason) => reason.code)
      .sort()
      .join("+")}`;
  }
  return "SOLVER_OR_TOLERANCE";
}

function envelopeChecks(
  axes: Axes,
  parameters: ResolvedPrescriptionParameters,
  target: number,
  maintenance: number,
  proteinG: number,
  carbRange: { min: number; max: number },
  fatRange: { min: number; max: number },
  projectedKg: number
): string[] {
  const flags: string[] = [];
  const floors = parameters.safetyFloors;
  const densities = parameters.energyDensityKcalPerG;

  if (target < floors.minimumDailyEnergyKcal) flags.push("TARGET_BELOW_BUNDLE_ENERGY_FLOOR");
  const step = parameters.rounding.energyKcalStep;
  const relativeLow = maintenance * (1 - parameters.goalBound.maxReductionFraction) - step;
  const relativeHigh = maintenance * (1 + parameters.goalBound.maxIncreaseFraction) + step;
  if (target < relativeLow) flags.push("TARGET_BELOW_BUNDLE_RELATIVE_REDUCTION_BOUND");
  if (target > relativeHigh) flags.push("TARGET_ABOVE_BUNDLE_RELATIVE_INCREASE_BOUND");

  if (carbRange.min > carbRange.max) flags.push("CARB_RANGE_INVERTED");
  if (carbRange.min === carbRange.max) flags.push("CARB_RANGE_COLLAPSED");
  if (fatRange.min > fatRange.max) flags.push("FAT_RANGE_INVERTED");
  if (fatRange.min === fatRange.max) flags.push("FAT_RANGE_COLLAPSED");

  const proteinEnergy = proteinG * densities.protein;
  if (proteinEnergy > target) flags.push("PROTEIN_ENERGY_EXCEEDS_TARGET");
  const lowBand =
    proteinEnergy + carbRange.min * densities.carbohydrate + fatRange.min * densities.fat;
  const highBand =
    proteinEnergy + carbRange.max * densities.carbohydrate + fatRange.max * densities.fat;
  const tolerance = (target * parameters.compositionTolerancePercent) / 100;
  if (lowBand > target + tolerance) flags.push("MACRO_BAND_MINIMUM_ABOVE_TARGET");
  if (highBand < target - tolerance) flags.push("MACRO_BAND_MAXIMUM_BELOW_TARGET");

  if (axes.weightKg !== null && projectedKg < 0) {
    const rate = (-projectedKg / axes.weightKg) * 100;
    if (rate > floors.maximumWeeklyLossRatePercent)
      flags.push("PROJECTED_LOSS_RATE_ABOVE_BUNDLE_CAP");
  }
  if (axes.intent === "LOSE" && projectedKg > 0) flags.push("LOSE_INTENT_PROJECTS_GAIN");
  if (axes.intent === "GAIN" && projectedKg < 0) flags.push("GAIN_INTENT_PROJECTS_LOSS");
  if (
    (axes.intent === "MAINTAIN" || axes.intent === "NO_PREFERENCE") &&
    Math.abs(projectedKg) > 0.1
  ) {
    flags.push("MAINTAIN_INTENT_PROJECTS_MATERIAL_CHANGE");
  }
  return flags;
}

/**
 * The five goal-adjustment fractions the bundle carries, in the order
 * `DOSE-WORKSHEET-3.md` section A lists them. Declared so a class that never
 * reaches a prescription is reported as zero rather than silently absent.
 */
const GOAL_ADJUSTMENT_CLASSES = [
  "LOSE.GRADUAL",
  "LOSE.MODERATE",
  "GAIN.GRADUAL",
  "GAIN.MODERATE",
  "MAINTAIN.ANY",
] as const;

/**
 * Mirrors `computePrescription` step 7's routing exactly: MAINTAIN and
 * NO_PREFERENCE both take `MAINTAIN_ANY` whatever pace was chosen; LOSE/GAIN
 * take the (intent, pace) fraction; anything else (UNDECIDED, or LOSE +
 * MAINTAIN) has no parameter and is not a class.
 */
function goalAdjustmentClassOf(input: PrescriptionInput): string | null {
  const intent = input.bodyWeightIntent;
  if (intent === null) return null;
  if (intent === "MAINTAIN" || intent === "NO_PREFERENCE") return "MAINTAIN.ANY";
  const pace = input.goalPaceClass;
  if (pace === "GRADUAL" || pace === "MODERATE") return `${intent}.${pace}`;
  return null;
}

function evaluateProfile(
  profile: Profile,
  source: ParameterSource,
  binding: Binding,
  evaluatedOn: string
): ProfileResult {
  const axes = profile.axes;
  const answers = answersFor(axes, evaluatedOn);
  const result: ProfileResult = {
    profile,
    prescriptionStatus: "NOT_ATTEMPTED",
    prescriptionReasonCodes: [],
    nutritionRequired: false,
    targetEnergyKcal: null,
    maintenanceEnergyKcal: null,
    proteinG: null,
    carbRange: null,
    fatRange: null,
    projectedWeeklyChangeKg: null,
    appliedBoundIds: [],
    goalAdjustmentClass: null,
    assumptions: [],
    composerStatus: "UNAVAILABLE",
    composerThrew: null,
    compositionFailureBucket: null,
    decisionAction: null,
    decisionReasonCodes: [],
    nutritionModesAgree: null,
    trainingStatus: "NOT_ATTEMPTED",
    trainingReasonCodes: [],
    strengthSessions: 0,
    cardioSessions: 0,
    weeklyTrainingMinutes: null,
    appliedCapIds: [],
    safetyOutcome: null,
    safetyReasonCodes: [],
    gateOutcome: null,
    gateReasonCodes: [],
    envelopeFlags: [],
  };

  // The intake object must be a valid v2 (or v1) intake before anything else;
  // an invalid one would be a harness bug, not an engine result.
  const parsedAnswers = intakeAnswersSchema.safeParse(answers);
  if (!parsedAnswers.success) {
    result.composerStatus = "THREW";
    result.composerThrew = `HARNESS_INVALID_INTAKE: ${parsedAnswers.error.issues[0]?.message ?? ""}`;
    return result;
  }

  const built = buildPrescriptionInput(answers, evaluatedOn);
  result.nutritionRequired = built.ok
    ? nutritionRequiredForGoal(built.input)
    : nutritionRequiredForGoal({ bodyWeightIntent: axes.intent });

  if (built.ok) result.goalAdjustmentClass = goalAdjustmentClassOf(built.input);

  if (binding.prescriptionParameters && built.ok) {
    const prescription = computePrescription(binding.prescriptionParameters, built.input);
    result.prescriptionStatus = prescription.status;
    result.prescriptionReasonCodes = [...prescription.reasonCodes];
    if (prescription.status === "PRESCRIBED") {
      const rx = prescription.prescription;
      result.targetEnergyKcal = rx.targetEnergyKcal;
      result.maintenanceEnergyKcal = rx.maintenanceEnergyKcal;
      result.proteinG = rx.proteinG;
      result.carbRange = rx.carbohydrateRangeG;
      result.fatRange = rx.fatRangeG;
      result.projectedWeeklyChangeKg = rx.projectedWeeklyWeightChangeKg;
      result.appliedBoundIds = [...rx.appliedBoundIds];
      result.assumptions = [...rx.assumptions];
      result.envelopeFlags = envelopeChecks(
        axes,
        binding.prescriptionParameters,
        rx.targetEnergyKcal,
        rx.maintenanceEnergyKcal,
        rx.proteinG,
        rx.carbohydrateRangeG,
        rx.fatRangeG,
        rx.projectedWeeklyWeightChangeKg
      );
    }
  } else if (!built.ok) {
    result.prescriptionStatus = "UNAVAILABLE";
    result.prescriptionReasonCodes = [...built.reasonCodes];
  }

  // Composition and the whole plan assembly, through the real composer.
  const binding3 = {
    policyVersion: source.policyVersionForPayload,
    foodCatalogVersion: source.foodCatalogVersionForComposition,
    exerciseCatalogVersion: source.exerciseCatalogVersionForPayload,
  };
  const composeArgs = {
    rawAnswers: answers,
    prescriptionId: `harness-${profile.id}`,
    evaluatedOn,
    parameters: binding.prescriptionParameters,
    binding: binding3,
    trainingParameters: binding.trainingParameters.ok
      ? binding.trainingParameters.parameters
      : null,
    trainingCatalog: source.trainingCatalog,
    trainingEffortText: binding.trainingParameters.ok
      ? binding.trainingParameters.effortText
      : null,
    activeContraindicationRuleIds: [...axes.movementContraindications],
  };

  let mealsPayloadHasMeals = false;
  try {
    const meals = composeInitialPlan({ ...composeArgs, mode: "MEALS" as const });
    const macros = composeInitialPlan({ ...composeArgs, mode: "MACROS" as const });
    result.decisionAction = meals.decision.action;
    result.decisionReasonCodes = [...meals.decision.reasonCodes];
    mealsPayloadHasMeals = meals.payload.meals !== null;
    result.strengthSessions = meals.payload.strength.length;
    result.cardioSessions = meals.payload.cardio.length;
    result.nutritionModesAgree =
      JSON.stringify(meals.payload.nutrition?.targets ?? null) ===
      JSON.stringify(macros.payload.nutrition?.targets ?? null);
    if (meals.payload.nutrition === null) {
      result.composerStatus = "UNAVAILABLE";
    } else if (mealsPayloadHasMeals) {
      result.composerStatus = "COMPOSED_WITH_MEALS";
    } else {
      result.composerStatus = "MACROS_ONLY";
      result.compositionFailureBucket = attributeCompositionFailure(
        axes,
        source.foodCatalogVersionForComposition,
        source.policyVersionForPayload
      );
    }
  } catch (error) {
    result.composerStatus = "THREW";
    result.composerThrew =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  // Training, through the real composer, reported separately from the plan
  // assembly so its own reason codes are visible.
  if (binding.trainingParameters.ok) {
    const parameters = binding.trainingParameters.parameters;
    const training = composeTraining(
      parameters,
      source.trainingCatalog,
      binding.trainingParameters.effortText,
      {
        intakeVersion: 2,
        trainingDaysPerWeek: axes.trainingDaysPerWeek,
        equipmentAccess: [...axes.equipmentAccess],
        experienceLevel: axes.experienceLevel,
        sessionLengthBand: axes.sessionLengthBand,
        trainingContextStatus: axes.intakeVersion === 2 ? axes.trainingContextStatus : null,
        energyReducedRelativeToMaintenance:
          result.targetEnergyKcal !== null && result.maintenanceEnergyKcal !== null
            ? result.targetEnergyKcal < result.maintenanceEnergyKcal
            : null,
        activeContraindicationRuleIds: [...axes.movementContraindications],
      }
    );
    result.trainingStatus = training.status;
    result.trainingReasonCodes = [...training.reasonCodes];
    result.appliedCapIds = [...training.appliedCapIds];
    if (training.status === "COMPOSED") {
      result.strengthSessions = training.strength.length;
      result.cardioSessions = training.cardio.length;
      const strengthMinutes =
        training.strength.length *
        (axes.sessionLengthBand ? parameters.plannedMinutesByBand[axes.sessionLengthBand] : 0);
      const cardioMinutes = training.cardio.reduce(
        (total, session) => total + session.durationMinutes,
        0
      );
      result.weeklyTrainingMinutes = strengthMinutes + cardioMinutes;
    }
  } else {
    result.trainingStatus = "UNAVAILABLE";
    result.trainingReasonCodes = [...binding.trainingParameters.reasonCodes];
  }

  // Nutrition safety, fed the engine's own published numbers.
  if (binding.safetyPolicy) {
    const policy = binding.safetyPolicy;
    const proposal =
      result.targetEnergyKcal !== null
        ? {
            proposedDailyEnergyKcal: result.targetEnergyKcal,
            currentWeightKg: axes.weightKg,
            projectedWeeklyWeightChangeKg: result.projectedWeeklyChangeKg,
            provenance: "SERVER_VALIDATED_CLIENT_STATE" as const,
          }
        : null;
    const decision = evaluateNutritionSafety(
      policy,
      {
        screening: {
          instrumentId: policy.screening.instrumentId,
          result: axes.screeningResult,
          provenance: "SERVER_VALIDATED_CLIENT_STATE",
        },
        contraindications: axes.nutritionContraindications,
        proposal,
      },
      axes.history
    );
    result.safetyOutcome = decision.outcome;
    result.safetyReasonCodes = [...decision.reasonCodes];

    // The gate, with every non-engine fact held at "nothing else is wrong", so
    // the outcome distribution reflects the engines and not the harness.
    const gateInput: ServerAutonomyGateInput = {
      requestedScopeClasses: ["GENERAL_FITNESS_PROGRAMMING"],
      requestedDomains:
        result.targetEnergyKcal !== null
          ? ["NUTRITION", "STRENGTH", "CARDIO"]
          : ["STRENGTH", "CARDIO"],
      requiredInputs: [...new Set(source.policy.requiredInputIds)].map((id) => ({
        id,
        status: "CONFIRMED" as const,
      })),
      // S-29 — derived from the source's actual evidence claims, not
      // asserted. `facts.evidenceRuleIds` below stays deduped separately
      // (`gate.ts` wraps it in a `Set` anyway).
      evidence: deriveEvidenceGateEntries({
        evidenceRuleIds: source.policy.evidenceRuleIds,
        claims: source.evidenceClaims,
        sourceRefs: [],
      }),
      candidatePlanVersionId: "harness-candidate",
    };
    const facts: AutonomyGateFacts = {
      authorityEligible: true,
      allowedScopeClasses: ["GENERAL_FITNESS_PROGRAMMING", "GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
      explicitExclusions: [],
      requiredInputIds: [...new Set(source.policy.requiredInputIds)],
      evidenceRuleIds: [...new Set(source.policy.evidenceRuleIds)],
      permissions: { NUTRITION: "ALLOW", STRENGTH: "ALLOW", CARDIO: "ALLOW" },
      safetyDisposition: "CLEAR",
      prescription: {
        required: result.nutritionRequired,
        available: result.prescriptionStatus === "PRESCRIBED",
        reasonCodes: result.prescriptionReasonCodes,
      },
      nutritionSafety: {
        id: `harness-safety-${profile.id}`,
        input: {
          screening: {
            instrumentId: policy.screening.instrumentId,
            result: axes.screeningResult,
            provenance: "SERVER_VALIDATED_CLIENT_STATE",
          },
          contraindications: axes.nutritionContraindications,
          proposal,
        },
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        ruleIds: decision.ruleIds,
        escalationTemplateIds: decision.escalationTemplateIds,
      },
      evidenceCurrent: true,
      candidateValid: result.composerStatus !== "THREW",
    };
    const gate = evaluateAutonomyGate(gateInput, facts);
    result.gateOutcome = gate.outcome;
    result.gateReasonCodes = [...gate.orderedReasonCodes];
  }

  return result;
}

/* ------------------------------------------------------ gate reachability */

type GateProbe = { name: string; outcome: string; reasonCodes: string[] };

/**
 * The grid holds every non-engine gate fact at "nothing else is wrong", which
 * is what makes the outcome distribution attributable to the engines. This
 * separate probe set perturbs one fact at a time so the report can distinguish
 * "this branch never fires for an engine reason" from "this branch is dead".
 */
function gateReachabilityProbes(source: ParameterSource): GateProbe[] {
  const requiredInputIds = [...new Set(source.policy.requiredInputIds)];
  const evidenceRuleIds = [...new Set(source.policy.evidenceRuleIds)];
  const baseInput: ServerAutonomyGateInput = {
    requestedScopeClasses: ["GENERAL_FITNESS_PROGRAMMING"],
    requestedDomains: ["NUTRITION", "STRENGTH", "CARDIO"],
    requiredInputs: requiredInputIds.map((id) => ({ id, status: "CONFIRMED" as const })),
    // S-29 — derived from the source's actual evidence claims, not asserted.
    evidence: deriveEvidenceGateEntries({
      evidenceRuleIds,
      claims: source.evidenceClaims,
      sourceRefs: [],
    }),
    candidatePlanVersionId: "probe-candidate",
  };
  const safetyInput = {
    screening: {
      instrumentId: source.policy.safetyControls.screening.instrumentId,
      result: "CLEAR" as const,
      provenance: "SERVER_VALIDATED_CLIENT_STATE" as const,
    },
    contraindications: { ...CLEAR_NUTRITION_CONTRA },
    proposal: {
      proposedDailyEnergyKcal: 2000,
      currentWeightKg: 75,
      projectedWeeklyWeightChangeKg: -0.4,
      provenance: "SERVER_VALIDATED_CLIENT_STATE" as const,
    },
  };
  const baseFacts: AutonomyGateFacts = {
    authorityEligible: true,
    allowedScopeClasses: ["GENERAL_FITNESS_PROGRAMMING", "GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
    explicitExclusions: [],
    requiredInputIds,
    evidenceRuleIds,
    permissions: { NUTRITION: "ALLOW", STRENGTH: "ALLOW", CARDIO: "ALLOW" },
    safetyDisposition: "CLEAR",
    prescription: { required: true, available: true, reasonCodes: [] },
    nutritionSafety: {
      id: "probe-safety",
      input: safetyInput,
      outcome: "PASS",
      reasonCodes: [],
      ruleIds: [],
      escalationTemplateIds: [],
    },
    evidenceCurrent: true,
    candidateValid: true,
  };

  const cases: {
    name: string;
    input?: Partial<ServerAutonomyGateInput>;
    facts?: Partial<AutonomyGateFacts>;
  }[] = [
    { name: "all facts clean" },
    { name: "authority ineligible", facts: { authorityEligible: false } },
    { name: "requested scope not allowed", input: { requestedScopeClasses: ["DIAGNOSIS"] } },
    { name: "safety disposition not CLEAR", facts: { safetyDisposition: "REFER" } },
    {
      name: "domain permission not ALLOW",
      facts: { permissions: { NUTRITION: "PAUSED", STRENGTH: "ALLOW", CARDIO: "ALLOW" } },
    },
    {
      name: "required input not in the policy's set",
      input: { requiredInputs: [{ id: "NOT_A_REQUIRED_INPUT", status: "CONFIRMED" }] },
    },
    { name: "required input missing", input: { requiredInputs: [] } },
    {
      name: "prescription required but unavailable (policy not ready)",
      facts: {
        prescription: {
          required: true,
          available: false,
          reasonCodes: ["PRESCRIPTION_PARAMETER_MISSING"],
        },
      },
    },
    {
      name: "prescription required but unavailable (client fixable)",
      facts: {
        prescription: {
          required: true,
          available: false,
          reasonCodes: ["PRESCRIPTION_INPUT_MISSING"],
        },
      },
    },
    {
      name: "prescription required but unavailable (out of scope)",
      facts: {
        prescription: {
          required: true,
          available: false,
          reasonCodes: ["PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE"],
        },
      },
    },
    { name: "nutrition safety decision absent", facts: { nutritionSafety: null } },
    {
      name: "nutrition safety PAUSE_REFER",
      facts: {
        nutritionSafety: {
          id: "probe-safety",
          input: safetyInput,
          outcome: "PAUSE_REFER",
          reasonCodes: ["PROBE_SAFETY"],
          ruleIds: [],
          escalationTemplateIds: [],
        },
      },
    },
    {
      name: "nutrition safety HOLD",
      facts: {
        nutritionSafety: {
          id: "probe-safety",
          input: safetyInput,
          outcome: "HOLD",
          reasonCodes: ["PROBE_SAFETY"],
          ruleIds: [],
          escalationTemplateIds: [],
        },
      },
    },
    {
      // S-29 — this is the one deliberate SUFFICIENT literal left in this
      // file (`tests/unit/ai-coach-evidence-rule-coverage.test.ts` asserts
      // there is exactly one occurrence of that status value, not zero): it
      // is a `GATE_EVIDENCE_INVALID` probe for a rule id outside the
      // policy's own `evidenceRuleIds`, which `deriveEvidenceGateEntries`
      // would never produce — it only ever iterates the policy's own
      // declared ids. Do not "clean this up" into `deriveEvidenceGateEntries`.
      name: "evidence rule not in the policy's set",
      input: { evidence: [{ ruleId: "NOT_A_POLICY_RULE", status: "SUFFICIENT", sourceRefs: [] }] },
    },
    { name: "evidence missing", input: { evidence: [] } },
    {
      name: "evidence insufficient",
      input: {
        evidence: evidenceRuleIds.map((ruleId) => ({
          ruleId,
          status: "INSUFFICIENT" as const,
          sourceRefs: [],
        })),
      },
    },
    { name: "evidence stale", facts: { evidenceCurrent: false } },
    { name: "candidate invalid", facts: { candidateValid: false } },
    { name: "candidate id absent", input: { candidatePlanVersionId: null } },
  ];

  return cases.map((probe) => {
    const evaluation = evaluateAutonomyGate(
      { ...baseInput, ...probe.input },
      { ...baseFacts, ...probe.facts }
    );
    return {
      name: probe.name,
      outcome: evaluation.outcome,
      reasonCodes: evaluation.orderedReasonCodes,
    };
  });
}

/* ------------------------------------------------- plan-schema bound checks */

const PLAN_SCHEMA_BOUNDS: {
  label: string;
  read: (parameters: ResolvedTrainingParameters) => number[];
  min: number;
  max: number;
  integer: boolean;
}[] = [
  {
    label: "sets per exercise (planPayloadSchema 1..10, integer)",
    read: (p) => Object.values(p.setsPerExerciseByExperience),
    min: 1,
    max: 10,
    integer: true,
  },
  {
    label: "reps per set (planPayloadSchema 1..50, integer)",
    read: (p) => Object.values(p.repsPerSetByExperience),
    min: 1,
    max: 50,
    integer: true,
  },
  {
    label: "rest seconds (planPayloadSchema 0..600, integer)",
    read: (p) => Object.values(p.restSecondsByExperience),
    min: 0,
    max: 600,
    integer: true,
  },
  {
    label: "cardio session minutes (planPayloadSchema >0..180)",
    read: (p) => [...Object.values(p.cardioSessionMinutesByExperience), p.cardioMaxSessionMinutes],
    min: 0.000001,
    max: 180,
    integer: false,
  },
  {
    label: "exercises per session (planPayloadSchema 1..12)",
    read: (p) => Object.values(p.exerciseCountMaxByBand),
    min: 1,
    max: 12,
    integer: false,
  },
  {
    label: "strength sessions per week (planPayloadSchema 0..7)",
    read: (p) => Object.values(p.maxStrengthSessionsByExperience),
    min: 0,
    max: 7,
    integer: false,
  },
];

function planSchemaBoundFindings(binding: Binding): string[] {
  if (!binding.trainingParameters.ok) return [];
  const parameters = binding.trainingParameters.parameters;
  const findings: string[] = [];
  for (const bound of PLAN_SCHEMA_BOUNDS) {
    for (const value of bound.read(parameters)) {
      if (value < bound.min || value > bound.max) {
        findings.push(`${bound.label}: resolved value ${value} is outside the schema bound.`);
      } else if (bound.integer && !Number.isInteger(value)) {
        findings.push(`${bound.label}: resolved value ${value} is not an integer.`);
      }
    }
  }
  return findings;
}

/* ---------------------------------------------------------- catalog survey */

function catalogSurvey(source: ParameterSource): string[] {
  const lines: string[] = [];
  const declaredRules = new Set([
    ...source.policy.ruleIds,
    ...source.policy.contraindicationRuleIds,
  ]);
  const usedContra = new Map<string, number>();
  const usedBeginner = new Map<string, number>();
  for (const exercise of source.trainingCatalog.exercises.values()) {
    for (const rule of exercise.contraindicationRuleIds) {
      usedContra.set(rule, (usedContra.get(rule) ?? 0) + 1);
    }
    for (const rule of exercise.beginnerConstraintIds) {
      usedBeginner.set(rule, (usedBeginner.get(rule) ?? 0) + 1);
    }
  }
  const declaredContra = [...declaredRules].filter((rule) => rule.startsWith("CONTRA."));
  const declaredBeginner = [...declaredRules].filter((rule) => rule.startsWith("BEGINNER."));
  lines.push(
    `Exercise catalog \`${source.trainingCatalog.catalogVersion}\`: ` +
      `${source.trainingCatalog.exercises.size} movements, ${source.trainingCatalog.templates.length} templates.`
  );
  for (const rule of declaredContra.sort()) {
    lines.push(`- \`${rule}\` is carried by ${usedContra.get(rule) ?? 0} movement(s).`);
  }
  for (const rule of declaredBeginner.sort()) {
    lines.push(`- \`${rule}\` is carried by ${usedBeginner.get(rule) ?? 0} movement(s).`);
  }
  return lines;
}

/* -------------------------------------------------------------- reporting */

type RunReport = {
  source: ParameterSource;
  binding: Binding;
  results: ProfileResult[];
  probes: GateProbe[];
  flags: string[];
  sections: string[];
};

function runOne(source: ParameterSource, profiles: Profile[], evaluatedOn: string): RunReport {
  const binding = resolveBinding(source);
  const results = profiles.map((profile) => evaluateProfile(profile, source, binding, evaluatedOn));
  const probes = gateReachabilityProbes(source);
  const flags: string[] = [];
  const sections: string[] = [];

  /* ---- binding section ---- */
  const declaredIds = new Set(source.policy.numericParameters.map((parameter) => parameter.id));
  const missingPrescription = PRESCRIPTION_PARAMETER_SPECS.filter(
    (spec) => !declaredIds.has(spec.id)
  ).map((spec) => spec.id);
  const bindingLines: string[] = [];
  bindingLines.push(`**Parameter source:** ${source.label}`);
  bindingLines.push("");
  bindingLines.push(`**Provenance:** \`${source.provenance}\``);
  bindingLines.push("");
  bindingLines.push("| Binding step | Result |");
  bindingLines.push("|---|---|");
  bindingLines.push(
    `| \`resolveNutritionSafetyPolicy\` (the two T-1003 floors) | ${
      binding.safetyPolicy?.resolutionStatus === "RESOLVED"
        ? `resolved: floor ${binding.safetyPolicy.nutritionLimits.minimumDailyEnergyKcal} kcal/day, ` +
          `max loss rate ${binding.safetyPolicy.nutritionLimits.maximumWeeklyLossRatePercent} %BW/week`
        : binding.safetyPolicy?.resolutionStatus === "PENDING"
          ? `**HOLD** — ${binding.safetyPolicy.pendingDecision?.reasonCodes.join(", ")}`
          : `**THREW** — ${binding.safetyPolicyError}`
    } |`
  );
  bindingLines.push(
    `| \`resolvePrescriptionParameters\` (75 parameters) | ${
      binding.prescriptionParameters
        ? "resolved"
        : `**not resolved** — ${binding.prescriptionResolveReasonCodes.join(", ") || "n/a"}; ` +
          `${missingPrescription.length} of 75 absent from the bundle`
    } |`
  );
  bindingLines.push(
    `| prescription explanation copy (\`policy.prescriptionExplanationTemplateIds\` -> ESCALATION_TEMPLATES) | ${
      binding.explanationTexts.length
    } text(s) resolved from ${source.policy.prescriptionExplanationTemplateIds?.length ?? 0} declared id(s) |`
  );
  bindingLines.push(
    `| \`resolveTrainingParameters\` (34 composer parameters + 2 effort texts) | ${
      binding.trainingParameters.ok
        ? "resolved"
        : `**not resolved** — ${binding.trainingParameters.reasonCodes.join(", ")}`
    } |`
  );
  bindingLines.push(
    `| progression parameters (12, read by no composer yet) | ${
      12 - binding.progressionMissingIds.length
    } of 12 present |`
  );
  bindingLines.push("");
  if (missingPrescription.length > 0) {
    bindingLines.push("Prescription parameters absent from the bundle:");
    bindingLines.push("");
    for (const id of missingPrescription) bindingLines.push(`- \`${id}\``);
    bindingLines.push("");
  }
  if (binding.trainingMissingIds.length > 0) {
    bindingLines.push(
      `Training composer parameters absent from the bundle (${binding.trainingMissingIds.length} of 34):`
    );
    bindingLines.push("");
    for (const id of binding.trainingMissingIds) bindingLines.push(`- \`${id}\``);
    bindingLines.push("");
  }
  if (binding.progressionMissingIds.length > 0) {
    bindingLines.push(
      `Progression parameters absent from the bundle (${binding.progressionMissingIds.length} of 12): ` +
        binding.progressionMissingIds.map((id) => `\`${id}\``).join(", ")
    );
    bindingLines.push("");
  }
  const missingEffort = [EFFORT_STRENGTH_TEMPLATE_ID, EFFORT_CARDIO_TEMPLATE_ID].filter(
    (id) => !source.escalationTemplates.some((template) => template.id === id)
  );
  if (missingEffort.length > 0) {
    bindingLines.push(
      `Effort text absent from ESCALATION_TEMPLATES: ${missingEffort
        .map((id) => `\`${id}\``)
        .join(", ")}.`
    );
    bindingLines.push("");
  }
  for (const note of source.notes) bindingLines.push(`- ${note}`);
  sections.push(["### Binding: what resolved and what did not", "", ...bindingLines].join("\n"));

  /* ---- structural flags that do not depend on any parameter value ---- */
  if (!binding.safetyPolicy) {
    flags.push(
      "`resolveNutritionSafetyPolicy` **throws** on this bundle rather than returning reason codes " +
        `(${binding.safetyPolicyError}). The bundle names its two T-1003 floor parameters ` +
        `\`${source.policy.safetyControls.nutritionLimits.minimumDailyEnergyParameterId}\` and ` +
        `\`${source.policy.safetyControls.nutritionLimits.maximumWeeklyLossRateParameterId}\`, and ` +
        "neither is in `numericParameters`. The production wrapper " +
        "(`resolvePrescriptionParametersForArtifacts`) does not catch it, so in the executor this is a " +
        "recorded failed attempt and in `finalizeCurrentClientPlan` a 503 — not a HOLD with a reason " +
        "code the client can be shown. Closed, but not gracefully closed."
    );
    flags.push(
      "Because the floors do not resolve, `evaluateNutritionSafety` and the gate's TARGET_AND_LIMITS " +
        "stage cannot run at all on this bundle. Their distributions in this run are empty for that " +
        "reason, not because nothing fired."
    );
  }
  if (
    missingPrescription.length > 0 ||
    binding.trainingMissingIds.length > 0 ||
    missingEffort.length > 0
  ) {
    flags.push(
      `Absent reviewed values: ${missingPrescription.length} of 75 prescription parameters, ` +
        `${binding.trainingMissingIds.length} of 34 training composer parameters, ` +
        `${binding.progressionMissingIds.length} of 12 progression parameters, ` +
        `${missingEffort.length} of 2 effort texts. Listed individually in the binding table above — ` +
        "this is the list of values a signature has to cover."
    );
  }

  /* ---- prescription outcomes ---- */
  const rxStatus = new Counter();
  for (const key of ["PRESCRIBED", "UNAVAILABLE", "NOT_ATTEMPTED"]) rxStatus.declare(key);
  const rxReasons = new Counter();
  for (const result of results) {
    rxStatus.add(result.prescriptionStatus);
    for (const code of result.prescriptionReasonCodes) rxReasons.add(code);
    if (
      result.prescriptionReasonCodes.length === 0 &&
      result.prescriptionStatus === "UNAVAILABLE"
    ) {
      rxReasons.add("(no reason code)");
    }
  }
  const prescribed = results.filter((result) => result.prescriptionStatus === "PRESCRIBED");
  const rxLines: string[] = [];
  rxLines.push("| Prescription status | Profiles | Share |");
  rxLines.push("|---|---|---|");
  for (const [key, count] of rxStatus.entries()) {
    rxLines.push(`| ${key} | ${count} | ${fmt((count / results.length) * 100)} % |`);
  }
  rxLines.push("");
  rxLines.push("| Reason code (a profile may carry several) | Profiles |");
  rxLines.push("|---|---|");
  for (const [key, count] of rxReasons.entries()) rxLines.push(`| \`${key}\` | ${count} |`);
  if (rxReasons.total === 0) rxLines.push("| (none) | 0 |");
  rxLines.push("");
  rxLines.push(
    "`NOT_ATTEMPTED` means the engine's parameter set did not resolve from this bundle, so " +
      "`computePrescription` was never called. That is the fail-closed path, not a missing measurement."
  );
  sections.push(["### Prescription outcomes", "", ...rxLines].join("\n"));

  /* ---- reason classes, through the engine's own classifier ---- */
  const unavailable = results.filter((result) => result.prescriptionStatus === "UNAVAILABLE");
  if (unavailable.length > 0) {
    const classes = new Counter();
    for (const key of ["CLIENT_FIXABLE", "OUT_OF_SCOPE", "POLICY_NOT_READY"]) classes.declare(key);
    for (const result of unavailable) {
      classes.add(classifyPrescriptionReasonCodes(result.prescriptionReasonCodes));
    }
    const classLines = [
      "Routed through the real `classifyPrescriptionReasonCodes`, which is what decides whether the",
      "client is asked to fix something (`CLIENT_FIXABLE` -> FOCUSED_CLARIFICATION), told the program",
      "cannot serve them (`OUT_OF_SCOPE` -> PAUSE_REFER), or told to wait (`POLICY_NOT_READY` -> HOLD).",
      "",
      "| Reason class | Unavailable profiles | What the client is told |",
      "|---|---|---|",
    ];
    const meaning: Record<string, string> = {
      CLIENT_FIXABLE: "asked to confirm or correct an intake answer",
      OUT_OF_SCOPE: "told this is outside the reviewed scope and referred out",
      POLICY_NOT_READY: "told to wait; nothing they do changes it",
    };
    for (const [key, count] of classes.entries()) {
      classLines.push(`| \`${key}\` | ${count} | ${meaning[key] ?? "—"} |`);
    }
    const onlyOutOfRange = unavailable.filter(
      (result) =>
        result.prescriptionReasonCodes.length === 1 &&
        result.prescriptionReasonCodes[0] === "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE"
    );
    if (onlyOutOfRange.length > 0) {
      const outOfRangeClass = classifyPrescriptionReasonCodes([
        "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE",
      ]);
      classLines.push("");
      classLines.push(
        `Profiles whose **only** reason was a measurement outside the bundle's declared range: ` +
          `**${onlyOutOfRange.length}**. That code is classified \`${outOfRangeClass}\`, so the gate ` +
          (outOfRangeClass === "CLIENT_FIXABLE"
            ? "asks the client to confirm or correct the form value."
            : "does not currently route the value to a retryable form correction.")
      );
      if (outOfRangeClass !== "CLIENT_FIXABLE") {
        flags.push(
          `${onlyOutOfRange.length} profile(s) cannot retry a height, mass or age outside the bundle's ` +
            "declared input range because `PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE` is not classified " +
            "as `CLIENT_FIXABLE`."
        );
      }
    }
    sections.push(
      ["### What an unavailable prescription tells the client", "", ...classLines].join("\n")
    );
  }

  // Which declared eating patterns the engine refuses outright. Derived from
  // the engine's own behaviour, not from a list copied out of its source.
  const refusedPatterns = PATTERNS.filter((pattern) => {
    const withPattern = results.filter(
      (result) =>
        result.profile.axes.pattern === pattern &&
        result.profile.axes.patternStatus === "CONFIRMED" &&
        result.prescriptionStatus !== "NOT_ATTEMPTED"
    );
    return (
      withPattern.length > 0 &&
      withPattern.every((result) =>
        result.prescriptionReasonCodes.includes("PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED")
      )
    );
  });
  if (refusedPatterns.length > 0) {
    flags.push(
      `The prescription engine refuses **every** profile whose confirmed eating pattern is ` +
        refusedPatterns.map((pattern) => `\`${pattern}\``).join(" or ") +
        ", with `PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED`, which classifies as out-of-scope and " +
        "produces PAUSE_REFER — the client is told the program cannot serve them and referred out. " +
        "The intake offers these patterns as choices. Either the engine's supported-pattern list needs " +
        "to grow or the intake should not offer a pattern the engine will refuse."
    );
  }

  /* ---- fail-closed proof ---- */
  const composedAnything = results.filter(
    (result) =>
      result.composerStatus === "COMPOSED_WITH_MEALS" || result.composerStatus === "MACROS_ONLY"
  );
  const v2Profiles = results.filter((result) => result.profile.axes.intakeVersion === 2);
  const v2Composed = composedAnything.filter((result) => result.profile.axes.intakeVersion === 2);
  const v1Composed = composedAnything.filter((result) => result.profile.axes.intakeVersion === 1);
  const failClosedLines: string[] = [];
  failClosedLines.push(
    `Profiles that reached a plan carrying nutrition targets: **${composedAnything.length}** of ${results.length}.`
  );
  failClosedLines.push(
    `- v2 intake (${v2Profiles.length} of them): **${v2Composed.length}** produced nutrition targets.`
  );
  failClosedLines.push(
    `- v1 intake (${results.length - v2Profiles.length} of them): **${v1Composed.length}** produced nutrition targets.`
  );
  failClosedLines.push(
    `- Profiles where the training composer produced any session: **${
      results.filter((result) => result.trainingStatus === "COMPOSED").length
    }**.`
  );
  failClosedLines.push(
    `- Profiles where \`composeInitialPlan\` threw instead of returning a decision: **${
      results.filter((result) => result.composerStatus === "THREW").length
    }**.`
  );
  if (binding.prescriptionParameters === null) {
    failClosedLines.push("");
    if (v2Composed.length === 0) {
      failClosedLines.push(
        "**The fail-closed design holds for every v2 profile in the grid.** With the prescription " +
          "parameter set unresolvable, no v2 profile — at any body mass, height, age, sex, intent, " +
          "activity level, eating pattern, session band, equipment tier or contraindication set — " +
          "reached a composed numerical plan. Every one returned a decision with a reason code."
      );
    } else {
      failClosedLines.push(
        `**${v2Composed.length} v2 profile(s) reached nutrition targets even though the prescription ` +
          "parameter set did not resolve.** That contradicts the fail-closed design and needs a look."
      );
      flags.push(
        `${v2Composed.length} v2 profile(s) produced nutrition targets with an unresolvable prescription ` +
          `parameter set. Example: ${describeProfile(v2Composed[0])}`
      );
    }
    if (v1Composed.length > 0) {
      const observed = v1Composed
        .map(
          (result) =>
            `decision ${result.decisionAction ?? "none"} / gate ${result.gateOutcome ?? "did not run"}`
        )
        .join("; ");
      failClosedLines.push("");
      failClosedLines.push(
        `**${v1Composed.length} v1-intake profile${v1Composed.length === 1 ? "" : "s"} did compose a ` +
          "full plan**, because a v1 intake routes to `composeLegacySyntheticPlan`, which never calls " +
          "the prescription engine: it scales three fixture foods by body mass and stamps " +
          '`method: "SYNTHETIC_CATALOG_MATCH"` with `contentKind: "SYNTHETIC_FIXTURE"`. Measured ' +
          `outcome for those profiles: ${observed}. The payload's ` +
          "`prescriptionOutcome.nutritionRequired` is hard-coded `false` on that path, so the gate's " +
          "TARGET_AND_LIMITS prescription check never fires for it and the gate's verdict rests " +
          "entirely on the other facts. It is a set of energy and macro numbers reached with no " +
          "reviewed parameter behind them; the thing standing between that and a client is the " +
          "assumption that no live account can present a v1 intake."
      );
      flags.push(
        "A v1 intake bypasses the prescription engine and the training composer entirely and composes a " +
          "full fixture plan with energy and macro numbers derived from body mass " +
          `(\`composeLegacySyntheticPlan\`). Measured here: ${observed}. Its payload hard-codes ` +
          "`prescriptionOutcome.nutritionRequired: false`, so the gate's prescription check never fires " +
          "for it. It is the one shape in this grid that produces numbers with no reviewed parameter " +
          "behind them — confirm no live account can present a v1 intake."
      );
    }
  }
  sections.push(
    [
      "### Fail-closed proof",
      "",
      "Whether any profile slipped through to a composed numerical plan.",
      "",
      ...failClosedLines,
    ].join("\n")
  );

  /* ---- numeric distributions ---- */
  if (prescribed.length > 0) {
    const floors = binding.prescriptionParameters?.safetyFloors;
    const energy = stats(prescribed.map((result) => result.targetEnergyKcal as number));
    const maintenance = stats(prescribed.map((result) => result.maintenanceEnergyKcal as number));
    const protein = stats(prescribed.map((result) => result.proteinG as number));
    const carbMin = stats(prescribed.map((result) => (result.carbRange as { min: number }).min));
    const carbMax = stats(prescribed.map((result) => (result.carbRange as { max: number }).max));
    const fatMin = stats(prescribed.map((result) => (result.fatRange as { min: number }).min));
    const fatMax = stats(prescribed.map((result) => (result.fatRange as { max: number }).max));
    const projected = stats(prescribed.map((result) => result.projectedWeeklyChangeKg as number));
    const atFloor = floors
      ? prescribed.filter(
          (result) => (result.targetEnergyKcal as number) <= floors.minimumDailyEnergyKcal
        ).length
      : 0;
    const collapsedCarb = prescribed.filter(
      (result) =>
        (result.carbRange as { min: number; max: number }).min >=
        (result.carbRange as { max: number }).max
    ).length;
    const collapsedFat = prescribed.filter(
      (result) =>
        (result.fatRange as { min: number; max: number }).min >=
        (result.fatRange as { max: number }).max
    ).length;

    const numericLines: string[] = [];
    numericLines.push("| Quantity | Unit | n | Min | Median | Max | Mean |");
    numericLines.push("|---|---|---|---|---|---|---|");
    numericLines.push(statsRow("maintenance energy", "kcal/day", maintenance));
    numericLines.push(statsRow("target energy", "kcal/day", energy));
    numericLines.push(statsRow("protein", "g/day", protein));
    numericLines.push(statsRow("carbohydrate range, min", "g/day", carbMin));
    numericLines.push(statsRow("carbohydrate range, max", "g/day", carbMax));
    numericLines.push(statsRow("fat range, min", "g/day", fatMin));
    numericLines.push(statsRow("fat range, max", "g/day", fatMax));
    numericLines.push(statsRow("projected weekly change", "kg/week", projected));
    numericLines.push("");
    numericLines.push(
      `- Target energy at or below the bundle's own energy floor (${
        floors
          ? `${floors.minimumDailyEnergyKcal} kcal/day, \`${floors.minimumDailyEnergyParameterId}\``
          : "n/a"
      }): **${atFloor}** of ${prescribed.length}.`
    );
    numericLines.push(`- Carbohydrate range collapsed or inverted: **${collapsedCarb}**.`);
    numericLines.push(`- Fat range collapsed or inverted: **${collapsedFat}**.`);
    const atRateCap = floors
      ? prescribed.filter((result) =>
          result.appliedBoundIds.includes(floors.maximumWeeklyLossRateParameterId)
        ).length
      : 0;
    numericLines.push(
      `- Projected weekly change clamped by the loss-rate cap (\`${
        floors?.maximumWeeklyLossRateParameterId ?? "n/a"
      }\`): **${atRateCap}**.`
    );
    numericLines.push(
      `- Nutrition targets identical between MACROS and MEALS mode: **${
        results.filter((result) => result.nutritionModesAgree === true).length
      }** of ${results.filter((result) => result.nutritionModesAgree !== null).length} comparable profiles.`
    );
    // Run-verified, not inferred: does the client-facing `assumptions` list on a
    // prescription actually contain training effort copy?
    const effortTexts = source.escalationTemplates
      .filter(
        (template) =>
          template.id === EFFORT_STRENGTH_TEMPLATE_ID || template.id === EFFORT_CARDIO_TEMPLATE_ID
      )
      .map((template) => template.nextStepText);
    const leaked = prescribed.filter((result) =>
      result.assumptions.some((assumption) => effortTexts.includes(assumption))
    );
    numericLines.push(
      `- Prescriptions whose client-facing \`assumptions\` list contains **training effort copy** ` +
        `(a \`TRAINING.EFFORT.*\` template's \`nextStepText\`): **${leaked.length}** of ${prescribed.length}.`
    );
    if (leaked.length > 0) {
      numericLines.push(
        `- The \`assumptions\` list on \`${leaked[0].profile.id}\` is: ` +
          leaked[0].assumptions.map((assumption) => `"${assumption}"`).join(" | ")
      );
      flags.push(
        `Verified by running it, not by reading it: **${leaked.length}** of ${prescribed.length} ` +
          "prescriptions publish a `TRAINING.EFFORT.*` template's text inside " +
          '`Prescription.assumptions`, the client-facing "how this was worked out" list on a ' +
          "nutrition target. `resolveReviewedPrescriptionExplanationTexts` takes every id in " +
          "`policy.prescriptionExplanationTemplateIds`; that nutrition-only list must not contain " +
          "any ID declared in `policy.trainingEffortTemplateIds`."
      );
    }
    sections.push(
      ["### Prescribed numbers, distribution across the grid", "", ...numericLines].join("\n")
    );

    /* ---- which bounds bind ---- */
    const bounds = new Counter();
    if (binding.prescriptionParameters) {
      for (const id of [
        "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION",
        "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION",
        binding.prescriptionParameters.safetyFloors.minimumDailyEnergyParameterId,
        binding.prescriptionParameters.safetyFloors.maximumWeeklyLossRateParameterId,
        "MACRO.PROTEIN.G_PER_KG.NONE.MIN",
        "MACRO.PROTEIN.G_PER_KG.NONE.MAX",
        "MACRO.PROTEIN.G_PER_KG.OCCASIONAL.MIN",
        "MACRO.PROTEIN.G_PER_KG.OCCASIONAL.MAX",
        "MACRO.PROTEIN.G_PER_KG.REGULAR.MIN",
        "MACRO.PROTEIN.G_PER_KG.REGULAR.MAX",
      ]) {
        bounds.declare(id);
      }
    }
    for (const result of prescribed) for (const id of result.appliedBoundIds) bounds.add(id);
    const boundLines = ["| Bound / floor parameter ID | Times it clamped a result |", "|---|---|"];
    for (const [key, count] of bounds.entries()) boundLines.push(`| \`${key}\` | ${count} |`);
    const neverBound = bounds.zeroKeys();
    boundLines.push("");
    if (neverBound.length > 0) {
      boundLines.push(
        "Never binding anywhere in the grid (either unnecessary or misconfigured — worth a look before " +
          "signing). Which bounds bind is a property of the parameter **values**, so this list will " +
          "change when the real ones are signed; it is the check to re-run, not a permanent result:"
      );
      boundLines.push("");
      for (const id of neverBound) boundLines.push(`- \`${id}\``);
      flags.push(
        `${neverBound.length} bound/floor parameter(s) never clamped a single result across ${results.length} profiles: ` +
          neverBound.map((id) => `\`${id}\``).join(", ")
      );
    } else {
      boundLines.push("Every bound and floor listed above clamped at least one result.");
    }
    sections.push(
      ["### Which safety floors and bounds actually bind", "", ...boundLines].join("\n")
    );

    /* ---- the same clamps, split by which goal-adjustment fraction routed ---- */
    if (binding.prescriptionParameters) {
      const parameters = binding.prescriptionParameters;
      const clampIds: { id: string; label: string }[] = [
        { id: "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION", label: "relative reduction" },
        { id: "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION", label: "relative increase" },
        { id: parameters.safetyFloors.minimumDailyEnergyParameterId, label: "energy floor" },
        { id: parameters.safetyFloors.maximumWeeklyLossRateParameterId, label: "loss-rate ceiling" },
      ];
      const classLines = [
        `| Goal-adjustment class | Fraction | Prescribed | ${clampIds
          .map((clamp) => clamp.label)
          .join(" | ")} |`,
        `|---|---|---|${clampIds.map(() => "---").join("|")}|`,
      ];
      const fractionOf = (className: string): number => {
        if (className === "MAINTAIN.ANY") return parameters.goalAdjustment.MAINTAIN_ANY;
        const [intent, pace] = className.split(".") as ["LOSE" | "GAIN", "GRADUAL" | "MODERATE"];
        return parameters.goalAdjustment[intent][pace];
      };
      for (const className of GOAL_ADJUSTMENT_CLASSES) {
        const inClass = prescribed.filter((result) => result.goalAdjustmentClass === className);
        const cells = clampIds.map(
          (clamp) => inClass.filter((result) => result.appliedBoundIds.includes(clamp.id)).length
        );
        classLines.push(
          `| \`${className}\` | ${fractionOf(className)} | ${inClass.length} | ${cells.join(
            " | "
          )} |`
        );
      }
      classLines.push("");
      const unclassified = prescribed.filter((result) => result.goalAdjustmentClass === null);
      classLines.push(
        `Prescribed profiles routed to no class (there is no such parameter, so the engine refuses ` +
          `before this point): **${unclassified.length}**.`
      );
      sections.push(
        ["### Which bound binds, by goal-adjustment class", "", ...classLines].join("\n")
      );

      /* ---- what the loss-rate ceiling permits as a daily deficit ---- */
      // The clamp in `evaluateBoundsOnce` (prescription/index.ts step 8c) is
      //   maxDeficitKcal = rate% x ENERGY.BODY_MASS.ENERGY_PER_KG x weightKg / (7 x 100)
      // so the energy-per-kg value decides how large a deficit a given stated
      // weekly rate permits. Recomputed here from the resolved parameters, and
      // cross-checked against the largest deficit any clamped profile actually
      // received, so the table is the engine's arithmetic rather than a
      // restatement of the formula.
      const rho = parameters.energyPerKgBodyMass;
      const ratePercent = parameters.safetyFloors.maximumWeeklyLossRatePercent;
      const grid = bodyGridFromBundle(source.policy);
      const weightMin = grid.weights[1];
      const weightMax = grid.weights[5];
      const densityLines = [
        `\`${ENERGY_PER_KG_BODY_MASS_ID}\` = **${rho}** kcal/kg; ` +
          `\`${parameters.safetyFloors.maximumWeeklyLossRateParameterId}\` = **${ratePercent}** %BW/week.`,
        "",
        "| Body mass (kg) | Weekly loss the ceiling permits (kg) | Daily deficit the ceiling permits (kcal) |",
        "|---|---|---|",
      ];
      for (const weightKg of grid.weights) {
        if (weightKg < weightMin || weightKg > weightMax) continue;
        const weeklyKg = (ratePercent / 100) * weightKg;
        const maxDeficit = (ratePercent * rho * weightKg) / (7 * 100);
        densityLines.push(`| ${weightKg} | ${round(weeklyKg, 2)} | ${round(maxDeficit, 1)} |`);
      }
      const rateClamped = prescribed.filter((result) =>
        result.appliedBoundIds.includes(parameters.safetyFloors.maximumWeeklyLossRateParameterId)
      );
      const clampedDeficits = rateClamped.map(
        (result) =>
          (result.maintenanceEnergyKcal as number) - (result.targetEnergyKcal as number)
      );
      const clampedDeficitStats = stats(clampedDeficits);
      const allDeficits = prescribed
        .map(
          (result) =>
            (result.maintenanceEnergyKcal as number) - (result.targetEnergyKcal as number)
        )
        .filter((deficit) => deficit > 0);
      densityLines.push("");
      densityLines.push(
        `- Profiles the loss-rate ceiling clamped: **${rateClamped.length}** of ${prescribed.length} prescribed.`
      );
      densityLines.push(
        "| Quantity | Unit | n | Min | Median | Max | Mean |",
        "|---|---|---|---|---|---|---|",
        statsRow("deficit on clamped profiles", "kcal/day", clampedDeficitStats),
        statsRow("deficit on every deficit profile", "kcal/day", stats(allDeficits))
      );
      // Per-kg deficit, because the ceiling is per-kg: a profile's realised
      // weekly rate under an energy density `d` is `700 x (deficit/weightKg) / d`
      // percent, so `700 x (deficit/weightKg) / ratePercent` is the energy
      // density at which that profile would sit exactly on the intended
      // ceiling. Measured, not assumed.
      const perKg = prescribed
        .filter((result) => result.profile.axes.weightKg !== null)
        .map((result) => ({
          weightKg: result.profile.axes.weightKg as number,
          deficit:
            (result.maintenanceEnergyKcal as number) - (result.targetEnergyKcal as number),
        }))
        .filter((entry) => entry.deficit > 0)
        .map((entry) => entry.deficit / entry.weightKg);
      densityLines.push(
        statsRow("deficit per kg of body mass", "kcal/day/kg", stats(perKg)),
        statsRow(
          "energy density at which that deficit is exactly the ceiling",
          "kcal/kg",
          stats(perKg.map((value) => (value * 7 * 100) / ratePercent))
        )
      );
      densityLines.push("");
      densityLines.push(
        "Both deficits above are differences of the **published** maintenance and target, each " +
          "rounded to `ROUNDING.ENERGY_KCAL.STEP`, so one profile's figure can sit a few kcal " +
          "either side of the exact clamp (which the engine applies to unrounded maintenance, " +
          "then re-asserts against the rounded projected change). Whether any published result " +
          "actually exceeds the ceiling is the `PROJECTED_LOSS_RATE_ABOVE_BUNDLE_CAP` line in the " +
          "envelope section, not this table."
      );
      densityLines.push("");
      densityLines.push(
        "The permitted deficit is linear in the energy-per-kg value: at an energy density of " +
          "`d` kcal/kg rather than the adopted one, the same deficit produces a weekly rate of " +
          `\`${ratePercent} x ${rho} / d\` %BW/week. The harness states that identity and measures ` +
          "the adopted value only; it proposes no other value for `d`."
      );
      sections.push(
        [
          "### What the weekly loss-rate ceiling permits as a daily deficit",
          "",
          ...densityLines,
        ].join("\n")
      );
    }

    /* ---- envelope flags ---- */
    const envelope = new Counter();
    for (const result of prescribed) for (const flag of result.envelopeFlags) envelope.add(flag);
    const envelopeLines: string[] = [];
    if (envelope.total === 0) {
      envelopeLines.push(
        "No prescribed result fell outside the envelope the bundle's own parameters define."
      );
    } else {
      envelopeLines.push("| Envelope check | Profiles | Example profile |");
      envelopeLines.push("|---|---|---|");
      for (const [key, count] of envelope.entries()) {
        const example = prescribed.find((result) => result.envelopeFlags.includes(key));
        envelopeLines.push(
          `| \`${key}\` | ${count} | ${example ? describeProfile(example) : "—"} |`
        );
      }
      for (const [key, count] of envelope.entries()) {
        flags.push(`Envelope check \`${key}\` tripped on ${count} prescribed profile(s).`);
      }
    }
    sections.push(
      [
        "### Targets outside a sensible envelope",
        "",
        "Every check here is derived from the bundle's own declared parameters (floors, relative",
        "bounds, energy densities, tolerance). No threshold is invented by the harness.",
        "",
        ...envelopeLines,
      ].join("\n")
    );

    /* ---- engine vs safety disagreement ---- */
    const quiet = prescribed.filter(
      (result) =>
        result.profile.axes.screeningResult === "CLEAR" &&
        Object.values(result.profile.axes.nutritionContraindications).every(
          (status) => status === "CLEAR"
        ) &&
        result.profile.axes.history.lastMaterialEnergyDirection === "NONE"
    );
    const disagree = quiet.filter((result) => result.safetyOutcome !== "PASS");
    const disagreeLines: string[] = [];
    disagreeLines.push(
      `Profiles where the engine produced a prescription and every non-numeric safety input was clear: **${quiet.length}**.`
    );
    disagreeLines.push(
      `Of those, profiles where \`evaluateNutritionSafety\` did **not** return PASS: **${disagree.length}**.`
    );
    if (disagree.length > 0) {
      const reasons = new Counter();
      for (const result of disagree) for (const code of result.safetyReasonCodes) reasons.add(code);
      disagreeLines.push("");
      disagreeLines.push("| Safety reason code | Profiles |");
      disagreeLines.push("|---|---|");
      for (const [key, count] of reasons.entries()) disagreeLines.push(`| \`${key}\` | ${count} |`);
      disagreeLines.push("");
      disagreeLines.push(`Example: ${describeProfile(disagree[0])}`);
      flags.push(
        `${disagree.length} profile(s) produced a prescription the deterministic safety check then refused ` +
          `(engine/safety disagreement on the same numbers). Example: ${describeProfile(disagree[0])}`
      );
    }
    sections.push(
      [
        "### Could the engine and a safety check disagree?",
        "",
        "The prescription engine clamps against the same two T-1003 floors that",
        "`evaluateNutritionSafety` re-checks. If the engine ever emits a target the",
        "safety check then refuses, that is the T-2032 review r1 B1 bug class.",
        "",
        ...disagreeLines,
      ].join("\n")
    );
  } else {
    sections.push(
      [
        "### Prescribed numbers, distribution across the grid",
        "",
        "No profile reached a prescription, so there is no distribution to report. That is the",
        "expected mode-1 result: the reviewed values this engine needs are deliberately absent.",
      ].join("\n")
    );
  }

  /* ---- composition ---- */
  const composer = new Counter();
  for (const key of ["COMPOSED_WITH_MEALS", "MACROS_ONLY", "UNAVAILABLE", "THREW"]) {
    composer.declare(key);
  }
  const compositionBuckets = new Counter();
  const throwMessages = new Counter();
  for (const result of results) {
    composer.add(result.composerStatus);
    if (result.compositionFailureBucket) compositionBuckets.add(result.compositionFailureBucket);
    if (result.composerThrew) throwMessages.add(result.composerThrew);
  }
  const compositionLines = ["| Composer outcome | Profiles |", "|---|---|"];
  for (const [key, count] of composer.entries()) compositionLines.push(`| ${key} | ${count} |`);
  if (compositionBuckets.total > 0) {
    compositionLines.push("");
    compositionLines.push(
      "Why meal composition failed (attributed with the composer's own public checks):"
    );
    compositionLines.push("");
    compositionLines.push("| Bucket | Profiles |");
    compositionLines.push("|---|---|");
    for (const [key, count] of compositionBuckets.entries()) {
      compositionLines.push(`| \`${key}\` | ${count} |`);
    }
  }
  if (throwMessages.total > 0) {
    compositionLines.push("");
    compositionLines.push("| Thrown error | Profiles |");
    compositionLines.push("|---|---|");
    for (const [key, count] of throwMessages.entries()) {
      compositionLines.push(`| ${key} | ${count} |`);
      flags.push(`\`composeInitialPlan\` threw on ${count} profile(s): ${key}`);
    }
  }
  sections.push(["### Meal composition", "", ...compositionLines].join("\n"));

  /* ---- decisions ---- */
  const decisions = new Counter();
  const decisionReasons = new Counter();
  for (const result of results) {
    if (result.decisionAction) decisions.add(result.decisionAction);
    for (const code of result.decisionReasonCodes) decisionReasons.add(code);
  }
  const decisionLines = ["| Composer decision action | Profiles |", "|---|---|"];
  for (const [key, count] of decisions.entries()) decisionLines.push(`| ${key} | ${count} |`);
  decisionLines.push("");
  decisionLines.push("| Decision reason code | Profiles |");
  decisionLines.push("|---|---|");
  for (const [key, count] of decisionReasons.entries())
    decisionLines.push(`| \`${key}\` | ${count} |`);
  sections.push(["### Composer decision", "", ...decisionLines].join("\n"));

  /* ---- training ---- */
  const trainingStatus = new Counter();
  for (const key of ["COMPOSED", "UNAVAILABLE", "NOT_ATTEMPTED"]) trainingStatus.declare(key);
  const trainingReasons = new Counter();
  const capIds = new Counter();
  for (const result of results) {
    trainingStatus.add(result.trainingStatus);
    for (const code of result.trainingReasonCodes) trainingReasons.add(code);
    for (const id of result.appliedCapIds) capIds.add(id);
  }
  const composedTraining = results.filter((result) => result.trainingStatus === "COMPOSED");
  const trainingLines = ["| Training composer outcome | Profiles |", "|---|---|"];
  for (const [key, count] of trainingStatus.entries()) trainingLines.push(`| ${key} | ${count} |`);
  trainingLines.push("");
  trainingLines.push("| Training reason code | Profiles |");
  trainingLines.push("|---|---|");
  for (const [key, count] of trainingReasons.entries())
    trainingLines.push(`| \`${key}\` | ${count} |`);
  if (composedTraining.length > 0) {
    trainingLines.push("");
    trainingLines.push("| Quantity | Unit | n | Min | Median | Max | Mean |");
    trainingLines.push("|---|---|---|---|---|---|---|");
    trainingLines.push(
      statsRow(
        "strength sessions",
        "per week",
        stats(composedTraining.map((r) => r.strengthSessions))
      )
    );
    trainingLines.push(
      statsRow("cardio sessions", "per week", stats(composedTraining.map((r) => r.cardioSessions)))
    );
    trainingLines.push(
      statsRow(
        "total sessions",
        "per week",
        stats(composedTraining.map((r) => r.strengthSessions + r.cardioSessions))
      )
    );
    trainingLines.push(
      statsRow(
        "training minutes",
        "per week",
        stats(
          composedTraining
            .map((r) => r.weeklyTrainingMinutes)
            .filter((value): value is number => value !== null)
        )
      )
    );
  }
  if (capIds.total > 0) {
    trainingLines.push("");
    trainingLines.push("| Workload cap applied | Profiles |");
    trainingLines.push("|---|---|");
    for (const [key, count] of capIds.entries()) trainingLines.push(`| \`${key}\` | ${count} |`);
  }
  if (composedTraining.length > 0) {
    // A reduction is silent only when the result carries neither the specific
    // reduction reason nor the older aggregate workload-cap reason.
    const silentStrength = composedTraining.filter(
      (result) =>
        result.profile.axes.trainingDaysPerWeek > result.strengthSessions &&
        !result.trainingReasonCodes.includes("TRAINING_STRENGTH_SESSIONS_REDUCED") &&
        !result.trainingReasonCodes.includes("TRAINING_WORKLOAD_CAPPED")
    );
    const zeroCardio = composedTraining.filter((result) => result.cardioSessions === 0);
    const zeroCardioSilent = zeroCardio.filter(
      (result) =>
        !result.trainingReasonCodes.includes("TRAINING_CARDIO_NOT_ASSIGNED") &&
        !result.trainingReasonCodes.includes("TRAINING_CARDIO_REDUCED") &&
        !result.trainingReasonCodes.includes("TRAINING_WORKLOAD_CAPPED")
    );
    trainingLines.push("");
    trainingLines.push(
      `- Composed plans with **fewer strength sessions than the client asked for and no explicit ` +
        `strength-reduction/workload-cap reason code**: ` +
        `**${silentStrength.length}** of ${composedTraining.length}.`
    );
    trainingLines.push(
      `- Composed plans with **zero cardio sessions**: **${zeroCardio.length}** of ${composedTraining.length}; ` +
        `of those, **${zeroCardioSilent.length}** carry no cardio-reduction/not-assigned or workload-cap ` +
        "reason code."
    );
    if (silentStrength.length > 0) {
      const byDays = new Counter();
      for (const result of silentStrength) {
        byDays.add(
          `asked ${result.profile.axes.trainingDaysPerWeek} -> got ${result.strengthSessions}`
        );
      }
      trainingLines.push("");
      trainingLines.push("| Silent strength reduction | Profiles |");
      trainingLines.push("|---|---|");
      for (const [key, count] of byDays.entries()) trainingLines.push(`| ${key} | ${count} |`);
      flags.push(
        `${silentStrength.length} composed plan(s) give the client fewer strength sessions than they ` +
          "asked for with no explicit reduction reason. `composeTraining`'s template selection " +
          'has sets for 1, 2, 3 and "4 or more" strength days only, so any request above 4 is ' +
          "truncated to 4 silently — the client is never told, and the decision carries no code a " +
          "screen could render."
      );
    }
    if (zeroCardioSilent.length > 0) {
      flags.push(
        `${zeroCardio.length} of ${composedTraining.length} composed plans contain **no cardio at all**, ` +
          `and ${zeroCardioSilent.length} of those carry no reduction/not-assigned reason code. A workload trim ` +
          "does emit `TRAINING_WORKLOAD_CAPPED`; paths that zero cardio in `composeTraining` " +
          "(no free day left after strength placement, the consecutive-training-days trim, or no " +
          "eligible cardio movement for the equipment/contraindication set) set the count to zero " +
          "silently. The harness cannot tell which of those three fired, because the result does not " +
          "say — which is the finding."
      );
    }
  }
  const contraNoSub = results.filter((result) =>
    result.trainingReasonCodes.includes("TRAINING_CONTRAINDICATED_NO_SUBSTITUTE")
  );
  trainingLines.push("");
  trainingLines.push(
    `- Profiles where a contraindication removed a movement with no alternative left ` +
      `(\`TRAINING_CONTRAINDICATED_NO_SUBSTITUTE\`): **${contraNoSub.length}** of ${results.length}.`
  );
  if (contraNoSub.length > 0) {
    const byRule = new Counter();
    for (const result of contraNoSub) {
      byRule.add(
        result.profile.axes.movementContraindications.slice().sort().join("+") || "(none)"
      );
    }
    trainingLines.push("");
    trainingLines.push("| Active contraindication set | Profiles with no substitute |");
    trainingLines.push("|---|---|");
    for (const [key, count] of byRule.entries()) trainingLines.push(`| \`${key}\` | ${count} |`);
    const singleRule = byRule.entries().filter(([key]) => !key.includes("+") && key !== "(none)");
    if (singleRule.length > 0) {
      flags.push(
        "A **single** movement contraindication is already enough to leave a template with no eligible " +
          "substitute, so the whole training plan fails closed: " +
          singleRule.map(([key, count]) => `\`${key}\` (${count} profiles)`).join(", ") +
          ". The catalog's substitution and equipment-alternative graph needs filling in for these " +
          "before a client with one of those restrictions can be programmed at all."
      );
    }
  }
  sections.push(["### Training", "", ...trainingLines].join("\n"));

  /* ---- safety + gate ---- */
  const safety = new Counter();
  for (const key of ["PASS", "HOLD", "PAUSE_REFER"]) safety.declare(key);
  const safetyReasons = new Counter();
  const gate = new Counter();
  for (const key of ["APPROVE_AUTOMATICALLY", "HOLD", "FOCUSED_CLARIFICATION", "PAUSE_REFER"]) {
    gate.declare(key);
  }
  const gateReasons = new Counter();
  for (const code of [
    "GATE_APPROVED",
    "GATE_AUTHORITY_UNAVAILABLE",
    "GATE_OUT_OF_SCOPE",
    "GATE_SAFETY_RESTRICTED",
    "GATE_REQUIRED_INPUT_INVALID",
    "GATE_REQUIRED_INPUT_MISSING",
    "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
    "GATE_NUTRITION_SAFETY_UNAVAILABLE",
    "GATE_NUTRITION_SAFETY_HOLD",
    "GATE_NUTRITION_SAFETY_PAUSE_REFER",
    "GATE_EVIDENCE_INVALID",
    "GATE_EVIDENCE_MISSING",
    "GATE_EVIDENCE_INSUFFICIENT",
    "GATE_EVIDENCE_STALE",
    "GATE_CANDIDATE_INVALID",
  ]) {
    gateReasons.declare(code);
  }
  for (const result of results) {
    if (result.safetyOutcome) safety.add(result.safetyOutcome);
    for (const code of result.safetyReasonCodes) safetyReasons.add(code);
    if (result.gateOutcome) gate.add(result.gateOutcome);
    for (const code of result.gateReasonCodes) {
      if (code.startsWith("GATE_")) gateReasons.add(code);
    }
  }
  const gateLines: string[] = [];
  if (!binding.safetyPolicy) {
    gateLines.push(
      "**`resolveNutritionSafetyPolicy` threw on this bundle, so neither the safety check nor the gate " +
        "ran for any profile.** Every count below is zero for that reason. The probe table at the end " +
        "of this section still exercises the gate directly, so the branch inventory is real."
    );
    gateLines.push("");
  }
  gateLines.push("| Nutrition-safety outcome | Profiles |");
  gateLines.push("|---|---|");
  for (const [key, count] of safety.entries()) gateLines.push(`| ${key} | ${count} |`);
  gateLines.push("");
  gateLines.push("| Safety reason code | Profiles |");
  gateLines.push("|---|---|");
  for (const [key, count] of safetyReasons.entries()) gateLines.push(`| \`${key}\` | ${count} |`);
  if (safetyReasons.total === 0) gateLines.push("| (none fired) | 0 |");
  gateLines.push("");
  gateLines.push("| Autonomy gate outcome | Profiles | Share |");
  gateLines.push("|---|---|---|");
  const gateTotal = Math.max(1, gate.total);
  for (const [key, count] of gate.entries()) {
    gateLines.push(`| ${key} | ${count} | ${fmt((count / gateTotal) * 100)} % |`);
  }
  gateLines.push("");
  gateLines.push("| Gate reason code | Profiles |");
  gateLines.push("|---|---|");
  for (const [key, count] of gateReasons.entries()) gateLines.push(`| \`${key}\` | ${count} |`);
  const unfiredGateCodes = gateReasons.zeroKeys();
  gateLines.push("");
  gateLines.push(
    'The grid holds every non-engine gate fact at "nothing else is wrong", so the codes above are ' +
      "the ones the engines can reach on their own. The probe table below perturbs one fact at a " +
      'time to separate "unreachable from engine state" from "dead branch".'
  );
  gateLines.push("");
  gateLines.push("| Probe | Outcome | Reason codes |");
  gateLines.push("|---|---|---|");
  for (const probe of probes) {
    gateLines.push(
      `| ${probe.name} | ${probe.outcome} | ${probe.reasonCodes.map((code) => `\`${code}\``).join(", ")} |`
    );
  }
  const probeCodes = new Set(probes.flatMap((probe) => probe.reasonCodes));
  const deadCodes = unfiredGateCodes.filter((code) => !probeCodes.has(code));
  if (deadCodes.length > 0) {
    gateLines.push("");
    gateLines.push(
      "Reason codes reached by neither the grid nor a direct fact probe: " +
        deadCodes.map((code) => `\`${code}\``).join(", ")
    );
    flags.push(
      `Gate reason code(s) not reachable by the grid or by a direct fact probe: ` +
        deadCodes.map((code) => `\`${code}\``).join(", ")
    );
  }
  const gridOnlyUnfired = unfiredGateCodes.filter((code) => probeCodes.has(code));
  if (gridOnlyUnfired.length > 0) {
    gateLines.push("");
    gateLines.push(
      "Reason codes no engine state reached, but a fact probe did (so the branch is live, just not " +
        "engine-driven): " +
        gridOnlyUnfired.map((code) => `\`${code}\``).join(", ")
    );
  }
  sections.push(["### Safety and the autonomy gate", "", ...gateLines].join("\n"));

  /* ---- cross-engine disagreement ---- */
  const approvedWithoutPrescription = results.filter(
    (result) =>
      result.gateOutcome === "APPROVE_AUTOMATICALLY" && result.prescriptionStatus !== "PRESCRIBED"
  );
  const composerVsGate = results.filter(
    (result) =>
      result.gateOutcome === "APPROVE_AUTOMATICALLY" &&
      (result.decisionAction === "PAUSE_REFER" || result.decisionAction === "CLARIFY")
  );
  const conflictLines: string[] = [];
  conflictLines.push(
    `Profiles the gate returned \`APPROVE_AUTOMATICALLY\` for **without** a prescription: ` +
      `**${approvedWithoutPrescription.length}** of ${results.length}.`
  );
  if (approvedWithoutPrescription.length > 0) {
    const byReason = new Counter();
    for (const result of approvedWithoutPrescription) {
      for (const code of result.prescriptionReasonCodes) byReason.add(code);
      if (result.prescriptionReasonCodes.length === 0) byReason.add("(engine not attempted)");
    }
    conflictLines.push("");
    conflictLines.push("| Why that profile had no prescription | Profiles approved anyway |");
    conflictLines.push("|---|---|");
    for (const [key, count] of byReason.entries()) conflictLines.push(`| \`${key}\` | ${count} |`);
    conflictLines.push("");
    conflictLines.push(
      "An explicit UNAVAILABLE prescription is expected to stop TARGET_AND_LIMITS. These profiles " +
        "indicate a remaining mismatch between prescription production and gate routing."
    );
    const severe = approvedWithoutPrescription.filter((result) =>
      result.prescriptionReasonCodes.some(
        (code) =>
          code === "PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE" ||
          code === "PRESCRIPTION_POPULATION_UNSUPPORTED" ||
          code === "PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED"
      )
    );
    if (severe.length > 0) {
      flags.push(
        `${severe.length} profile(s) reached \`APPROVE_AUTOMATICALLY\` while their own prescription ` +
          "result said the request is out of the reviewed scope " +
          "(`PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE`, `PRESCRIPTION_POPULATION_UNSUPPORTED` or " +
          "`PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED`). An out-of-scope signal the engine already " +
          "produced is being discarded rather than escalated. " +
          `Example: ${describeProfile(severe[0])}`
      );
    }
  }
  conflictLines.push("");
  conflictLines.push(
    `Profiles where the composer's own decision was PAUSE_REFER or CLARIFY but the gate returned ` +
      `\`APPROVE_AUTOMATICALLY\`: **${composerVsGate.length}**.`
  );
  if (composerVsGate.length > 0) {
    const byAction = new Counter();
    for (const result of composerVsGate) byAction.add(result.decisionAction ?? "(none)");
    conflictLines.push("");
    conflictLines.push("| Composer decision | Profiles the gate then approved |");
    conflictLines.push("|---|---|");
    for (const [key, count] of byAction.entries()) conflictLines.push(`| ${key} | ${count} |`);
    flags.push(
      `${composerVsGate.length} profile(s) where the composer returned a PAUSE_REFER/CLARIFY decision ` +
        "and the gate, on the same intake, returned `APPROVE_AUTOMATICALLY`. Two engines reading the " +
        "same answers reach opposite conclusions; whichever one the screen renders decides what the " +
        "client is told."
    );
  }
  sections.push(
    ["### Where two engines disagree on the same profile", "", ...conflictLines].join("\n")
  );

  /* ---- per-axis breakdown, for a reader who is not opening the code ---- */
  const axisTable = (title: string, keyOf: (result: ProfileResult) => string): string[] => {
    const rows = new Map<
      string,
      { total: number; prescribed: number; approved: number; pauseRefer: number }
    >();
    for (const result of results) {
      const key = keyOf(result);
      const row = rows.get(key) ?? { total: 0, prescribed: 0, approved: 0, pauseRefer: 0 };
      row.total += 1;
      if (result.prescriptionStatus === "PRESCRIBED") row.prescribed += 1;
      if (result.gateOutcome === "APPROVE_AUTOMATICALLY") row.approved += 1;
      if (result.gateOutcome === "PAUSE_REFER" || result.decisionAction === "PAUSE_REFER") {
        row.pauseRefer += 1;
      }
      rows.set(key, row);
    }
    const lines = [
      `**${title}**`,
      "",
      "| Value | Profiles | Prescribed | Gate approved | Paused / referred |",
      "|---|---|---|---|---|",
    ];
    for (const [key, row] of [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(
        `| ${key} | ${row.total} | ${row.prescribed} | ${row.approved} | ${row.pauseRefer} |`
      );
    }
    lines.push("");
    return lines;
  };
  sections.push(
    [
      "### Outcome by input axis",
      "",
      "Counts, not rates about people: the share of any value in this grid is a property of the grid's",
      "own construction, never an estimate of how common it is among clients.",
      "",
      ...axisTable("Eating pattern", (result) => result.profile.axes.pattern ?? "(absent)"),
      ...axisTable("Eating-pattern reason", (result) => result.profile.axes.patternReason),
      ...axisTable(
        "Energy-method population category",
        (result) => result.profile.axes.population ?? "(absent)"
      ),
      ...axisTable("Body-weight intent", (result) => result.profile.axes.intent ?? "(absent)"),
      ...axisTable("Activity category", (result) => result.profile.axes.activity ?? "(absent)"),
      ...axisTable(
        "Session-length band",
        (result) => result.profile.axes.sessionLengthBand ?? "(absent)"
      ),
      ...axisTable("Equipment access", (result) =>
        result.profile.axes.equipmentAccess.slice().sort().join("+")
      ),
      ...axisTable("Experience level", (result) => result.profile.axes.experienceLevel),
    ].join("\n")
  );

  /* ---- plan-schema bounds and catalog survey ---- */
  const schemaFindings = planSchemaBoundFindings(binding);
  const structural: string[] = [];
  if (binding.trainingParameters.ok) {
    if (schemaFindings.length === 0) {
      structural.push(
        "Every resolved training dose parameter is inside the bound `planPayloadSchema` enforces, " +
          "so no value can turn a composed plan into a thrown parse error."
      );
    } else {
      for (const finding of schemaFindings) {
        structural.push(`- ${finding}`);
        flags.push(`Resolved training parameter violates a plan-schema bound: ${finding}`);
      }
    }
  } else {
    structural.push(
      "Training parameters did not resolve, so the plan-schema bound check on dose values could not run."
    );
  }
  structural.push("");
  structural.push(...catalogSurvey(source));
  const unusedContra = catalogSurvey(source).filter((line) =>
    line.includes("is carried by 0 movement")
  );
  for (const line of unusedContra) {
    flags.push(`Declared rule with no catalog coverage: ${line.replace(/^- /, "")}`);
  }
  sections.push(
    [
      "### Parameter values against the plan schema, and catalog rule coverage",
      "",
      ...structural,
    ].join("\n")
  );

  return { source, binding, results, probes, flags, sections };
}

function describeProfile(result: ProfileResult): string {
  const axes = result.profile.axes;
  const reasons =
    result.prescriptionReasonCodes.length > 0
      ? ` -> ${result.prescriptionReasonCodes.join(", ")}`
      : "";
  return (
    `\`${result.profile.id}\` (` +
    [
      axes.population ?? "population:absent",
      axes.activity ?? "activity:absent",
      `${axes.ageYears ?? "absent"} y`,
      `${axes.heightCm ?? "absent"} cm`,
      `${axes.weightKg ?? "absent"} kg`,
      `intent ${axes.intent ?? "absent"}`,
      `pace ${axes.pace ?? "absent"}`,
      `resistance ${axes.resistance ?? "absent"}`,
      `pattern ${axes.pattern ?? "absent"}/${axes.patternReason}/${axes.patternStatus}`,
    ].join(", ") +
    `)${reasons}`
  );
}

/* ------------------------------------------------- adaptive synthetic history */

/**
 * S-23 — synthetic-history mode.
 *
 * Generates intake and body-mass series whose TRUE expenditure is known by
 * construction, runs the real `lib/ai-coach/adaptive` estimator over them, and
 * reports the distribution of the estimator's error against that ground truth.
 * This is the evidence phase 3 needs, and it is worth more than any single unit
 * test because it measures where the design breaks rather than that one case
 * works.
 *
 * EVERY NUMBER IN THIS SECTION IS A SIMULATION INPUT, NOT A RECOMMENDATION.
 * The nine `ADAPTIVE.*` parameters are the accountable owner's to sign and this
 * repository supplies no value for any of them; §A below proves that by running
 * the real resolver against the checked-in artifacts and printing the refusal.
 * The sweep that follows uses declared synthetic values so the ESTIMATOR can be
 * measured at all. In particular `ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG` is swept
 * as a RATIO against the value the simulator used, which measures sensitivity to
 * getting ρ wrong without asserting what ρ is. Nothing here is a clinical claim.
 */

type AdaptiveAxes = {
  windowDays: number;
  /** Scale measurement noise standard deviation, kg. */
  scaleNoiseSdKg: number;
  /** Fraction of window days the client declares FULLY logged. */
  loggingCompleteness: number;
  /** Fraction of true intake the client actually records. 1 = perfect logging. */
  reportedIntakeFraction: number;
  /** 1 = weighs daily, 2 = every other day, 7 = weekly. */
  weighInEveryDays: number;
  /** True daily energy balance, kcal/day. Negative = deficit. */
  trueBalanceKcal: number;
  /** Estimator's ρ divided by the simulator's ρ. 1 = correctly specified. */
  densityRatio: number;
};

const ADAPTIVE_WINDOW_DAYS = [14, 21, 28, 42];
const ADAPTIVE_SCALE_NOISE_SD_KG = [0, 0.2, 0.5, 1];
const ADAPTIVE_LOGGING_COMPLETENESS = [1, 0.9, 0.7, 0.5];
const ADAPTIVE_REPORTED_INTAKE_FRACTION = [1, 0.9, 0.8];
const ADAPTIVE_WEIGH_IN_EVERY_DAYS = [1, 2, 7];
const ADAPTIVE_TRUE_BALANCE_KCAL = [-500, -250, 0, 250];
const ADAPTIVE_DENSITY_RATIO = [1, 0.85, 1.15];

/** Simulator ground truth. Synthetic; see the section header. */
const SIMULATED_TRUE_EXPENDITURE_KCAL = 2500;
const SIMULATED_START_MASS_KG = 80;
const SIMULATED_DENSITY_KCAL_PER_KG = 7000;

/** Gate thresholds for the sweep. Synthetic; see the section header. */
const SWEEP_PROCESS_NOISE = 0.0004;
const SWEEP_MEASUREMENT_NOISE = 0.25;
const SWEEP_MIN_COMPLETENESS = 0.6;
const SWEEP_MIN_COMPLETENESS_FOR_REDUCTION = 0.85;
/** Swept, not chosen: the slope-uncertainty ceiling decides almost every HOLD. */
const ADAPTIVE_MAX_SLOPE_UNCERTAINTY_KCAL = [250, 500, 1000, 2000];
const SWEEP_MIN_MATERIAL_DIFFERENCE_KCAL = 50;

function sweepParameters(
  axes: AdaptiveAxes,
  maxSlopeUncertaintyKcal: number
): ResolvedAdaptiveParameters {
  const values = {
    "ADAPTIVE.KALMAN.PROCESS_NOISE": SWEEP_PROCESS_NOISE,
    "ADAPTIVE.KALMAN.MEASUREMENT_NOISE": SWEEP_MEASUREMENT_NOISE,
    "ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG": SIMULATED_DENSITY_KCAL_PER_KG * axes.densityRatio,
    "ADAPTIVE.WINDOW_DAYS": axes.windowDays,
    "ADAPTIVE.MIN_COMPLETENESS": SWEEP_MIN_COMPLETENESS,
    "ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION": SWEEP_MIN_COMPLETENESS_FOR_REDUCTION,
    "ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL": maxSlopeUncertaintyKcal,
    "ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL": SWEEP_MIN_MATERIAL_DIFFERENCE_KCAL,
  };
  if (SWEEP_MIN_COMPLETENESS_FOR_REDUCTION <= SWEEP_MIN_COMPLETENESS) {
    throw new Error("The sweep's reduction threshold must be strictly stricter.");
  }
  return {
    kalmanProcessNoise: values["ADAPTIVE.KALMAN.PROCESS_NOISE"],
    kalmanMeasurementNoise: values["ADAPTIVE.KALMAN.MEASUREMENT_NOISE"],
    energyDensityKcalPerKg: values["ADAPTIVE.ENERGY_DENSITY_KCAL_PER_KG"],
    windowDays: values["ADAPTIVE.WINDOW_DAYS"],
    minCompleteness: values["ADAPTIVE.MIN_COMPLETENESS"],
    minCompletenessForReduction: values["ADAPTIVE.MIN_COMPLETENESS_FOR_REDUCTION"],
    maxSlopeUncertaintyKcal: values["ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL"],
    minMaterialDifferenceKcal: values["ADAPTIVE.MIN_MATERIAL_DIFFERENCE_KCAL"],
    ruleId: ADAPTIVE_OBSERVED_EXPENDITURE_RULE_ID,
    parameterSetDigest: contentHash(values),
  };
}

/** Box-Muller over the harness's seeded LCG. Deterministic for a given seed. */
function makeGaussian(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = random();
    let v = random();
    if (u <= 0) u = Number.EPSILON;
    if (v <= 0) v = Number.EPSILON;
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

type AdaptiveGateOutcome = {
  maxSlopeUncertaintyKcal: number;
  decision: "PROPOSE_INCREASE" | "PROPOSE_DECREASE" | "HOLD";
  failedCondition: string | null;
  /** The gate proposed a move opposite to the truth. */
  wrongDirection: boolean;
  /** Condition 5 alone refused a reduction the truth did not justify. */
  savedByAsymmetry: boolean;
};

type AdaptiveTrial = {
  axes: AdaptiveAxes;
  /** Estimator output minus the true expenditure, kcal/day. Null if unavailable. */
  errorKcal: number | null;
  slopeUncertaintyKcal: number | null;
  outcomes: AdaptiveGateOutcome[];
};

function runAdaptiveTrial(
  axes: AdaptiveAxes,
  gaussian: () => number,
  startDay: number
): AdaptiveTrial {
  const trueRateKgPerDay = axes.trueBalanceKcal / SIMULATED_DENSITY_KCAL_PER_KG;
  const trueIntakeKcal = SIMULATED_TRUE_EXPENDITURE_KCAL + axes.trueBalanceKcal;

  const weightReadings: WeightReading[] = [];
  const nutritionLogs: NutritionLogDay[] = [];
  let loggedSoFar = 0;
  for (let day = 0; day < axes.windowDays; day += 1) {
    const isoDate = shiftDate("2026-01-01", startDay + day);
    if (day % axes.weighInEveryDays === 0 || day === axes.windowDays - 1) {
      weightReadings.push({
        measuredOn: isoDate,
        weightKg:
          SIMULATED_START_MASS_KG + trueRateKgPerDay * day + gaussian() * axes.scaleNoiseSdKg,
      });
    }
    // Deterministic rather than random coverage: the first
    // round(completeness * windowDays) days are FULL, and of the rest every
    // other day is a declared SKIPPED day and the others have no row at all,
    // so both "the client said they did not log" and "no statement" occur.
    const fullTarget = Math.round(axes.loggingCompleteness * axes.windowDays);
    if (loggedSoFar < fullTarget) {
      loggedSoFar += 1;
      nutritionLogs.push({
        loggedOn: isoDate,
        energyKcal: trueIntakeKcal * axes.reportedIntakeFraction,
        source: "PLAN_AS_WRITTEN",
        completeness: "FULL",
      });
    } else if (day % 2 === 0) {
      nutritionLogs.push({
        loggedOn: isoDate,
        energyKcal: null,
        source: "SKIPPED",
        completeness: "NONE",
      });
    }
  }

  const input = {
    weightReadings,
    nutritionLogs,
    windowEndOn: shiftDate("2026-01-01", startDay + axes.windowDays - 1),
  };
  // The client is currently eating to their true intake, so the correct
  // direction of any change is the sign of (true expenditure - that intake).
  const currentEnergyKcal = trueIntakeKcal;
  const correctDirection =
    SIMULATED_TRUE_EXPENDITURE_KCAL > currentEnergyKcal
      ? "INCREASE"
      : SIMULATED_TRUE_EXPENDITURE_KCAL < currentEnergyKcal
        ? "DECREASE"
        : "NONE";

  let errorKcal: number | null = null;
  let slopeUncertaintyKcal: number | null = null;
  const outcomes: AdaptiveGateOutcome[] = [];
  for (const maxSlopeUncertaintyKcal of ADAPTIVE_MAX_SLOPE_UNCERTAINTY_KCAL) {
    const parameters = sweepParameters(axes, maxSlopeUncertaintyKcal);
    // The estimate itself does not depend on the ceiling, only the gate does.
    const estimate = estimateObservedExpenditure(input, parameters);
    if (estimate.status === "AVAILABLE") {
      errorKcal = estimate.observedExpenditureKcal - SIMULATED_TRUE_EXPENDITURE_KCAL;
      slopeUncertaintyKcal = estimate.slopeUncertaintyKcal;
    }
    const decision = evaluateAdaptiveGate(estimate, currentEnergyKcal, parameters);
    if (decision.decision === "PROPOSE") {
      outcomes.push({
        maxSlopeUncertaintyKcal,
        decision: decision.direction === "INCREASE" ? "PROPOSE_INCREASE" : "PROPOSE_DECREASE",
        failedCondition: null,
        wrongDirection: correctDirection !== "NONE" && decision.direction !== correctDirection,
        savedByAsymmetry: false,
      });
    } else {
      outcomes.push({
        maxSlopeUncertaintyKcal,
        decision: "HOLD",
        failedCondition: decision.failedCondition,
        wrongDirection: false,
        savedByAsymmetry:
          decision.failedCondition === "COMPLETENESS_BELOW_REDUCTION_MINIMUM" &&
          correctDirection !== "DECREASE",
      });
    }
  }
  return { axes, errorKcal, slopeUncertaintyKcal, outcomes };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

function errorDistributionRow(label: string, errors: readonly number[]): string {
  if (errors.length === 0) return `| ${label} | 0 | — | — | — | — | — | — |`;
  const sorted = [...errors].sort((a, b) => a - b);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const mae = sorted.reduce((total, value) => total + Math.abs(value), 0) / sorted.length;
  const rmse = Math.sqrt(
    sorted.reduce((total, value) => total + value * value, 0) / sorted.length
  );
  return (
    `| ${label} | ${sorted.length} | ${fmt(mean)} | ${fmt(mae)} | ${fmt(rmse)} | ` +
    `${fmt(percentile(sorted, 0.1))} | ${fmt(percentile(sorted, 0.5))} | ${fmt(percentile(sorted, 0.9))} |`
  );
}

function adaptiveHistorySection(
  sources: readonly ParameterSource[],
  seed: number,
  replicates: number
): { lines: string[]; trials: number } {
  const out: string[] = [];
  out.push(
    "**Synthetic history. Every series below is machine-generated from a declared grid and a " +
      "seeded generator; the true expenditure is known because the generator chose it. No real " +
      "client's weight or food record was read. Every parameter value in this section is a " +
      "SIMULATION INPUT, not a recommendation, and none of them is signed.**"
  );
  out.push("");

  out.push("### A. Fail-closed proof — the nine parameters are absent");
  out.push("");
  out.push(
    "The real resolver, run against each artifact source in this report. A refusal here is the " +
      "correct and expected result: `lib/ai-coach/adaptive/parameters.ts` contains no value for any " +
      "of the nine ids, and no bundle in this repository declares them."
  );
  out.push("");
  out.push("| source | resolves? | reason codes | missing ids |");
  out.push("|---|---|---|---|");
  for (const source of sources) {
    const resolved = resolveAdaptiveParameters(source.policy);
    out.push(
      resolved.ok
        ? `| ${source.key} | YES | — | — |`
        : `| ${source.key} | NO | ${resolved.reasonCodes.join(", ")} | ${resolved.missingParameterIds.length}: ${resolved.missingParameterIds.join(", ")} |`
    );
  }
  out.push("");

  out.push("### B. The grid");
  out.push("");
  out.push(
    `Simulator ground truth: true expenditure ${SIMULATED_TRUE_EXPENDITURE_KCAL} kcal/day, start mass ` +
      `${SIMULATED_START_MASS_KG} kg, simulator ρ ${SIMULATED_DENSITY_KCAL_PER_KG} kcal/kg. The client's ` +
      "true intake is expenditure plus the row's energy balance, and their true mass moves at " +
      "balance/ρ kg/day. Synthetic values, chosen to exercise arithmetic."
  );
  out.push("");
  out.push("| axis | values |");
  out.push("|---|---|");
  out.push(`| window days | ${ADAPTIVE_WINDOW_DAYS.join(", ")} |`);
  out.push(`| scale noise SD (kg) | ${ADAPTIVE_SCALE_NOISE_SD_KG.join(", ")} |`);
  out.push(`| declared logging completeness | ${ADAPTIVE_LOGGING_COMPLETENESS.join(", ")} |`);
  out.push(`| fraction of intake actually recorded | ${ADAPTIVE_REPORTED_INTAKE_FRACTION.join(", ")} |`);
  out.push(`| weigh-in interval (days) | ${ADAPTIVE_WEIGH_IN_EVERY_DAYS.join(", ")} |`);
  out.push(`| true daily balance (kcal) | ${ADAPTIVE_TRUE_BALANCE_KCAL.join(", ")} |`);
  out.push(`| estimator ρ ÷ simulator ρ | ${ADAPTIVE_DENSITY_RATIO.join(", ")} |`);
  out.push(
    `| slope-uncertainty ceiling (kcal/day) | ${ADAPTIVE_MAX_SLOPE_UNCERTAINTY_KCAL.join(", ")} |`
  );
  out.push(`| replicates per cell (different noise draws) | ${replicates} |`);
  out.push("");
  out.push(
    "Gate thresholds held fixed for the sweep (synthetic): MIN_COMPLETENESS " +
      `${SWEEP_MIN_COMPLETENESS}, MIN_COMPLETENESS_FOR_REDUCTION ${SWEEP_MIN_COMPLETENESS_FOR_REDUCTION}, ` +
      `MIN_MATERIAL_DIFFERENCE_KCAL ${SWEEP_MIN_MATERIAL_DIFFERENCE_KCAL}, Kalman q ` +
      `${SWEEP_PROCESS_NOISE}, R ${SWEEP_MEASUREMENT_NOISE}. The slope-uncertainty ceiling is swept ` +
      "rather than chosen because it decides almost every HOLD, and this tool has no business " +
      "picking it."
  );
  out.push("");

  const random = makeRandom(seed);
  const gaussian = makeGaussian(random);
  const trials: AdaptiveTrial[] = [];
  let startDay = 0;
  for (const windowDays of ADAPTIVE_WINDOW_DAYS)
    for (const scaleNoiseSdKg of ADAPTIVE_SCALE_NOISE_SD_KG)
      for (const loggingCompleteness of ADAPTIVE_LOGGING_COMPLETENESS)
        for (const reportedIntakeFraction of ADAPTIVE_REPORTED_INTAKE_FRACTION)
          for (const weighInEveryDays of ADAPTIVE_WEIGH_IN_EVERY_DAYS)
            for (const trueBalanceKcal of ADAPTIVE_TRUE_BALANCE_KCAL)
              for (const densityRatio of ADAPTIVE_DENSITY_RATIO)
                for (let replicate = 0; replicate < replicates; replicate += 1) {
                  startDay += 1;
                  trials.push(
                    runAdaptiveTrial(
                      {
                        windowDays,
                        scaleNoiseSdKg,
                        loggingCompleteness,
                        reportedIntakeFraction,
                        weighInEveryDays,
                        trueBalanceKcal,
                        densityRatio,
                      },
                      gaussian,
                      startDay
                    )
                  );
                }

  const available = trials.filter((trial) => trial.errorKcal !== null);
  const errors = available.map((trial) => trial.errorKcal as number);

  out.push("### C. Estimator error against ground truth (kcal/day)");
  out.push("");
  out.push(
    `${trials.length} trials; ${available.length} produced an estimate, ` +
      `${trials.length - available.length} refused before one existed. Error = estimated expenditure ` +
      "minus the simulator's true expenditure, so a negative error means the estimator thinks the " +
      "client burns less than they do — the direction that cuts food."
  );
  out.push("");
  out.push("| slice | n | mean | MAE | RMSE | p10 | p50 | p90 |");
  out.push("|---|---|---|---|---|---|---|---|");
  out.push(errorDistributionRow("all trials", errors));

  const sliceBy = <K extends keyof AdaptiveAxes>(key: K, values: readonly number[]) => {
    for (const value of values) {
      out.push(
        errorDistributionRow(
          `${String(key)} = ${value}`,
          available.filter((trial) => trial.axes[key] === value).map((trial) => trial.errorKcal as number)
        )
      );
    }
  };
  sliceBy("reportedIntakeFraction", ADAPTIVE_REPORTED_INTAKE_FRACTION);
  sliceBy("scaleNoiseSdKg", ADAPTIVE_SCALE_NOISE_SD_KG);
  sliceBy("windowDays", ADAPTIVE_WINDOW_DAYS);
  sliceBy("weighInEveryDays", ADAPTIVE_WEIGH_IN_EVERY_DAYS);
  sliceBy("densityRatio", ADAPTIVE_DENSITY_RATIO);
  sliceBy("loggingCompleteness", ADAPTIVE_LOGGING_COMPLETENESS);
  out.push("");

  const perfectLogging = available.filter(
    (trial) => trial.axes.reportedIntakeFraction === 1 && trial.axes.densityRatio === 1
  );
  out.push(
    "The `reportedIntakeFraction` rows are the finding the research document predicted and the " +
      "reason phase 1 is the largest part of this work: when a client records only 80% of what they " +
      "eat, the estimator does not learn their metabolism, it learns their logging, and the error is " +
      "a bias of roughly −0.2 × intake with the spread almost unchanged. It is not noise and no " +
      "amount of window length removes it."
  );
  out.push("");
  out.push(
    `Restricted to correctly-specified runs (intake fully recorded and ρ correct), n=${perfectLogging.length}: ` +
      `${errorDistributionRow("correctly specified", perfectLogging.map((trial) => trial.errorKcal as number)).trim()}`
  );
  out.push("");

  out.push("### D. Gate outcomes, by slope-uncertainty ceiling");
  out.push("");
  out.push(
    "One estimate per trial; the gate is then evaluated at each ceiling, so the rows differ only " +
      "in that threshold. `wrong direction` counts proposals that moved the target the opposite way " +
      "to the truth. `held by asymmetry alone` counts reductions that condition 5 — and nothing " +
      "else — refused, on evidence where the client's true expenditure did not justify a cut."
  );
  out.push("");
  out.push(
    "| ceiling | propose ↑ | propose ↓ | HOLD | wrong direction | held by asymmetry alone | top HOLD reason |"
  );
  out.push("|---|---|---|---|---|---|---|");
  for (const ceiling of ADAPTIVE_MAX_SLOPE_UNCERTAINTY_KCAL) {
    const outcomes = trials
      .map((trial) => trial.outcomes.find((outcome) => outcome.maxSlopeUncertaintyKcal === ceiling))
      .filter((outcome): outcome is AdaptiveGateOutcome => outcome !== undefined);
    const reasons = new Counter();
    for (const outcome of outcomes) {
      if (outcome.decision === "HOLD") reasons.add(outcome.failedCondition ?? "UNKNOWN");
    }
    const share = (count: number) => `${count} (${fmt((count / outcomes.length) * 100)}%)`;
    const top = reasons.entries()[0];
    out.push(
      `| ${ceiling} | ` +
        `${share(outcomes.filter((outcome) => outcome.decision === "PROPOSE_INCREASE").length)} | ` +
        `${share(outcomes.filter((outcome) => outcome.decision === "PROPOSE_DECREASE").length)} | ` +
        `${share(outcomes.filter((outcome) => outcome.decision === "HOLD").length)} | ` +
        `${share(outcomes.filter((outcome) => outcome.wrongDirection).length)} | ` +
        `${share(outcomes.filter((outcome) => outcome.savedByAsymmetry).length)} | ` +
        `${top ? `${top[0]} (${top[1]})` : "—"} |`
    );
  }
  out.push("");
  // Isolate the wrong-direction rate that noise alone produces from the rate
  // that under-reporting and a misspecified rho produce.
  const cleanTrials = trials.filter(
    (trial) => trial.axes.reportedIntakeFraction === 1 && trial.axes.densityRatio === 1
  );
  for (const ceiling of ADAPTIVE_MAX_SLOPE_UNCERTAINTY_KCAL) {
    const clean = cleanTrials
      .map((trial) => trial.outcomes.find((outcome) => outcome.maxSlopeUncertaintyKcal === ceiling))
      .filter((outcome): outcome is AdaptiveGateOutcome => outcome !== undefined);
    const wrongClean = clean.filter((outcome) => outcome.wrongDirection).length;
    out.push(
      `- ceiling ${ceiling}: wrong-direction rate among correctly-specified trials (intake fully ` +
        `recorded, ρ correct) is ${wrongClean}/${clean.length} ` +
        `(${fmt((wrongClean / Math.max(clean.length, 1)) * 100)}%). The difference from the row ` +
        "above is attributable to under-reporting and ρ misspecification, not to measurement noise."
    );
  }
  out.push("");
  const allOutcomes = trials.flatMap((trial) => trial.outcomes);
  const holdReasons = new Counter();
  for (const outcome of allOutcomes) {
    holdReasons.add(
      outcome.decision === "HOLD" ? `HOLD: ${outcome.failedCondition}` : outcome.decision
    );
  }
  out.push("| outcome (all ceilings pooled) | count | share |");
  out.push("|---|---|---|");
  for (const [key, count] of holdReasons.entries()) {
    out.push(`| ${key} | ${count} | ${fmt((count / allOutcomes.length) * 100)}% |`);
  }
  out.push("");
  out.push(
    "Caveat on all of §D: the shares are a property of the synthetic thresholds in §B as much as of " +
      "the estimator. They say how the gate behaves at those thresholds, not what thresholds to sign."
  );
  out.push("");
  const slopeValues = trials
    .map((trial) => trial.slopeUncertaintyKcal)
    .filter((value): value is number => value !== null);
  out.push("### E. The slope-uncertainty signal itself (kcal/day)");
  out.push("");
  out.push("| slice | unit | n | min | median | max | mean |");
  out.push("|---|---|---|---|---|---|---|");
  out.push(statsRow("all trials", "kcal/day", stats(slopeValues)));
  for (const interval of ADAPTIVE_WEIGH_IN_EVERY_DAYS) {
    out.push(
      statsRow(
        `weigh-in every ${interval} day(s)`,
        "kcal/day",
        stats(
          trials
            .filter((trial) => trial.axes.weighInEveryDays === interval)
            .map((trial) => trial.slopeUncertaintyKcal)
            .filter((value): value is number => value !== null)
        )
      )
    );
  }
  for (const windowDays of ADAPTIVE_WINDOW_DAYS) {
    out.push(
      statsRow(
        `window ${windowDays} days`,
        "kcal/day",
        stats(
          trials
            .filter((trial) => trial.axes.windowDays === windowDays)
            .map((trial) => trial.slopeUncertaintyKcal)
            .filter((value): value is number => value !== null)
        )
      )
    );
  }
  out.push("");
  out.push(
    "This is the distribution the accountable owner needs in order to set " +
      "`ADAPTIVE.MAX_SLOPE_UNCERTAINTY_KCAL` at all: a ceiling below the median here refuses almost " +
      "everything, and one above the maximum refuses nothing. It scales linearly with ρ, so the " +
      "numbers move with whatever ρ is signed."
  );

  return { lines: out, trials: trials.length };
}

/* ------------------------------------------------------------------- main */

function parseArgs(argv: readonly string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(token.slice(2), next);
        i += 1;
      } else {
        args.set(token.slice(2), "true");
      }
    }
  }
  return args;
}

function main(): void {
  assertNoDatabaseReachable();
  const args = parseArgs(process.argv.slice(2));
  const runs = (args.get("runs") ?? "draft")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const seed = Number(args.get("seed") ?? 20260927);
  const randomCount = Number(args.get("random") ?? 1000);
  const evaluatedOn = args.get("evaluated-on") ?? "2026-09-27";
  const bundlePath = args.get("bundle") ?? null;
  const outPath = args.get("out") ?? null;
  const adaptiveHistory = args.get("adaptive-history") === "true";
  const adaptiveReplicates = Number(args.get("adaptive-replicates") ?? 3);

  const sources: ParameterSource[] = [];
  for (const run of runs) {
    if (run === "draft") sources.push(loadDraftSource());
    else if (run === "fixture") sources.push(loadFixtureSource());
    else if (run === "bundle") {
      if (!bundlePath) throw new Error("--runs bundle requires --bundle <path>");
      sources.push(loadBundleFileSource(bundlePath));
    } else throw new Error(`Unknown run: ${run}`);
  }
  if (sources.length === 0) throw new Error("No parameter source selected.");

  // The grid is built once, from the FIRST source's declared input ranges, so
  // every run in a single report is scored over the identical profile set.
  const primary = sources[0];
  const body = bodyGridFromBundle(primary.policy);
  const movementContraRules = [...new Set(primary.policy.ruleIds)]
    .filter((rule) => rule.startsWith("CONTRA."))
    .sort();
  const profiles = buildGrid({ body, movementContraRules, seed, randomCount });

  const reports = sources.map((source) => runOne(source, profiles, evaluatedOn));

  const runKey = contentHash({
    seed,
    randomCount,
    evaluatedOn,
    profileCount: profiles.length,
    blocks: [...new Set(profiles.map((profile) => profile.block))].sort(),
    body,
    movementContraRules,
    sources: sources.map((source) => ({ key: source.key, digests: source.artifactDigests })),
  });

  const blockCounts = new Counter();
  for (const profile of profiles) blockCounts.add(profile.block);

  const out: string[] = [];
  out.push("# AI Coach v1 validation harness — engine behaviour at scale");
  out.push("");
  out.push(
    "**Every profile in this report is synthetic and machine-generated.** No real client's intake " +
      "answers, measurements or meal plans were read, and the harness never opens a database " +
      "connection: it deletes `DATABASE_URL` from its own environment before it touches an engine " +
      "module, so an accidental query fails instead of connecting. Nothing below describes " +
      "Steadfast's real clients, and no distribution here is evidence about them."
  );
  out.push("");
  out.push(
    `- Evaluation date handed to the engines: ${evaluatedOn} (not the system clock — the engines stay pure)`
  );
  out.push(
    `- Tool: \`scripts/ai-coach-validation-harness.ts\` (web repo; outside every bundle graph)`
  );
  out.push(`- Profiles: **${profiles.length}**`);
  out.push(`- Seed: ${seed}; random block size: ${randomCount}`);
  out.push(`- Run key (grid + seed + artifact digests): \`${runKey}\``);
  out.push(
    `- Parameter sources reported: ${sources.map((source) => `**${source.key}**`).join(", ")}`
  );
  out.push("");
  out.push("## 0. Which mode this ran in");
  out.push("");
  for (const report of reports) {
    const resolved = report.binding.prescriptionParameters !== null;
    if (report.source.key === "draft" && !resolved) {
      out.push(
        "**`draft` ran in mode 1 — the fail-closed proof.** The reviewed values the engines need are " +
          "deliberately absent from the checked-in bundle, so the run reports exactly which ones are " +
          "missing and whether any profile in the grid nevertheless reached a composed numerical plan. " +
          "There is no distribution of targets to report, and that is the correct answer today."
      );
    } else if (report.source.key === "draft") {
      out.push(
        "**`draft` ran in mode 2 — the full distribution report.** The checked-in bundle now resolves a " +
          "complete parameter set, so the target, macro, projected-change, outcome and training " +
          "distributions below are over the real values."
      );
    } else if (report.source.key === "fixture") {
      out.push(
        "**`fixture` ran in mode 2 against the repository's deliberately fake SYNTHETIC parameters.** " +
          "It exists so the mode-2 report path is proven working before the real values exist, and so " +
          "the structural findings that do not depend on the values (which branches are reachable, " +
          "where two engines disagree, what the catalog cannot cover) can be raised now rather than " +
          "after signing. Its numbers are fixture numbers."
      );
    } else {
      out.push(
        `**\`${report.source.key}\` ran in mode 2 against a caller-supplied bundle** (${report.source.provenance}).` +
          (resolved
            ? " Its parameter set resolved, so the distributions below are over those values."
            : " Its parameter set did **not** resolve; see the binding table for what is missing.")
      );
    }
    out.push("");
  }

  out.push("## 1. Flags — things a person should look at before signing");
  out.push("");
  const allFlags: { run: string; flag: string }[] = [];
  for (const report of reports) {
    for (const flag of report.flags) allFlags.push({ run: report.source.key, flag });
  }
  if (allFlags.length === 0) {
    out.push("None raised by this run.");
  } else {
    let n = 0;
    for (const { run, flag } of allFlags) {
      n += 1;
      out.push(`${n}. **[${run}]** ${flag}`);
    }
  }
  out.push("");

  out.push("## 2. How the grid was chosen");
  out.push("");
  out.push(
    "Not a random sample. Each block enumerates the **full cross product** of the axes it owns, so " +
      "every combination of those axes is tested. The axes a block does not own are drawn from a " +
      "separate seeded stream rather than cycled by loop index — index cycling makes two axes whose " +
      "value counts share a factor move together, and then a per-axis table in this report is really " +
      "measuring the other axis. A final seeded-random block covers interactions no single block's " +
      "factorial reaches. Body-metric values come from the policy bundle's **own** declared input " +
      "ranges — `min-1, min, min+1, midpoint, max-1, max, max+1` — so both edges of every bound are " +
      "tested from both sides, and the grid follows the bundle if the ranges change. Intake statuses " +
      "stay CONFIRMED and measurements stay fresh outside blocks D and R, so a degenerate input never " +
      "silently explains another block's result."
  );
  out.push("");
  out.push("| Block | Axes enumerated exhaustively | Profiles |");
  out.push("|---|---|---|");
  out.push(
    `| N | energy-method population (5) x activity (4) x body-weight intent (4) x pace (4) x resistance context (3) | ${blockCounts.get("N")} |`
  );
  out.push(
    `| P | eating pattern (6, incl. vegan and pescatarian) x reason (4) x pattern status (2) x intent (4) | ${blockCounts.get("P")} |`
  );
  out.push(
    `| B | age (7) x height (7) x mass (7), bundle bounds and one point outside each | ${blockCounts.get("B")} |`
  );
  out.push(
    `| T | training days (7) x equipment tier subsets (7) x experience (3) x session-length band (5) | ${blockCounts.get("T")} |`
  );
  out.push(
    `| C | movement contraindication sets (none, each singly, adjacent pairs, all) x equipment (7) x days (3) | ${blockCounts.get("C")} |`
  );
  out.push(
    `| F | dietary-restriction strings (4) x allergy strings (3) x intent (4) x pattern (6) | ${blockCounts.get("F")} |`
  );
  out.push(
    `| S | screening result (3) x nutrition contraindication patterns (11) x plan history states (4) | ${blockCounts.get("S")} |`
  );
  out.push(
    `| D | each governed status DECLINED/UNKNOWN, each value absent, stale and future measurement dates, absent session band, v1 intake, every intent with an UNDECIDED pace | ${blockCounts.get("D")} |`
  );
  out.push(`| R | seeded uniform sample over every axis at once | ${blockCounts.get("R")} |`);
  out.push(`| **Total** | | **${profiles.length}** |`);
  out.push("");

  out.push("## 3. What was and was not exercised");
  out.push("");
  out.push("Exercised, with the real shipped implementations:");
  out.push("");
  out.push(
    "- `resolvePrescriptionParameters`, `computePrescription` (the 17-step prescription engine)"
  );
  out.push("- `resolveTrainingParameters`, `composeTraining` (the 14-step training composer)");
  out.push("- `composeInitialPlan` (v2 prescription-first path), in both MACROS and MEALS mode");
  out.push("- `checkMealComposition` (allergen, dietary-tag and policy-version feasibility)");
  out.push("- `resolveNutritionSafetyPolicy`, `evaluateNutritionSafety` (the T-1003 floors)");
  out.push("- `evaluateAutonomyGate` (the fixed-order gate), plus a one-fact-at-a-time probe set");
  out.push(
    "- The real checked-in DRAFT_UNSIGNED policy bundle, exercise catalog, evidence registry and escalation templates"
  );
  out.push("");
  out.push("**Not** exercised, and why — stated rather than quietly dropped:");
  out.push("");
  out.push(
    "- **Beginner-constraint flags are not an engine input.** `ComposeTrainingInput` has no field for " +
      "them; `beginnerConstraintIds` is only cross-referenced against the bundle's rule list when an " +
      "artifact set is loaded. There is no axis to sweep, so the grid reports catalog coverage of " +
      "those rules instead."
  );
  out.push(
    "- **Artifact loading, publication, revocation, expiry and digest verification.** All DB-bound. " +
      "`resolveReviewedPrescriptionExplanationTexts` needs a `ReviewedArtifactSet` whose members sit " +
      "in `artifacts/repository.ts`'s private WeakSet, which only the DB loader populates, so the " +
      "harness composes the same calls `resolvePrescriptionParametersForArtifacts` makes and " +
      "re-creates only its six-line bundle-order template lookup."
  );
  out.push(
    "- **The FDC draft food catalog cannot reach the meal composer.** `composeMealsToPrescription` " +
      "resolves food IDs through `catalog/loader.ts`, which serves only the in-code fixture keys, and " +
      "it is hard-wired to three fixture food IDs. Meal composition is therefore exercised against " +
      "the fixture catalog; the 232-item draft catalog is reported on but not composed from."
  );
  out.push(
    "- **The weekly controller, finalization, acceptance and the provider boundary.** All DB-bound or " +
      "provider-bound, and out of scope for a distribution over initial plans."
  );
  out.push("");

  for (let i = 0; i < reports.length; i += 1) {
    const report = reports[i];
    out.push(`## ${4 + i}. Run: ${report.source.key} — ${report.source.label}`);
    out.push("");
    if (report.source.key === "fixture") {
      out.push(
        "> **These numbers are fixture numbers.** Every parameter in this run comes from the " +
          "repository's deliberately fake `synthetic-fixtures.ts` values. The run exists to prove the " +
          "full-distribution report path works end to end, and to surface findings that do not depend " +
          "on the values. Do not read any figure below as a clinical quantity or as a prediction of " +
          "what the signed bundle will produce."
      );
      out.push("");
    }
    for (const section of report.sections) {
      out.push(section);
      out.push("");
    }
  }

  let nextSection = 4 + reports.length;
  if (adaptiveHistory) {
    const adaptive = adaptiveHistorySection(sources, seed, adaptiveReplicates);
    out.push(`## ${nextSection}. S-23 adaptive energy estimator — synthetic history vs ground truth`);
    out.push("");
    for (const line of adaptive.lines) out.push(line);
    out.push("");
    nextSection += 1;
  }

  out.push(`## ${nextSection}. Reproducing this report`);
  out.push("");
  out.push("```");
  out.push(
    `pnpm exec tsx scripts/ai-coach-validation-harness.ts --runs ${runs.join(",")} ` +
      `--seed ${seed} --random ${randomCount} --evaluated-on ${evaluatedOn}` +
      (bundlePath ? ` --bundle ${bundlePath}` : "") +
      (adaptiveHistory ? ` --adaptive-history --adaptive-replicates ${adaptiveReplicates}` : "") +
      ` --out <path>`
  );
  out.push("```");
  out.push("");
  out.push(
    "Deterministic for a fixed seed, random-block size, evaluation date and artifact set; the run " +
      "key above is a hash of exactly those inputs. Once the omitted values are signed into the draft " +
      "bundle, `--runs draft` produces the full distribution report with no code change."
  );
  out.push("");

  const markdown = out.join("\n");
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), markdown, "utf8");
    process.stdout.write(`Wrote ${markdown.length} bytes to ${path.resolve(outPath)}\n`);
    process.stdout.write(`Profiles: ${profiles.length}; flags: ${allFlags.length}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
  }
}

main();
