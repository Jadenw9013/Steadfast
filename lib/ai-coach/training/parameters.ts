import { contentHash } from "@/lib/ai-coach/canonical-json";
import type { PolicyBundleContent } from "@/lib/ai-coach/artifacts/schema";
import type {
  ExperienceLevel,
  ResolvedTrainingParameters,
  SessionLengthBand,
  TrainingReasonCode,
} from "./types";

export const EFFORT_STRENGTH_TEMPLATE_ID = "TRAINING.EFFORT.STRENGTH.V1";
export const EFFORT_CARDIO_TEMPLATE_ID = "TRAINING.EFFORT.CARDIO.V1";

export const METHOD_TEMPLATE_SELECTION_ID = "TRAINING.TEMPLATE.SELECTION.V1";
export const METHOD_DOSE_BEGINNER_ID = "TRAINING.DOSE.BEGINNER.V1";
export const RULE_SESSION_STRUCTURE_ID = "TRAINING.RULE.SESSION_STRUCTURE.V1";
export const RULE_CARDIO_DOSE_ID = "CARDIO.RULE.DOSE.BEGINNER.V1";
export const RULE_WORKLOAD_COMBINED_ID = "WORKLOAD.RULE.COMBINED.V1";
export const RULE_BOUNDED_TRAINING_ID = "PROGRESSION.RULE.BOUNDED_TRAINING.V1";

export const TRAINING_PROGRESSION_PARAMETER_IDS = [
  "PROGRESSION.STRENGTH.REPS.INCREMENT",
  "PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL",
  "PROGRESSION.STRENGTH.SETS.INCREMENT",
  "PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL",
  "PROGRESSION.STRENGTH.LOAD.INCREMENT_FRACTION",
  "PROGRESSION.STRENGTH.LOAD.MAX_INCREASE_FRACTION_PER_WINDOW",
  "PROGRESSION.CARDIO.MINUTES.INCREMENT",
  "PROGRESSION.CARDIO.MINUTES.MAX_ABOVE_INITIAL",
  "PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS",
  "PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION",
  "PROGRESSION.EVIDENCE.MAX_EFFORT_RATING",
  "PROGRESSION.WINDOW.MIN_DAYS_BETWEEN_INCREASES",
] as const;

type ParameterSpec = {
  id: string;
  unit: string;
  ruleId: string;
};

const BANDS: readonly SessionLengthBand[] = [
  "UNDER_30",
  "MIN_30_45",
  "MIN_45_60",
  "MIN_60_90",
  "OVER_90",
];

const EXPERIENCES: readonly ExperienceLevel[] = ["NEW", "RETURNING", "EXPERIENCED"];

export const TRAINING_COMPOSER_PARAMETER_SPECS: readonly ParameterSpec[] = [
  ...BANDS.map((band) => ({
    id: `TRAINING.SESSION.EXERCISE_COUNT.${band}.MAX`,
    unit: "EXERCISES_PER_SESSION",
    ruleId: RULE_SESSION_STRUCTURE_ID,
  })),
  {
    id: "TRAINING.SESSION.EXERCISE_COUNT.MIN",
    unit: "EXERCISES_PER_SESSION",
    ruleId: RULE_SESSION_STRUCTURE_ID,
  },
  ...BANDS.map((band) => ({
    id: `TRAINING.SESSION.PLANNED_MINUTES.${band}`,
    unit: "MINUTES_PER_SESSION",
    ruleId: RULE_SESSION_STRUCTURE_ID,
  })),
  ...EXPERIENCES.map((exp) => ({
    id: `TRAINING.DOSE.${exp}.SETS_PER_EXERCISE`,
    unit: "SETS",
    ruleId: METHOD_DOSE_BEGINNER_ID,
  })),
  ...EXPERIENCES.map((exp) => ({
    id: `TRAINING.DOSE.${exp}.REPS_PER_SET`,
    unit: "REPETITIONS",
    ruleId: METHOD_DOSE_BEGINNER_ID,
  })),
  ...EXPERIENCES.map((exp) => ({
    id: `TRAINING.DOSE.${exp}.REST_SECONDS`,
    unit: "SECONDS",
    ruleId: METHOD_DOSE_BEGINNER_ID,
  })),
  ...EXPERIENCES.map((exp) => ({
    id: `TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.${exp}`,
    unit: "SESSIONS_PER_WEEK",
    ruleId: METHOD_TEMPLATE_SELECTION_ID,
  })),
  ...EXPERIENCES.map((exp) => ({
    id: `CARDIO.DOSE.${exp}.SESSION_MINUTES`,
    unit: "MINUTES_PER_SESSION",
    ruleId: RULE_CARDIO_DOSE_ID,
  })),
  ...EXPERIENCES.map((exp) => ({
    id: `CARDIO.DOSE.${exp}.SESSIONS_PER_WEEK`,
    unit: "SESSIONS_PER_WEEK",
    ruleId: RULE_CARDIO_DOSE_ID,
  })),
  {
    id: "CARDIO.DOSE.MAX_SESSION_MINUTES",
    unit: "MINUTES_PER_SESSION",
    ruleId: RULE_CARDIO_DOSE_ID,
  },
  {
    id: "WORKLOAD.WEEKLY.TOTAL_SESSIONS.MAX",
    unit: "SESSIONS_PER_WEEK",
    ruleId: RULE_WORKLOAD_COMBINED_ID,
  },
  {
    id: "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX",
    unit: "MINUTES_PER_WEEK",
    ruleId: RULE_WORKLOAD_COMBINED_ID,
  },
  {
    id: "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED",
    unit: "MINUTES_PER_WEEK",
    ruleId: RULE_WORKLOAD_COMBINED_ID,
  },
  {
    id: "WORKLOAD.WEEKLY.CONSECUTIVE_TRAINING_DAYS.MAX",
    unit: "DAYS",
    ruleId: RULE_WORKLOAD_COMBINED_ID,
  },
];

