import { exerciseItemSchema, type ExerciseItem } from "./schema";

/**
 * A04 — SYNTHETIC FIXTURE exercise catalog. See schema.ts's module
 * docstring: engineering shape, not reviewed content (gate G02).
 */
export const EXERCISE_CATALOG_VERSION = "exercise-fixture-v1";

const RAW_EXERCISE_CATALOG: ExerciseItem[] = [
  {
    id: "goblet-squat", catalogVersion: EXERCISE_CATALOG_VERSION, name: "Goblet squat",
    modality: "STRENGTH", requiredEquipment: ["HOME_BASIC", "FULL_GYM"], substitutionIds: ["bodyweight-squat"],
  },
  {
    id: "bodyweight-squat", catalogVersion: EXERCISE_CATALOG_VERSION, name: "Bodyweight squat",
    modality: "STRENGTH", requiredEquipment: ["NONE", "HOME_BASIC", "FULL_GYM"], substitutionIds: [],
  },
  {
    id: "brisk-walk", catalogVersion: EXERCISE_CATALOG_VERSION, name: "Brisk walk",
    modality: "CARDIO", requiredEquipment: ["NONE", "HOME_BASIC", "FULL_GYM"], substitutionIds: [],
  },
];

export const EXERCISE_CATALOG: ReadonlyMap<string, ExerciseItem> = new Map(
  RAW_EXERCISE_CATALOG.map((raw) => {
    const item = exerciseItemSchema.parse(raw);
    return [item.id, item];
  })
);
