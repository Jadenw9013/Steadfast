import { artifactContentDigest } from "./digest";
import type {
  ArtifactDraftInput,
  ArtifactKind,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "./schema";
import {
  PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
  PRESCRIPTION_MACRO_COMPOSITION_ID,
  PRESCRIPTION_METHOD_STRUCTURE_ID,
  PRESCRIPTION_PARAMETER_SPECS,
  PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
  PRESCRIPTION_ROUNDING_ORDER_ID,
  energyCoefficientParameterId,
  energyDensityParameterId,
  goalAdjustmentParameterId,
  inputRangeParameterId,
  proteinParameterId,
} from "../prescription/parameters";
import {
  EFFORT_CARDIO_TEMPLATE_ID,
  EFFORT_STRENGTH_TEMPLATE_ID,
  METHOD_DOSE_BEGINNER_ID,
  METHOD_TEMPLATE_SELECTION_ID,
  RULE_BOUNDED_TRAINING_ID,
  RULE_CARDIO_DOSE_ID,
  RULE_SESSION_STRUCTURE_ID,
  RULE_WORKLOAD_COMBINED_ID,
  TRAINING_COMPOSER_PARAMETER_SPECS,
} from "../training/parameters";
import {
  WEEKLY_COOLDOWN_RULE_ID,
  WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS,
  WEEKLY_CUMULATIVE_RULE_ID,
  WEEKLY_DROP_SESSION_RULE_ID,
  WEEKLY_EVIDENCE_RULE_ID,
  WEEKLY_PARAMETER_SPECS,
  WEEKLY_RELATIVE_STEP_RULE_ID,
} from "../weekly-parameters";

/**
 * T-1005 engineering fixtures only. Every fact, threshold, identity and review
 * record below is synthetic and is not fit for a real account or live coaching.
 */

export const SYNTHETIC_ARTIFACT_ENGINE_VERSION = "ai-coach-artifact-engine-v1";

const SYNTHETIC_ENERGY_BASE = {
  MALE_ADULT: { intercept: 700, ageCoefficient: -5, weightCoefficient: 10, heightCoefficient: 500 },
  FEMALE_ADULT: {
    intercept: 600,
    ageCoefficient: -5,
    weightCoefficient: 9,
    heightCoefficient: 450,
  },
} as const;
const SYNTHETIC_ACTIVITY_MULTIPLIER: Record<
  "INACTIVE" | "LOW_ACTIVE" | "ACTIVE" | "VERY_ACTIVE",
  number
> = {
  INACTIVE: 1,
  LOW_ACTIVE: 1.1,
  ACTIVE: 1.2,
  VERY_ACTIVE: 1.3,
};

const SYNTHETIC_PROTEIN_BASE: Record<
  "NONE" | "OCCASIONAL" | "REGULAR",
  { min: number; target: number; max: number }
> = {
  NONE: { min: 0.5, target: 1, max: 1.5 },
  OCCASIONAL: { min: 1, target: 1.5, max: 2 },
  REGULAR: { min: 1.5, target: 2.5, max: 3.5 },
};

export function syntheticPrescriptionParameterValue(id: string): number {
  for (const population of ["MALE_ADULT", "FEMALE_ADULT"] as const) {
    for (const activity of ["INACTIVE", "LOW_ACTIVE", "ACTIVE", "VERY_ACTIVE"] as const) {
      const base = SYNTHETIC_ENERGY_BASE[population];
      if (id === energyCoefficientParameterId(population, activity, "INTERCEPT"))
        return base.intercept;
      if (id === energyCoefficientParameterId(population, activity, "AGE_COEFFICIENT"))
        return base.ageCoefficient;
      if (id === energyCoefficientParameterId(population, activity, "WEIGHT_COEFFICIENT"))
        return base.weightCoefficient;
      if (id === energyCoefficientParameterId(population, activity, "HEIGHT_COEFFICIENT"))
        return base.heightCoefficient;
      if (id === energyCoefficientParameterId(population, activity, "ACTIVITY_COEFFICIENT"))
        return SYNTHETIC_ACTIVITY_MULTIPLIER[activity];
    }
  }
  if (id === inputRangeParameterId("AGE_YEARS", "MIN")) return 18;
  if (id === inputRangeParameterId("AGE_YEARS", "MAX")) return 79;
  if (id === inputRangeParameterId("HEIGHT_CM", "MIN")) return 140;
  if (id === inputRangeParameterId("HEIGHT_CM", "MAX")) return 220;
  if (id === inputRangeParameterId("WEIGHT_KG", "MIN")) return 40;
  if (id === inputRangeParameterId("WEIGHT_KG", "MAX")) return 200;
  if (id === "ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS") return 14;
  if (id === "ENERGY.BODY_MASS.ENERGY_PER_KG") return 5000;
  if (id === goalAdjustmentParameterId("LOSE", "GRADUAL")) return -0.1;
  if (id === goalAdjustmentParameterId("LOSE", "MODERATE")) return -0.2;
  if (id === goalAdjustmentParameterId("GAIN", "GRADUAL")) return 0.1;
  if (id === goalAdjustmentParameterId("GAIN", "MODERATE")) return 0.2;
  if (id === "GOAL.ADJUSTMENT.MAINTAIN.ANY.ENERGY_DELTA_FRACTION") return 0;
  if (id === "GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION") return 0.25;
  if (id === "GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION") return 0.25;
  for (const context of ["NONE", "OCCASIONAL", "REGULAR"] as const) {
    const base = SYNTHETIC_PROTEIN_BASE[context];
    if (id === proteinParameterId(context, "MIN")) return base.min;
    if (id === proteinParameterId(context, "TARGET")) return base.target;
    if (id === proteinParameterId(context, "MAX")) return base.max;
  }
  if (id === "MACRO.CARBOHYDRATE.PERCENT_ENERGY.MIN") return 38;
  if (id === "MACRO.CARBOHYDRATE.PERCENT_ENERGY.MAX") return 66;
  if (id === "MACRO.FAT.PERCENT_ENERGY.MIN") return 12;
  if (id === "MACRO.FAT.PERCENT_ENERGY.MAX") return 30;
  if (id === energyDensityParameterId("PROTEIN")) return 5;
  if (id === energyDensityParameterId("CARBOHYDRATE")) return 5;
  if (id === energyDensityParameterId("FAT")) return 10;
  if (id === "ROUNDING.ENERGY_KCAL.STEP") return 10;
  if (id === "ROUNDING.MACRO_GRAMS.DECIMALS") return 0;
  if (id === "ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS") return 2;
  if (id === "COMPOSITION.TOLERANCE_PERCENT") return 10;
  throw new Error(`No synthetic value defined for prescription parameter ${id}`);
}

const SYNTHETIC_PROGRESSION_PARAMETER_SPECS = [
  { id: "PROGRESSION.STRENGTH.REPS.INCREMENT", unit: "REPETITIONS" },
  { id: "PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL", unit: "REPETITIONS" },
  { id: "PROGRESSION.STRENGTH.SETS.INCREMENT", unit: "SETS" },
  { id: "PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL", unit: "SETS" },
  { id: "PROGRESSION.STRENGTH.LOAD.INCREMENT_FRACTION", unit: "FRACTION_OF_CURRENT_LOAD" },
  {
    id: "PROGRESSION.STRENGTH.LOAD.MAX_INCREASE_FRACTION_PER_WINDOW",
    unit: "FRACTION_OF_CURRENT_LOAD",
  },
  { id: "PROGRESSION.CARDIO.MINUTES.INCREMENT", unit: "MINUTES_PER_SESSION" },
  { id: "PROGRESSION.CARDIO.MINUTES.MAX_ABOVE_INITIAL", unit: "MINUTES_PER_SESSION" },
  { id: "PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS", unit: "WEEKS" },
  { id: "PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION", unit: "FRACTION_OF_PRESCRIBED_SETS" },
  { id: "PROGRESSION.EVIDENCE.MAX_EFFORT_RATING", unit: "RPE_POINTS" },
  { id: "PROGRESSION.WINDOW.MIN_DAYS_BETWEEN_INCREASES", unit: "DAYS" },
] as const;

export function syntheticTrainingParameterValue(id: string): number {
  if (id === "TRAINING.SESSION.EXERCISE_COUNT.UNDER_30.MAX") return 4;
  if (id === "TRAINING.SESSION.EXERCISE_COUNT.MIN_30_45.MAX") return 5;
  if (id === "TRAINING.SESSION.EXERCISE_COUNT.MIN_45_60.MAX") return 6;
  if (id === "TRAINING.SESSION.EXERCISE_COUNT.MIN_60_90.MAX") return 8;
  if (id === "TRAINING.SESSION.EXERCISE_COUNT.OVER_90.MAX") return 10;
  if (id === "TRAINING.SESSION.EXERCISE_COUNT.MIN") return 3;
  if (id === "TRAINING.SESSION.PLANNED_MINUTES.UNDER_30") return 30;
  if (id === "TRAINING.SESSION.PLANNED_MINUTES.MIN_30_45") return 45;
  if (id === "TRAINING.SESSION.PLANNED_MINUTES.MIN_45_60") return 60;
  if (id === "TRAINING.SESSION.PLANNED_MINUTES.MIN_60_90") return 90;
  if (id === "TRAINING.SESSION.PLANNED_MINUTES.OVER_90") return 120;
  if (id === "TRAINING.DOSE.NEW.SETS_PER_EXERCISE") return 2;
  if (id === "TRAINING.DOSE.RETURNING.SETS_PER_EXERCISE") return 3;
  if (id === "TRAINING.DOSE.EXPERIENCED.SETS_PER_EXERCISE") return 3;
  if (id === "TRAINING.DOSE.NEW.REPS_PER_SET") return 10;
  if (id === "TRAINING.DOSE.RETURNING.REPS_PER_SET") return 10;
  if (id === "TRAINING.DOSE.EXPERIENCED.REPS_PER_SET") return 8;
  if (id === "TRAINING.DOSE.NEW.REST_SECONDS") return 60;
  if (id === "TRAINING.DOSE.RETURNING.REST_SECONDS") return 90;
  if (id === "TRAINING.DOSE.EXPERIENCED.REST_SECONDS") return 120;
  if (id === "TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.NEW") return 3;
  if (id === "TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.RETURNING") return 4;
  if (id === "TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.EXPERIENCED") return 5;
  if (id === "CARDIO.DOSE.NEW.SESSION_MINUTES") return 20;
  if (id === "CARDIO.DOSE.RETURNING.SESSION_MINUTES") return 30;
  if (id === "CARDIO.DOSE.EXPERIENCED.SESSION_MINUTES") return 30;
  if (id === "CARDIO.DOSE.NEW.SESSIONS_PER_WEEK") return 2;
  if (id === "CARDIO.DOSE.RETURNING.SESSIONS_PER_WEEK") return 3;
  if (id === "CARDIO.DOSE.EXPERIENCED.SESSIONS_PER_WEEK") return 3;
  if (id === "CARDIO.DOSE.MAX_SESSION_MINUTES") return 45;
  if (id === "WORKLOAD.WEEKLY.TOTAL_SESSIONS.MAX") return 6;
  if (id === "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX") return 360;
  if (id === "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED") return 240;
  if (id === "WORKLOAD.WEEKLY.CONSECUTIVE_TRAINING_DAYS.MAX") return 3;
  if (id === "PROGRESSION.STRENGTH.REPS.INCREMENT") return 1;
  if (id === "PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL") return 2;
  if (id === "PROGRESSION.STRENGTH.SETS.INCREMENT") return 0;
  if (id === "PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL") return 0;
  if (id === "PROGRESSION.STRENGTH.LOAD.INCREMENT_FRACTION") return 0.05;
  if (id === "PROGRESSION.STRENGTH.LOAD.MAX_INCREASE_FRACTION_PER_WINDOW") return 0.1;
  if (id === "PROGRESSION.CARDIO.MINUTES.INCREMENT") return 2;
  if (id === "PROGRESSION.CARDIO.MINUTES.MAX_ABOVE_INITIAL") return 6;
  if (id === "PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS") return 2;
  if (id === "PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION") return 1;
  if (id === "PROGRESSION.EVIDENCE.MAX_EFFORT_RATING") return 6;
  if (id === "PROGRESSION.WINDOW.MIN_DAYS_BETWEEN_INCREASES") return 14;
  throw new Error(`No synthetic value defined for training parameter ${id}`);
}

function syntheticWeeklyParameterValue(id: string): number {
  const values: Record<string, number> = {
    "WEEKLY.EVIDENCE.MIN_CONSECUTIVE_WEEKS": 3,
    "WEEKLY.EVIDENCE.MAX_MISSING_WEEKS": 0,
    "WEEKLY.EVIDENCE.MIN_COMPLETE_CHECK_INS_PER_WEEK": 1,
    "WEEKLY.EVIDENCE.MIN_PLAN_FOLLOWING_DAYS": 5,
    "WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_PER_WEEK": 1,
    "WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_TOTAL": 3,
    "WEEKLY.EVIDENCE.MAX_COMPARABLE_SPREAD_FRACTION": 0.02,
    "WEEKLY.EVIDENCE.PLATEAU_MAX_RELATIVE_CHANGE": 0.005,
    "WEEKLY.ADJUSTMENT.ENERGY.STEP_FRACTION": 0.03,
    "WEEKLY.ADJUSTMENT.ENERGY.STEP_TOLERANCE_KCAL": 0.2,
    "WEEKLY.COOLDOWN.MIN_DAYS_BETWEEN_MATERIAL_CHANGES": 14,
    "WEEKLY.CUMULATIVE.WINDOW_DAYS": 28,
    "WEEKLY.CUMULATIVE.MAX_MATERIAL_CHANGES_PER_WINDOW": 2,
    "WEEKLY.CUMULATIVE.ENERGY.MAX_REDUCTION_FRACTION": 0.1,
    "WEEKLY.CUMULATIVE.MAX_CHANGED_DOMAINS_PER_REVIEW": 1,
    "WEEKLY.SIMPLIFY.TRAINING_DAYS.DECREMENT": 1,
    "WEEKLY.SIMPLIFY.CARDIO.MINUTES.DECREMENT": 5,
    "WEEKLY.SIMPLIFY.CARDIO.MINUTES.FLOOR": 5,
  };
  const value = values[id];
  if (value === undefined) throw new Error(`No synthetic value defined for weekly parameter ${id}`);
  return value;
}

function reviewMetadata(namespace: string): SignedArtifactReviewMetadata {
  return {
    accountableOwner: { name: "SYNTHETIC_FIXTURE_OWNER", role: "TEST_ONLY" },
    reviewer: {
      name: "SYNTHETIC_FIXTURE_REVIEWER",
      reviewerType: "QUALIFIED_CONTENT_REVIEWER",
      qualifications: ["SYNTHETIC_FIXTURE_NOT_A_REAL_QUALIFICATION"],
    },
    reviewedAt: "2026-01-01T00:00:00.000Z",
    reviewRecordId: `synthetic-review-${namespace}`,
    decision: "APPROVED",
    signoffScope: ["SYNTHETIC_SCHEMA_AND_CONTROL_FLOW_ONLY"],
    allowedScope: ["GENERAL_FITNESS_PROGRAMMING", "GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
    explicitExclusions: [
      "DIAGNOSIS",
      "TREATMENT_OR_REHABILITATION",
      "CLINICAL_NUTRITION_OR_MEDICAL_NUTRITION_THERAPY",
      "MEDICATION_OR_SUPPLEMENT_PRESCRIBING",
      "CLINICIAN_INSTRUCTION_OVERRIDE",
    ],
    jurisdictionReview: {
      jurisdictions: ["SYNTHETIC_TEST_ONLY"],
      legalReviewStatus: "SYNTHETIC_TEST_ONLY",
      recordId: `synthetic-legal-review-${namespace}`,
      reviewedAt: "2026-01-01T00:00:00.000Z",
    },
    publicFrameworkReferences: [
      {
        framework: "ACE_PUBLIC_SCOPE",
        sourceUrl:
          "https://www.acefitness.org/resources/pros/expert-articles/6248/nutrition-scope-of-practice-what-you-can-do-as-a-personal-trainer/",
        usage: "CANDIDATE_SCOPE_REFERENCE_ONLY",
        proprietaryMaterialCopied: false,
        endorsementOrAffiliationClaimed: false,
      },
    ],
  };
}

function artifact(
  namespace: string,
  kind: ArtifactKind,
  artifactKey: string,
  content: ArtifactDraftInput["content"],
  dependencies: ArtifactReference[] = [],
  version = 1
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  return {
    id: `${artifactKey}:v${version}`,
    artifactKey,
    version,
    kind,
    schemaVersion: 1,
    engineVersions: [SYNTHETIC_ARTIFACT_ENGINE_VERSION],
    dependencies,
    synthetic: true,
    reviewMetadata: reviewMetadata(`${namespace}-${kind.toLowerCase()}-${version}`),
    content,
  };
}

function reference(value: ArtifactDraftInput<SignedArtifactReviewMetadata>): ArtifactReference {
  return {
    id: value.id,
    artifactKey: value.artifactKey,
    version: value.version,
    kind: value.kind,
    digest: artifactContentDigest(value),
  };
}

export function buildSyntheticArtifactSet(namespace = "t1005-fixture", policyVersion = 1) {
  const runtime = namespace === "t1008-runtime";
  const foodKey = runtime ? "food-fixture-v2" : `synthetic-food-${namespace}`;
  const exerciseKey = runtime ? "exercise-fixture-v1" : `synthetic-exercise-${namespace}`;
  const evidenceKey = `synthetic-evidence-${namespace}`;
  const escalationKey = `synthetic-escalation-${namespace}`;
  const policyKey = runtime ? "policy-fixture-v1" : `synthetic-policy-${namespace}`;

  const foodCatalog = artifact(namespace, "FOOD_CATALOG", foodKey, {
    artifactKey: foodKey,
    version: 1,
    items: [
      {
        id: "synthetic-food-item",
        version: 1,
        name: "Synthetic test food",
        source: {
          sourceId: "synthetic-food-source",
          sourceVersion: "fixture-v1",
          sourceUrl: "https://example.invalid/synthetic-food-source",
          reviewedAt: "2026-01-01T00:00:00.000Z",
          licenseClassification: "SYNTHETIC_TEST_ONLY",
          authority: "REVIEWED_SOURCE",
        },
        foodState: "PREPARED",
        servingGrams: 100,
        nutrients: {
          energyKcal: 123,
          proteinGrams: 4,
          carbohydrateGrams: 20,
          fatGrams: 3,
          missingNutrientIds: ["ALL_MICRONUTRIENTS"],
        },
        allergenFacts: {
          contains: [],
          evidenceSourceId: "synthetic-allergen-evidence",
          verificationStatus: "REVIEWED_SOURCE",
          crossContactRequiresCurrentVerification: true,
        },
      },
      ...(runtime
        ? [
            ["chicken-breast-raw", "RAW", 120, 22.5, 0, 2.6],
            ["brown-rice-cooked", "PREPARED", 112, 2.3, 23.5, 0.8],
            ["broccoli-steamed", "PREPARED", 31, 2.6, 6, 0.3],
          ].map(([id, foodState, energyKcal, proteinGrams, carbohydrateGrams, fatGrams]) => ({
            id: id as string,
            version: 1,
            name: `Synthetic reviewed ${id as string}`,
            source: {
              sourceId: `synthetic-${id as string}-source`,
              sourceVersion: "fixture-v1",
              sourceUrl: `https://example.invalid/${id as string}`,
              reviewedAt: "2026-01-01T00:00:00.000Z",
              licenseClassification: "SYNTHETIC_TEST_ONLY" as const,
              authority: "REVIEWED_SOURCE" as const,
            },
            foodState: foodState as "RAW" | "PREPARED",
            servingGrams: 100,
            nutrients: {
              energyKcal: energyKcal as number,
              proteinGrams: proteinGrams as number,
              carbohydrateGrams: carbohydrateGrams as number,
              fatGrams: fatGrams as number,
              missingNutrientIds: ["ALL_MICRONUTRIENTS"],
            },
            allergenFacts: {
              contains: [],
              evidenceSourceId: `synthetic-${id as string}-allergen-evidence`,
              verificationStatus: "REVIEWED_SOURCE" as const,
              crossContactRequiresCurrentVerification: true,
            },
          }))
        : []),
    ],
  });

  const exerciseCatalog = artifact(namespace, "EXERCISE_CATALOG", exerciseKey, {
    artifactKey: exerciseKey,
    version: 1,
    exercises: [
      {
        id: "synthetic-exercise-item",
        version: 1,
        name: "Synthetic test exercise",
        modality: "STRENGTH",
        source: {
          sourceId: "synthetic-exercise-source",
          sourceVersion: "fixture-v1",
          sourceUrl: "https://example.invalid/synthetic-exercise-source",
          reviewedAt: "2026-01-01T00:00:00.000Z",
          licenseClassification: "SYNTHETIC_TEST_ONLY",
          authority: "REVIEWED_SOURCE",
        },
        equipmentIds: ["SYNTHETIC_NONE"],
        substitutionIds: [],
        contraindicationRuleIds: ["SYNTHETIC_CONTRAINDICATION_RULE"],
        beginnerConstraintIds: ["SYNTHETIC_BEGINNER_CONSTRAINT"],
      },
      ...(runtime
        ? [
            ["goblet-squat", "STRENGTH"],
            ["bodyweight-squat", "STRENGTH"],
            ["brisk-walk", "CARDIO"],
          ].map(([id, modality]) => ({
            id,
            version: 1,
            name: `Synthetic reviewed ${id}`,
            modality: modality as "STRENGTH" | "CARDIO",
            source: {
              sourceId: `synthetic-${id}-source`,
              sourceVersion: "fixture-v1",
              sourceUrl: `https://example.invalid/${id}`,
              reviewedAt: "2026-01-01T00:00:00.000Z",
              licenseClassification: "SYNTHETIC_TEST_ONLY" as const,
              authority: "REVIEWED_SOURCE" as const,
            },
            equipmentIds: ["SYNTHETIC_NONE"],
            substitutionIds: [],
            contraindicationRuleIds: ["SYNTHETIC_CONTRAINDICATION_RULE"],
            beginnerConstraintIds: ["SYNTHETIC_BEGINNER_CONSTRAINT"],
          }))
        : []),
    ],
    templates: [
      {
        id: "synthetic-session-template",
        version: 1,
        exerciseIds: ["synthetic-exercise-item"],
        beginnerConstraintIds: ["SYNTHETIC_BEGINNER_CONSTRAINT"],
        source: {
          sourceId: "synthetic-template-source",
          sourceVersion: "fixture-v1",
          sourceUrl: "https://example.invalid/synthetic-template-source",
          reviewedAt: "2026-01-01T00:00:00.000Z",
          licenseClassification: "SYNTHETIC_TEST_ONLY",
          authority: "REVIEWED_SOURCE",
        },
      },
      ...(runtime
        ? [
            {
              id: "fixture-beginner-v1",
              version: 1,
              exerciseIds: ["goblet-squat", "bodyweight-squat", "brisk-walk"],
              beginnerConstraintIds: ["SYNTHETIC_BEGINNER_CONSTRAINT"],
              source: {
                sourceId: "synthetic-runtime-template-source",
                sourceVersion: "fixture-v1",
                sourceUrl: "https://example.invalid/synthetic-runtime-template-source",
                reviewedAt: "2026-01-01T00:00:00.000Z",
                licenseClassification: "SYNTHETIC_TEST_ONLY" as const,
                authority: "REVIEWED_SOURCE" as const,
              },
            },
          ]
        : []),
    ],
  });

  const evidenceRegistry = artifact(namespace, "EVIDENCE_REGISTRY", evidenceKey, {
    artifactKey: evidenceKey,
    version: 1,
    claims: [
      {
        id: "synthetic-evidence-claim",
        version: 1,
        claim: "Synthetic claim used only to exercise evidence-registry integrity.",
        sourceUrl: "https://example.invalid/synthetic-evidence",
        population: "Synthetic test subjects only.",
        limitations: ["Not evidence for human coaching or clinical use."],
        reviewer: {
          name: "SYNTHETIC_FIXTURE_REVIEWER",
          qualifications: ["SYNTHETIC_FIXTURE_NOT_A_REAL_QUALIFICATION"],
        },
        ruleIds: [
          "SYNTHETIC_RULE",
          "SYNTHETIC_EVIDENCE_RULE",
          "SYNTHETIC_INTAKE_SCREEN_RULE",
          "SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE",
          "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE",
          "SYNTHETIC_NO_CONSECUTIVE_DEFICIT_RULE",
          METHOD_TEMPLATE_SELECTION_ID,
          METHOD_DOSE_BEGINNER_ID,
          RULE_SESSION_STRUCTURE_ID,
          RULE_CARDIO_DOSE_ID,
          RULE_WORKLOAD_COMBINED_ID,
          RULE_BOUNDED_TRAINING_ID,
        ],
        reviewDate: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  const escalationTemplates = artifact(namespace, "ESCALATION_TEMPLATES", escalationKey, {
    artifactKey: escalationKey,
    version: 1,
    templates: [
      {
        id: "synthetic-pause-refer-template",
        version: 1,
        reasonCodes: [
          "SYNTHETIC_OUT_OF_SCOPE",
          "SYNTHETIC_SCREEN_FLAGGED",
          "SYNTHETIC_SCREEN_UNKNOWN",
          "SYNTHETIC_CONTRAINDICATION",
          "GATE_APPROVED",
          "GATE_AUTHORITY_UNAVAILABLE",
          "GATE_OUT_OF_SCOPE",
          "GATE_SAFETY_RESTRICTED",
          "GATE_REQUIRED_INPUT_INVALID",
          "GATE_REQUIRED_INPUT_MISSING",
          "GATE_NUTRITION_SAFETY_UNAVAILABLE",
          "GATE_NUTRITION_SAFETY_HOLD",
          "GATE_NUTRITION_SAFETY_PAUSE_REFER",
          "GATE_EVIDENCE_INVALID",
          "GATE_EVIDENCE_MISSING",
          "GATE_EVIDENCE_INSUFFICIENT",
          "GATE_EVIDENCE_STALE",
          "GATE_CANDIDATE_INVALID",
          // T-2033: the new TARGET_AND_LIMITS prescription-unavailable check
          // (gate.ts) always leads with GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE
          // plus whichever PrescriptionReasonCode(s) the engine/resolver
          // returned (prescription/types.ts). resolveNextActionTemplateId
          // requires every code in a stopped evaluation's orderedReasonCodes
          // to be covered by one template, so all of them are listed here —
          // same reason the GATE_* codes above were added when T-1006 shipped.
          "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
          "PRESCRIPTION_INTAKE_VERSION_UNSUPPORTED",
          "PRESCRIPTION_INPUT_MISSING",
          "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE",
          "PRESCRIPTION_WEIGHT_MEASUREMENT_STALE",
          "PRESCRIPTION_POPULATION_UNSUPPORTED",
          "PRESCRIPTION_GOAL_PACE_UNDECIDED",
          "PRESCRIPTION_DIETARY_PATTERN_UNSUPPORTED",
          "PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE",
          "PRESCRIPTION_MAINTENANCE_BELOW_MINIMUM",
          "PRESCRIPTION_MACRO_RANGES_INFEASIBLE",
          "PRESCRIPTION_PARAMETER_MISSING",
          "PRESCRIPTION_PARAMETER_INCOMPATIBLE",
          "PRESCRIPTION_METHOD_UNSUPPORTED",
          "PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE",
          "SYNTHETIC_MINIMUM_DAILY_ENERGY_LIMIT",
          "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_LIMIT",
          "SYNTHETIC_CONSECUTIVE_DEFICIT_BLOCKED",
          "SYNTHETIC_RATE_INPUT_MISSING",
          "SYNTHETIC_HISTORY_UNVERIFIABLE",
          "PROVIDER_TIMEOUT",
          "PROVIDER_ERROR",
          "PROVIDER_RESPONSE_INVALID",
          "PROVIDER_OUTPUT_INVALID",
          "PROVIDER_TOKEN_LIMIT",
          "PROVIDER_CAUTION_SIGNAL",
          "PROVIDER_CLARIFICATION_REQUESTED",
          "PROVIDER_TENANT_CONTEXT_CHANGED",
          "PROVIDER_SERVER_INPUT_INVALID",
          "PROVIDER_GATE_BINDING_CHANGED",
        ],
        locale: "en-US",
        geographies: ["SYNTHETIC_TEST_ONLY"],
        pausedDomains: ["NUTRITION", "STRENGTH", "CARDIO"],
        nextStepText: "Synthetic test-only next step. No real guidance is provided.",
        nonMonitoringStatement: "Synthetic fixture: this service is not monitoring you.",
      },
      {
        id: EFFORT_STRENGTH_TEMPLATE_ID,
        version: 1,
        reasonCodes: ["SYNTHETIC_RULE"],
        locale: "en-US",
        geographies: ["SYNTHETIC_TEST_ONLY"],
        pausedDomains: ["STRENGTH"],
        nextStepText: "Moderate effort, 2-3 reps in reserve; maintain strict form.",
        nonMonitoringStatement: "Synthetic fixture: this service is not monitoring you.",
      },
      {
        id: EFFORT_CARDIO_TEMPLATE_ID,
        version: 1,
        reasonCodes: ["SYNTHETIC_RULE"],
        locale: "en-US",
        geographies: ["SYNTHETIC_TEST_ONLY"],
        pausedDomains: ["CARDIO"],
        nextStepText: "Conversational pace, RPE 4-5 out of 10; breathing comfortably.",
        nonMonitoringStatement: "Synthetic fixture: this service is not monitoring you.",
      },
    ],
  });

  const dependencies = [foodCatalog, exerciseCatalog, evidenceRegistry, escalationTemplates].map(
    reference
  );
  const policyBundle = artifact(
    namespace,
    "POLICY_BUNDLE",
    policyKey,
    {
      artifactKey: policyKey,
      version: policyVersion,
      supportedPopulation: "Synthetic test subjects only.",
      supportedGoals: ["SYNTHETIC_GENERAL_FITNESS"],
      requiredInputIds: [
        "SYNTHETIC_REQUIRED_INPUT",
        "SYNTHETIC_SCREEN_RESULT",
        "AGE_ELIGIBILITY",
        "PREGNANCY_POSTPARTUM",
        "EATING_DISORDER_HISTORY_OR_CONCERN",
        "TYPE_1_DIABETES",
        "CARDIAC_CONDITION",
      ],
      ruleIds: [
        "SYNTHETIC_RULE",
        "SYNTHETIC_ADJUSTMENT_RULE",
        "SYNTHETIC_COOLDOWN_RULE",
        "SYNTHETIC_CUMULATIVE_LIMIT_RULE",
        "SYNTHETIC_CONTRAINDICATION_RULE",
        "SYNTHETIC_BEGINNER_CONSTRAINT",
        "SYNTHETIC_EVIDENCE_RULE",
        "SYNTHETIC_INTAKE_SCREEN_RULE",
        "SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE",
        "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE",
        "SYNTHETIC_NO_CONSECUTIVE_DEFICIT_RULE",
        PRESCRIPTION_METHOD_STRUCTURE_ID,
        PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
        PRESCRIPTION_ROUNDING_ORDER_ID,
        PRESCRIPTION_MACRO_COMPOSITION_ID,
        PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
        METHOD_TEMPLATE_SELECTION_ID,
        METHOD_DOSE_BEGINNER_ID,
        RULE_SESSION_STRUCTURE_ID,
        RULE_CARDIO_DOSE_ID,
        RULE_WORKLOAD_COMBINED_ID,
        RULE_BOUNDED_TRAINING_ID,
        WEEKLY_EVIDENCE_RULE_ID,
        WEEKLY_COOLDOWN_RULE_ID,
        WEEKLY_CUMULATIVE_RULE_ID,
        WEEKLY_RELATIVE_STEP_RULE_ID,
        WEEKLY_DROP_SESSION_RULE_ID,
        "CONTRA.SPINAL_LOADING.V1",
        "CONTRA.OVERHEAD_LOADING.V1",
        "CONTRA.DEEP_KNEE_FLEXION.V1",
        "CONTRA.HIGH_IMPACT.V1",
        "CONTRA.FLOOR_TRANSFER.V1",
        "CONTRA.PRONE_POSITION.V1",
        "CONTRA.SUPINE_POSITION.V1",
        "CONTRA.GRIP_DEMAND.V1",
        "BEGINNER.CONSTRAINT.TECHNIQUE_SIMPLE.V1",
        "BEGINNER.CONSTRAINT.NO_EXTERNAL_LOAD.V1",
        "BEGINNER.CONSTRAINT.LOW_IMPACT.V1",
        "BEGINNER.CONSTRAINT.SUPERVISION_NOT_REQUIRED.V1",
      ],
      calculationMethodIds: [
        "SYNTHETIC_CALCULATION_METHOD",
        PRESCRIPTION_METHOD_STRUCTURE_ID,
        PRESCRIPTION_PROTEIN_WEIGHT_BASIS_ID,
        PRESCRIPTION_ROUNDING_ORDER_ID,
        PRESCRIPTION_MACRO_COMPOSITION_ID,
        METHOD_TEMPLATE_SELECTION_ID,
        METHOD_DOSE_BEGINNER_ID,
      ],
      adjustmentRuleIds: [
        "SYNTHETIC_ADJUSTMENT_RULE",
        PRESCRIPTION_GOAL_ADJUSTMENT_RULE_ID,
        RULE_BOUNDED_TRAINING_ID,
        WEEKLY_RELATIVE_STEP_RULE_ID,
        WEEKLY_DROP_SESSION_RULE_ID,
      ],
      cooldownRuleIds: ["SYNTHETIC_COOLDOWN_RULE", WEEKLY_COOLDOWN_RULE_ID],
      cumulativeLimitRuleIds: ["SYNTHETIC_CUMULATIVE_LIMIT_RULE", WEEKLY_CUMULATIVE_RULE_ID],
      contraindicationRuleIds: ["SYNTHETIC_CONTRAINDICATION_RULE"],
      evidenceRuleIds: ["SYNTHETIC_EVIDENCE_RULE", WEEKLY_EVIDENCE_RULE_ID],
      escalationTemplateIds: [
        "synthetic-pause-refer-template",
        EFFORT_STRENGTH_TEMPLATE_ID,
        EFFORT_CARDIO_TEMPLATE_ID,
      ],
      explanationTemplateIds: [
        "synthetic-pause-refer-template",
        "SYNTHETIC_EXPLANATION_TEMPLATE",
        EFFORT_STRENGTH_TEMPLATE_ID,
        EFFORT_CARDIO_TEMPLATE_ID,
      ],
      safetyControls: {
        schemaVersion: 1,
        screening: {
          instrumentId: "SYNTHETIC_SCREENING_INSTRUMENT_NOT_FOR_LIVE_USE",
          resultInputId: "SYNTHETIC_SCREEN_RESULT",
          ruleId: "SYNTHETIC_INTAKE_SCREEN_RULE",
          flaggedReasonCode: "SYNTHETIC_SCREEN_FLAGGED",
          unknownReasonCode: "SYNTHETIC_SCREEN_UNKNOWN",
          escalationTemplateId: "synthetic-pause-refer-template",
        },
        contraindications: [
          "AGE_ELIGIBILITY",
          "PREGNANCY_POSTPARTUM",
          "EATING_DISORDER_HISTORY_OR_CONCERN",
          "TYPE_1_DIABETES",
          "CARDIAC_CONDITION",
        ].map((inputId) => ({
          inputId,
          ruleId: "SYNTHETIC_CONTRAINDICATION_RULE",
          reasonCode: "SYNTHETIC_CONTRAINDICATION",
          escalationTemplateId: "synthetic-pause-refer-template",
        })) as {
          inputId:
            | "AGE_ELIGIBILITY"
            | "PREGNANCY_POSTPARTUM"
            | "EATING_DISORDER_HISTORY_OR_CONCERN"
            | "TYPE_1_DIABETES"
            | "CARDIAC_CONDITION";
          ruleId: string;
          reasonCode: string;
          escalationTemplateId: string;
        }[],
        nutritionLimits: {
          minimumDailyEnergyParameterId: "SYNTHETIC_MINIMUM_DAILY_ENERGY",
          maximumWeeklyLossRateParameterId: "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE",
          minimumDailyEnergyRuleId: "SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE",
          maximumWeeklyLossRateRuleId: "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE",
          noConsecutiveDeficitRuleId: "SYNTHETIC_NO_CONSECUTIVE_DEFICIT_RULE",
          minimumDailyEnergyReasonCode: "SYNTHETIC_MINIMUM_DAILY_ENERGY_LIMIT",
          maximumWeeklyLossRateReasonCode: "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_LIMIT",
          noConsecutiveDeficitReasonCode: "SYNTHETIC_CONSECUTIVE_DEFICIT_BLOCKED",
          missingRateInputReasonCode: "SYNTHETIC_RATE_INPUT_MISSING",
          unverifiableHistoryReasonCode: "SYNTHETIC_HISTORY_UNVERIFIABLE",
        },
      },
      numericParameters: [
        {
          id: "SYNTHETIC_NUMERIC_PARAMETER",
          value: 1,
          unit: "SYNTHETIC_UNIT",
          applicabilityRuleIds: ["SYNTHETIC_RULE"],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        },
        {
          // Deliberately synthetic test value. It is not approved guidance.
          id: "SYNTHETIC_MINIMUM_DAILY_ENERGY",
          value: 1234,
          unit: "KCAL_PER_DAY",
          applicabilityRuleIds: ["SYNTHETIC_MINIMUM_DAILY_ENERGY_RULE"],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        },
        {
          // Deliberately synthetic test value. It is not approved guidance.
          id: "SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE",
          value: 9.99,
          unit: "PERCENT_BODY_WEIGHT_PER_WEEK",
          applicabilityRuleIds: ["SYNTHETIC_MAXIMUM_WEEKLY_LOSS_RATE_RULE"],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        },
        // Deliberately synthetic test value. It is not approved guidance.
        ...PRESCRIPTION_PARAMETER_SPECS.map((spec) => ({
          id: spec.id,
          value: syntheticPrescriptionParameterValue(spec.id),
          unit: spec.unit,
          applicabilityRuleIds: [spec.groupRuleId],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        })),
        // Deliberately synthetic test value. It is not approved guidance.
        ...TRAINING_COMPOSER_PARAMETER_SPECS.map((spec) => ({
          id: spec.id,
          value: syntheticTrainingParameterValue(spec.id),
          unit: spec.unit,
          applicabilityRuleIds: [spec.ruleId],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        })),
        // Deliberately synthetic test value. It is not approved guidance.
        ...SYNTHETIC_PROGRESSION_PARAMETER_SPECS.map((spec) => ({
          id: spec.id,
          value: syntheticTrainingParameterValue(spec.id),
          unit: spec.unit,
          applicabilityRuleIds: WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS.includes(spec.id)
            ? [RULE_BOUNDED_TRAINING_ID, WEEKLY_COOLDOWN_RULE_ID]
            : [RULE_BOUNDED_TRAINING_ID],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        })),
        // Deliberately synthetic test value. It is not approved guidance.
        ...WEEKLY_PARAMETER_SPECS.map((spec) => ({
          id: spec.id,
          value: syntheticWeeklyParameterValue(spec.id),
          unit: spec.unit,
          applicabilityRuleIds: [
            spec.id.startsWith("WEEKLY.ADJUSTMENT.")
              ? WEEKLY_RELATIVE_STEP_RULE_ID
              : spec.id.startsWith("WEEKLY.SIMPLIFY.")
                ? WEEKLY_DROP_SESSION_RULE_ID
                : spec.ruleId,
          ],
          evidenceClaimIds: ["synthetic-evidence-claim"],
        })),
      ],
      unknownAnswerBehavior: "FAIL_CLOSED",
      outOfScopeOutcome: "PAUSE_REFER",
    },
    dependencies,
    policyVersion
  );

  return {
    policyKey,
    foodCatalog,
    exerciseCatalog,
    evidenceRegistry,
    escalationTemplates,
    policyBundle,
  };
}
