import { artifactContentDigest } from "./digest";
import type {
  ArtifactDraftInput,
  ArtifactKind,
  ArtifactReference,
  ArtifactReviewMetadata,
} from "./schema";

/**
 * T-1005 engineering fixtures only. Every fact, threshold, identity and review
 * record below is synthetic and is not fit for a real account or live coaching.
 */

export const SYNTHETIC_ARTIFACT_ENGINE_VERSION = "ai-coach-artifact-engine-v1";

function reviewMetadata(namespace: string): ArtifactReviewMetadata {
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
): ArtifactDraftInput {
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

function reference(value: ArtifactDraftInput): ArtifactReference {
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
      ],
      calculationMethodIds: ["SYNTHETIC_CALCULATION_METHOD"],
      adjustmentRuleIds: ["SYNTHETIC_ADJUSTMENT_RULE"],
      cooldownRuleIds: ["SYNTHETIC_COOLDOWN_RULE"],
      cumulativeLimitRuleIds: ["SYNTHETIC_CUMULATIVE_LIMIT_RULE"],
      contraindicationRuleIds: ["SYNTHETIC_CONTRAINDICATION_RULE"],
      evidenceRuleIds: ["SYNTHETIC_EVIDENCE_RULE"],
      escalationTemplateIds: ["synthetic-pause-refer-template"],
      explanationTemplateIds: ["SYNTHETIC_EXPLANATION_TEMPLATE"],
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