export const TRAINING_COMPOSER_PARAMETER_IDS = TRAINING_COMPOSER_PARAMETER_SPECS.map(
  (spec) => spec.id
);

const EFFORT_TEXT_MAX_LENGTH = (7 + 1) * (1 + 1 + 1 + 1 + 1) * (1 + 1 + 1 + 1 + 1);

export type ResolveTrainingParametersResult =
  | {
      ok: true;
      parameters: ResolvedTrainingParameters;
      effortText: { strength: string; cardio: string };
    }
  | {
      ok: false;
      reasonCodes: TrainingReasonCode[];
      missingParameterIds: string[];
    };

export function resolveTrainingParameters(
  policy: PolicyBundleContent,
  explanationTexts: readonly { id: string; text: string }[]
): ResolveTrainingParametersResult {
  const methodSupported =
    policy.calculationMethodIds.includes(METHOD_TEMPLATE_SELECTION_ID) &&
    policy.calculationMethodIds.includes(METHOD_DOSE_BEGINNER_ID) &&
    policy.ruleIds.includes(RULE_SESSION_STRUCTURE_ID) &&
    policy.ruleIds.includes(RULE_CARDIO_DOSE_ID) &&
    policy.ruleIds.includes(RULE_WORKLOAD_COMBINED_ID) &&
    policy.ruleIds.includes(RULE_BOUNDED_TRAINING_ID) &&
    policy.adjustmentRuleIds.includes(RULE_BOUNDED_TRAINING_ID);

  if (!methodSupported) {
    return {
      ok: false,
      reasonCodes: ["TRAINING_METHOD_UNSUPPORTED"],
      missingParameterIds: [],
    };
  }

  const trainingEffortTemplateIds = policy.trainingEffortTemplateIds ?? [];
  const strengthEffortDeclared = trainingEffortTemplateIds.includes(EFFORT_STRENGTH_TEMPLATE_ID);
  const cardioEffortDeclared = trainingEffortTemplateIds.includes(EFFORT_CARDIO_TEMPLATE_ID);
  const strengthEffort = explanationTexts.find((item) => item.id === EFFORT_STRENGTH_TEMPLATE_ID);
  const cardioEffort = explanationTexts.find((item) => item.id === EFFORT_CARDIO_TEMPLATE_ID);

  const effortValid =
    strengthEffortDeclared &&
    cardioEffortDeclared &&
    Boolean(strengthEffort?.text) &&
    Boolean(cardioEffort?.text) &&
    (strengthEffort?.text.length ?? 0) <= EFFORT_TEXT_MAX_LENGTH &&
    (cardioEffort?.text.length ?? 0) <= EFFORT_TEXT_MAX_LENGTH;

  if (!effortValid) {
    return {
      ok: false,
      reasonCodes: ["TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE"],
      missingParameterIds: [],
    };
  }

  const byId = new Map(policy.numericParameters.map((param) => [param.id, param]));
  const missingIds: string[] = [];
  const incompatibleIds: string[] = [];

  for (const spec of TRAINING_COMPOSER_PARAMETER_SPECS) {
    const found = byId.get(spec.id);
    if (!found) {
      missingIds.push(spec.id);
      continue;
    }
    const compatible =
      found.unit === spec.unit &&
      Number.isFinite(found.value) &&
      found.applicabilityRuleIds.includes(spec.ruleId);
    if (!compatible) {
      incompatibleIds.push(spec.id);
    }
  }

  if (missingIds.length > 0 || incompatibleIds.length > 0) {
    const reasonCodes: TrainingReasonCode[] = [];
    if (missingIds.length > 0) reasonCodes.push("TRAINING_PARAMETER_MISSING");
    if (incompatibleIds.length > 0) reasonCodes.push("TRAINING_PARAMETER_INCOMPATIBLE");
    const missingParameterIds = Array.from(new Set([...missingIds, ...incompatibleIds])).sort();
    return {
      ok: false,
      reasonCodes,
      missingParameterIds,
    };
  }

  const value = (id: string): number => {
    const found = byId.get(id);
    return found ? found.value : 0;
  };

  const exerciseCountMaxByBand = {} as Record<SessionLengthBand, number>;
  const plannedMinutesByBand = {} as Record<SessionLengthBand, number>;
  for (const band of BANDS) {
    exerciseCountMaxByBand[band] = value(`TRAINING.SESSION.EXERCISE_COUNT.${band}.MAX`);
    plannedMinutesByBand[band] = value(`TRAINING.SESSION.PLANNED_MINUTES.${band}`);
  }

  const setsPerExerciseByExperience = {} as Record<ExperienceLevel, number>;
  const repsPerSetByExperience = {} as Record<ExperienceLevel, number>;
  const restSecondsByExperience = {} as Record<ExperienceLevel, number>;
  const maxStrengthSessionsByExperience = {} as Record<ExperienceLevel, number>;
  const cardioSessionMinutesByExperience = {} as Record<ExperienceLevel, number>;
  const cardioSessionsPerWeekByExperience = {} as Record<ExperienceLevel, number>;

  for (const exp of EXPERIENCES) {
    setsPerExerciseByExperience[exp] = value(`TRAINING.DOSE.${exp}.SETS_PER_EXERCISE`);
    repsPerSetByExperience[exp] = value(`TRAINING.DOSE.${exp}.REPS_PER_SET`);
    restSecondsByExperience[exp] = value(`TRAINING.DOSE.${exp}.REST_SECONDS`);
    maxStrengthSessionsByExperience[exp] = value(
      `TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.${exp}`
    );
    cardioSessionMinutesByExperience[exp] = value(`CARDIO.DOSE.${exp}.SESSION_MINUTES`);
    cardioSessionsPerWeekByExperience[exp] = value(`CARDIO.DOSE.${exp}.SESSIONS_PER_WEEK`);
  }

  const rawValues: Record<string, number> = {};
  for (const spec of TRAINING_COMPOSER_PARAMETER_SPECS) {
    rawValues[spec.id] = value(spec.id);
  }

  const parameterSetDigest = contentHash({
    rawValues,
    strengthEffort: strengthEffort?.text ?? "",
    cardioEffort: cardioEffort?.text ?? "",
  });

  const parameters: ResolvedTrainingParameters = {
    exerciseCountMaxByBand,
    exerciseCountMin: value("TRAINING.SESSION.EXERCISE_COUNT.MIN"),
    plannedMinutesByBand,
    setsPerExerciseByExperience,
    repsPerSetByExperience,
    restSecondsByExperience,
    maxStrengthSessionsByExperience,
    cardioSessionMinutesByExperience,
    cardioSessionsPerWeekByExperience,
    cardioMaxSessionMinutes: value("CARDIO.DOSE.MAX_SESSION_MINUTES"),
    workloadTotalSessionsMax: value("WORKLOAD.WEEKLY.TOTAL_SESSIONS.MAX"),
    workloadTrainingMinutesMax: value("WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX"),
    workloadTrainingMinutesMaxWhenEnergyReduced: value(
      "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED"
    ),
    workloadConsecutiveTrainingDaysMax: value("WORKLOAD.WEEKLY.CONSECUTIVE_TRAINING_DAYS.MAX"),
    parameterSetDigest,
  };

  return {
    ok: true,
    parameters,
    effortText: {
      strength: strengthEffort?.text ?? "",
      cardio: cardioEffort?.text ?? "",
    },
  };
}
