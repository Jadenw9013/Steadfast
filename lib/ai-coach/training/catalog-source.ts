import type { z } from "zod";
import { exerciseCatalogContentSchema } from "@/lib/ai-coach/artifacts/schema";
import { loadDraftUnsignedExerciseCatalog } from "@/lib/ai-coach/artifacts/drafts/exercise-catalog";
import type {
  TrainingCatalogExercise,
  TrainingCatalogSource,
  TrainingCatalogTemplate,
  TrainingEquipmentAccess,
} from "./types";

export type ExerciseCatalogContent = z.infer<typeof exerciseCatalogContentSchema>;

const ARTIFACT_EQUIPMENT_TIERS: Readonly<Record<string, TrainingEquipmentAccess>> = {
  EQUIPMENT_NONE: "NONE",
  EQUIPMENT_HOME_BASIC: "HOME_BASIC",
  EQUIPMENT_FULL_GYM: "FULL_GYM",
};

function projectEquipmentTier(equipmentId: string): TrainingEquipmentAccess {
  const tier = ARTIFACT_EQUIPMENT_TIERS[equipmentId];
  if (!tier) {
    throw new Error("UNKNOWN_EQUIPMENT_TIER");
  }
  return tier;
}

export function trainingCatalogSourceFromArtifactContent(
  content: ExerciseCatalogContent
): TrainingCatalogSource {
  const exerciseEntries: [string, TrainingCatalogExercise][] = content.exercises.map((ex) => [
    ex.id,
    {
      id: ex.id,
      name: ex.name,
      modality: ex.modality,
      equipmentIds: ex.equipmentIds.map(projectEquipmentTier),
      substitutionIds: ex.substitutionIds ?? [],
      contraindicationRuleIds: ex.contraindicationRuleIds ?? [],
      beginnerConstraintIds: ex.beginnerConstraintIds ?? [],
      equipmentAlternatives: (ex.equipmentAlternatives ?? []).map((alt) => ({
        equipmentId: projectEquipmentTier(alt.equipmentId),
        exerciseId: alt.exerciseId,
      })),
    },
  ]);

  const templates: TrainingCatalogTemplate[] = content.templates.map((tpl) => ({
    id: tpl.id,
    templateKind: tpl.templateKind ?? "FULL_BODY",
    sequence: tpl.sequence ?? 1,
    exerciseIds: tpl.exerciseIds,
    beginnerConstraintIds: tpl.beginnerConstraintIds ?? [],
  }));

  return {
    catalogVersion: content.artifactKey,
    exercises: new Map(exerciseEntries),
    templates,
  };
}

export function trainingCatalogSourceFromDraftFile(): TrainingCatalogSource {
  const file = loadDraftUnsignedExerciseCatalog();
  return trainingCatalogSourceFromArtifactContent(file.content);
}
