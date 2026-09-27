import type { PlanPayload } from "@/lib/ai-coach/plan-contract";

export const TRAINING_INTAKE_VERSION = 1 + 1;
export type TrainingIntakeVersion = typeof TRAINING_INTAKE_VERSION;

export type TrainingCatalogExercise = {
  id: string;
  name: string;
  modality: "STRENGTH" | "CARDIO";
  equipmentIds: readonly ("NONE" | "HOME_BASIC" | "FULL_GYM")[];
  substitutionIds: readonly string[];
  contraindicationRuleIds: readonly string[];
  beginnerConstraintIds: readonly string[];
  equipmentAlternatives: readonly {
    equipmentId: "NONE" | "HOME_BASIC" | "FULL_GYM";
    exerciseId: string;
  }[];
};

export type TrainingCatalogTemplate = {
  id: string;
  templateKind: "FULL_BODY" | "UPPER" | "LOWER" | "CARDIO";
  sequence: number;
  exerciseIds: readonly string[];
  beginnerConstraintIds: readonly string[];
};

export type TrainingCatalogSource = {
  catalogVersion: string;
  exercises: ReadonlyMap<string, TrainingCatalogExercise>;
  templates: readonly TrainingCatalogTemplate[];
};

export type SessionLengthBand =
  | "UNDER_30"
  | "MIN_30_45"
  | "MIN_45_60"
  | "MIN_60_90"
  | "OVER_90";

export type ExperienceLevel = "NEW" | "RETURNING" | "EXPERIENCED";

export type TrainingEquipmentAccess = "NONE" | "HOME_BASIC" | "FULL_GYM";

export type ComposeTrainingInput = {
  intakeVersion: TrainingIntakeVersion;
  trainingDaysPerWeek: number;
  equipmentAccess: readonly TrainingEquipmentAccess[];
  experienceLevel: ExperienceLevel;
  sessionLengthBand: SessionLengthBand | null;
  trainingContextStatus: "CONFIRMED" | "DECLINED" | "UNKNOWN" | null;
  energyReducedRelativeToMaintenance: boolean | null;
  activeContraindicationRuleIds: readonly string[];
};

export type TrainingReasonCode =
  | "TRAINING_INTAKE_VERSION_UNSUPPORTED"
  | "TRAINING_INPUT_MISSING"
  | "TRAINING_PARAMETER_MISSING"
  | "TRAINING_PARAMETER_INCOMPATIBLE"
  | "TRAINING_METHOD_UNSUPPORTED"
  | "TRAINING_CATALOG_EMPTY_FOR_EQUIPMENT"
  | "TRAINING_TEMPLATE_UNAVAILABLE"
  | "TRAINING_EXERCISE_COUNT_INFEASIBLE"
  | "TRAINING_CONTRAINDICATED_NO_SUBSTITUTE"
  | "TRAINING_WORKLOAD_CAPPED"
  | "TRAINING_WORKLOAD_INFEASIBLE"
  | "TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE";

export type ComposeTrainingResult =
  | {
      status: "COMPOSED";
      strength: PlanPayload["strength"];
      cardio: PlanPayload["cardio"];
      appliedCapIds: string[];
      reasonCodes: TrainingReasonCode[];
    }
  | {
      status: "UNAVAILABLE";
      strength: [];
      cardio: [];
      appliedCapIds: [];
      reasonCodes: TrainingReasonCode[];
      missingInputs?: string[];
    };

export type ResolvedTrainingParameters = {
  exerciseCountMaxByBand: Record<SessionLengthBand, number>;
  exerciseCountMin: number;
  plannedMinutesByBand: Record<SessionLengthBand, number>;
  setsPerExerciseByExperience: Record<ExperienceLevel, number>;
  repsPerSetByExperience: Record<ExperienceLevel, number>;
  restSecondsByExperience: Record<ExperienceLevel, number>;
  maxStrengthSessionsByExperience: Record<ExperienceLevel, number>;
  cardioSessionMinutesByExperience: Record<ExperienceLevel, number>;
  cardioSessionsPerWeekByExperience: Record<ExperienceLevel, number>;
  cardioMaxSessionMinutes: number;
  workloadTotalSessionsMax: number;
  workloadTrainingMinutesMax: number;
  workloadTrainingMinutesMaxWhenEnergyReduced: number;
  workloadConsecutiveTrainingDaysMax: number;
  parameterSetDigest: string;
};
