import type { PlanPayload } from "@/lib/ai-coach/plan-contract";
import type {
  ComposeTrainingInput,
  ComposeTrainingResult,
  ResolvedTrainingParameters,
  TrainingCatalogExercise,
  TrainingCatalogSource,
  TrainingCatalogTemplate,
  TrainingEquipmentAccess,
  TrainingReasonCode,
} from "./types";

export function daySpread(i: number, days: number): number {
  return Math.floor((i * 7) / days) + 1;
}

const SEQ_1 = 1;
const SEQ_2 = 1 + 1;
const SEQ_3 = 1 + 1 + 1;

const EFFORT_TEXT_MAX_LENGTH = (7 + 1) * (1 + 1 + 1 + 1 + 1) * (1 + 1 + 1 + 1 + 1);

function isEquipmentEligible(
  ex: TrainingCatalogExercise,
  equipmentAccess: readonly TrainingEquipmentAccess[]
): boolean {
  return ex.equipmentIds.some((eq) => equipmentAccess.includes(eq));
}

function isContraindicated(
  ex: TrainingCatalogExercise,
  activeContraindications: readonly string[]
): boolean {
  if (activeContraindications.length === 0) return false;
  return ex.contraindicationRuleIds.some((ruleId) => activeContraindications.includes(ruleId));
}

function resolveEligibleExercise(
  originalEx: TrainingCatalogExercise,
  catalog: TrainingCatalogSource,
  equipmentAccess: readonly TrainingEquipmentAccess[],
  activeContraindications: readonly string[]
): { ex: TrainingCatalogExercise | null; contraFailClosed: boolean } {
  let equipmentEx: TrainingCatalogExercise | null = null;

  if (isEquipmentEligible(originalEx, equipmentAccess)) {
    equipmentEx = originalEx;
  } else {
    for (const alt of originalEx.equipmentAlternatives) {
      if (equipmentAccess.includes(alt.equipmentId)) {
        const targetEx = catalog.exercises.get(alt.exerciseId);
        if (targetEx && isEquipmentEligible(targetEx, equipmentAccess)) {
          equipmentEx = targetEx;
          break;
        }
      }
    }
    if (!equipmentEx) {
      for (const subId of originalEx.substitutionIds) {
        const subEx = catalog.exercises.get(subId);
        if (subEx && isEquipmentEligible(subEx, equipmentAccess)) {
          equipmentEx = subEx;
          break;
        }
      }
    }
  }

  if (!equipmentEx) {
    return { ex: null, contraFailClosed: false };
  }

  if (isContraindicated(equipmentEx, activeContraindications)) {
    let contraSub: TrainingCatalogExercise | null = null;
    for (const alt of equipmentEx.equipmentAlternatives) {
      if (equipmentAccess.includes(alt.equipmentId)) {
        const targetEx = catalog.exercises.get(alt.exerciseId);
        if (
          targetEx &&
          isEquipmentEligible(targetEx, equipmentAccess) &&
          !isContraindicated(targetEx, activeContraindications)
        ) {
          contraSub = targetEx;
          break;
        }
      }
    }
    if (!contraSub) {
      for (const subId of equipmentEx.substitutionIds) {
        const subEx = catalog.exercises.get(subId);
        if (
          subEx &&
          isEquipmentEligible(subEx, equipmentAccess) &&
          !isContraindicated(subEx, activeContraindications)
        ) {
          contraSub = subEx;
          break;
        }
      }
    }
    if (!contraSub) {
      return { ex: null, contraFailClosed: true };
    }
    equipmentEx = contraSub;
  }

  return { ex: equipmentEx, contraFailClosed: false };
}

function maxConsecutiveDays(days: readonly number[]): number {
  const set = new Set(days);
  let max = 0;
  let curr = 0;
  for (let d = 1; d <= 7; d++) {
    if (set.has(d)) {
      curr++;
      if (curr > max) max = curr;
    } else {
      curr = 0;
    }
  }
  return max;
}

export function composeTraining(
  parameters: ResolvedTrainingParameters,
  catalog: TrainingCatalogSource,
  effortText: { strength: string; cardio: string },
  input: ComposeTrainingInput
): ComposeTrainingResult {
  // Step 1: Intake version check
  if (input.intakeVersion !== 1 + 1) {
    return {
      status: "UNAVAILABLE",
      strength: [],
      cardio: [],
      appliedCapIds: [],
      reasonCodes: ["TRAINING_INTAKE_VERSION_UNSUPPORTED"],
    };
  }

  // Step 2: Missing inputs check
  if (input.trainingContextStatus !== "CONFIRMED" || input.sessionLengthBand === null) {
    const missingInputs: string[] = [];
    if (input.trainingContextStatus !== "CONFIRMED") missingInputs.push("trainingContextStatus");
    if (input.sessionLengthBand === null) missingInputs.push("sessionLengthBand");
    missingInputs.sort();
    return {
      status: "UNAVAILABLE",
      strength: [],
      cardio: [],
      appliedCapIds: [],
      reasonCodes: ["TRAINING_INPUT_MISSING"],
      missingInputs,
    };
  }

  // Step 3: Parameters & effort copy check
  if (!parameters) {
    return {
      status: "UNAVAILABLE",
      strength: [],
      cardio: [],
      appliedCapIds: [],
      reasonCodes: ["TRAINING_PARAMETER_MISSING"],
    };
  }

  if (
    !effortText ||
    !effortText.strength ||
    !effortText.cardio ||
    effortText.strength.length > EFFORT_TEXT_MAX_LENGTH ||
    effortText.cardio.length > EFFORT_TEXT_MAX_LENGTH
  ) {
    return {
      status: "UNAVAILABLE",
      strength: [],
      cardio: [],
      appliedCapIds: [],
      reasonCodes: ["TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE"],
    };
  }

  const appliedCapIds: string[] = [];
  const reasonCodes: TrainingReasonCode[] = [];

  // Step 4: Strength days cap
  const maxStrengthSessions = parameters.maxStrengthSessionsByExperience[input.experienceLevel];
  let strengthDays = input.trainingDaysPerWeek;
  if (strengthDays > maxStrengthSessions) {
    strengthDays = maxStrengthSessions;
    appliedCapIds.push(
      `TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.${input.experienceLevel}`
    );
    reasonCodes.push("TRAINING_WORKLOAD_CAPPED");
  }

  // Step 5: Template set selection
  type TemplateRequirement = {
    kind: "FULL_BODY" | "UPPER" | "LOWER" | "CARDIO";
    seq: number;
  };
  let requirements: readonly TemplateRequirement[];

  if (strengthDays <= SEQ_1) {
    requirements = [{ kind: "FULL_BODY", seq: SEQ_1 }];
  } else if (strengthDays === SEQ_2) {
    requirements = [
      { kind: "FULL_BODY", seq: SEQ_1 },
      { kind: "FULL_BODY", seq: SEQ_2 },
    ];
  } else if (strengthDays === SEQ_3) {
    requirements = [
      { kind: "FULL_BODY", seq: SEQ_1 },
      { kind: "FULL_BODY", seq: SEQ_2 },
      { kind: "FULL_BODY", seq: SEQ_3 },
    ];
  } else {
    requirements = [
      { kind: "UPPER", seq: SEQ_1 },
      { kind: "LOWER", seq: SEQ_1 },
      { kind: "UPPER", seq: SEQ_2 },
      { kind: "LOWER", seq: SEQ_2 },
    ];
  }

  const selectedTemplates: TrainingCatalogTemplate[] = [];
  for (const req of requirements) {
    const matched = catalog.templates.find(
      (tpl) => tpl.templateKind === req.kind && tpl.sequence === req.seq
    );
    if (!matched) {
      return {
        status: "UNAVAILABLE",
        strength: [],
        cardio: [],
        appliedCapIds: [],
        reasonCodes: ["TRAINING_TEMPLATE_UNAVAILABLE"],
      };
    }
    selectedTemplates.push(matched);
  }

  // Steps 6 - 9: Exercise selection per template
  const sessionExerciseLists: TrainingCatalogExercise[][] = [];

  for (const tpl of selectedTemplates) {
    const templateEligible: TrainingCatalogExercise[] = [];
    for (const exId of tpl.exerciseIds) {
      const original = catalog.exercises.get(exId);
      if (!original) {
        return {
          status: "UNAVAILABLE",
          strength: [],
          cardio: [],
          appliedCapIds: [],
          reasonCodes: ["TRAINING_TEMPLATE_UNAVAILABLE"],
        };
      }
      const { ex, contraFailClosed } = resolveEligibleExercise(
        original,
        catalog,
        input.equipmentAccess,
        input.activeContraindicationRuleIds
      );
      if (contraFailClosed) {
        return {
          status: "UNAVAILABLE",
          strength: [],
          cardio: [],
          appliedCapIds: [],
          reasonCodes: ["TRAINING_CONTRAINDICATED_NO_SUBSTITUTE"],
        };
      }
      if (ex) {
        templateEligible.push(ex);
      }
    }

    if (templateEligible.length === 0) {
      return {
        status: "UNAVAILABLE",
        strength: [],
        cardio: [],
        appliedCapIds: [],
        reasonCodes: ["TRAINING_CATALOG_EMPTY_FOR_EQUIPMENT"],
      };
    }

    // Step 9: No exerciseId appears twice in one strength session
    const uniqueTemplateEligible: TrainingCatalogExercise[] = [];
    const seenIds = new Set<string>();
    for (const ex of templateEligible) {
      if (!seenIds.has(ex.id)) {
        seenIds.add(ex.id);
        uniqueTemplateEligible.push(ex);
      }
    }

    // Step 8: Exercise count bounded by band
    const maxForBand = parameters.exerciseCountMaxByBand[input.sessionLengthBand];
    const exerciseCount = Math.min(uniqueTemplateEligible.length, maxForBand);

    if (exerciseCount < parameters.exerciseCountMin) {
      return {
        status: "UNAVAILABLE",
        strength: [],
        cardio: [],
        appliedCapIds: [],
        reasonCodes: ["TRAINING_EXERCISE_COUNT_INFEASIBLE"],
      };
    }

    sessionExerciseLists.push(uniqueTemplateEligible.slice(0, exerciseCount));
  }

  // Step 10: Dose
  const sets = parameters.setsPerExerciseByExperience[input.experienceLevel];
  const reps = parameters.repsPerSetByExperience[input.experienceLevel];
  const restSeconds = parameters.restSecondsByExperience[input.experienceLevel];
  const strengthEffort = effortText.strength;

  // Step 11: Cardio dose & modality
  const postTrimStrengthDays = selectedTemplates.length;
  const maxAvailableCardioDays = 7 - postTrimStrengthDays;
  const targetCardioSessions = Math.min(
    parameters.cardioSessionsPerWeekByExperience[input.experienceLevel],
    maxAvailableCardioDays
  );
  let cardioSessionsCount = targetCardioSessions > 0 ? targetCardioSessions : 0;

  const cardioDurationMinutes = Math.min(
    parameters.cardioSessionMinutesByExperience[input.experienceLevel],
    parameters.cardioMaxSessionMinutes
  );
  const cardioIntensity = effortText.cardio;

  let cardioExercise: TrainingCatalogExercise | null = null;
  if (cardioSessionsCount > 0) {
    for (const tpl of catalog.templates) {
      if (tpl.templateKind === "CARDIO") {
        for (const exId of tpl.exerciseIds) {
          const original = catalog.exercises.get(exId);
          if (!original) {
            return {
              status: "UNAVAILABLE",
              strength: [],
              cardio: [],
              appliedCapIds: [],
              reasonCodes: ["TRAINING_TEMPLATE_UNAVAILABLE"],
            };
          }
          const { ex, contraFailClosed } = resolveEligibleExercise(
            original,
            catalog,
            input.equipmentAccess,
            input.activeContraindicationRuleIds
          );
          if (contraFailClosed) {
            return {
              status: "UNAVAILABLE",
              strength: [],
              cardio: [],
              appliedCapIds: [],
              reasonCodes: ["TRAINING_CONTRAINDICATED_NO_SUBSTITUTE"],
            };
          }
          if (ex) {
            cardioExercise = ex;
            break;
          }
        }
        if (cardioExercise) break;
      }
    }
    if (!cardioExercise) {
      cardioSessionsCount = 0;
    }
  }

  // Step 12: Day placement & consecutive days check
  let strengthDaysList: number[] = [];
  for (let i = 0; i < selectedTemplates.length; i++) {
    strengthDaysList.push(daySpread(i, selectedTemplates.length));
  }

  const remainingWeekDays: number[] = [];
  for (let d = 1; d <= 7; d++) {
    if (!strengthDaysList.includes(d)) {
      remainingWeekDays.push(d);
    }
  }

  const cardioDaysList: number[] = remainingWeekDays.slice(0, cardioSessionsCount);

  while (
    cardioDaysList.length > 0 &&
    maxConsecutiveDays([...strengthDaysList, ...cardioDaysList]) >
      parameters.workloadConsecutiveTrainingDaysMax
  ) {
    cardioDaysList.pop();
  }

  // Step 13: Combined-workload check
  const plannedSessionMinutes = parameters.plannedMinutesByBand[input.sessionLengthBand];
  const minutesCap =
    input.energyReducedRelativeToMaintenance === false
      ? parameters.workloadTrainingMinutesMax
      : parameters.workloadTrainingMinutesMaxWhenEnergyReduced;
  const minutesCapId =
    input.energyReducedRelativeToMaintenance === false
      ? "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX"
      : "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED";
  const totalSessionsCap = parameters.workloadTotalSessionsMax;
  const totalSessionsCapId = "WORKLOAD.WEEKLY.TOTAL_SESSIONS.MAX";

  while (
    selectedTemplates.length * plannedSessionMinutes +
      cardioDaysList.length * cardioDurationMinutes >
      minutesCap ||
    selectedTemplates.length + cardioDaysList.length > totalSessionsCap
  ) {
    const capIdToApply =
      selectedTemplates.length * plannedSessionMinutes +
        cardioDaysList.length * cardioDurationMinutes >
      minutesCap
        ? minutesCapId
        : totalSessionsCapId;

    if (!appliedCapIds.includes(capIdToApply)) {
      appliedCapIds.push(capIdToApply);
    }
    if (!reasonCodes.includes("TRAINING_WORKLOAD_CAPPED")) {
      reasonCodes.push("TRAINING_WORKLOAD_CAPPED");
    }

    if (cardioDaysList.length > 0) {
      cardioDaysList.pop();
    } else if (selectedTemplates.length > 1) {
      selectedTemplates.pop();
      sessionExerciseLists.pop();
      strengthDaysList = [];
      for (let i = 0; i < selectedTemplates.length; i++) {
        strengthDaysList.push(daySpread(i, selectedTemplates.length));
      }
    } else {
      return {
        status: "UNAVAILABLE",
        strength: [],
        cardio: [],
        appliedCapIds: [],
        reasonCodes: ["TRAINING_WORKLOAD_INFEASIBLE"],
      };
    }
  }

  // Step 14: Build payload objects
  const strength: PlanPayload["strength"] = selectedTemplates.map((tpl, i) => ({
    sessionId: `strength-${strengthDaysList[i]}`,
    templateId: tpl.id,
    day: strengthDaysList[i],
    exercises: sessionExerciseLists[i].map((ex) => ({
      exerciseId: ex.id,
      catalogVersion: catalog.catalogVersion,
      sets,
      reps,
      restSeconds,
      effort: strengthEffort,
    })),
  }));

  const cardio: PlanPayload["cardio"] = cardioDaysList.map((day) => ({
    sessionId: `cardio-${day}`,
    exerciseId: cardioExercise ? cardioExercise.id : "",
    catalogVersion: catalog.catalogVersion,
    day,
    durationMinutes: cardioDurationMinutes,
    intensity: cardioIntensity,
  }));

  return {
    status: "COMPOSED",
    strength,
    cardio,
    appliedCapIds,
    reasonCodes,
  };
}
