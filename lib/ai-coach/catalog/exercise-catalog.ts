import { DRAFT_EXERCISE_CATALOG_VERSION } from "../artifacts/drafts/exercise-catalog";
import draftExerciseCatalogFile from "../artifacts/drafts/exercise-catalog.draft-unsigned.v1.json";
import { equipmentSchema, exerciseItemSchema, type Equipment, type ExerciseItem } from "./schema";

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

/**
 * T-2038 — the draft beginner catalog, served under its own version key.
 *
 * `EXERCISE_CATALOG_VERSION`, `RAW_EXERCISE_CATALOG` and `EXERCISE_CATALOG`
 * above are deliberately untouched: `runSnapshotSchema` pins
 * `z.literal(EXERCISE_CATALOG_VERSION)`, so bumping it would make every stored
 * `AiCoachRun.inputSnapshot` unparseable. The draft is a second map behind a
 * second version string (`loader.ts` routes on it, exactly as `getFoodItem`
 * routes `food-fixture-v1`), and nothing in the product stamps that string into
 * a payload today.
 *
 * This is a **projection** of `artifacts/drafts/exercise-catalog.draft-unsigned.v1.json`,
 * not a second hand-maintained list. Adding or correcting a movement means
 * editing that one file.
 */
const ARTIFACT_EQUIPMENT_TIERS: Readonly<Record<string, Equipment>> = {
  EQUIPMENT_NONE: "NONE",
  EQUIPMENT_HOME_BASIC: "HOME_BASIC",
  EQUIPMENT_FULL_GYM: "FULL_GYM",
};

function projectEquipmentTier(equipmentId: string, exerciseId: string): Equipment {
  const tier = ARTIFACT_EQUIPMENT_TIERS[equipmentId];
  if (tier === undefined) {
    // Fail at module load rather than silently dropping the tier (or the whole
    // exercise), which would give the composer a catalog that quietly differs
    // from the reviewed file.
    throw new Error(
      `Draft exercise catalog: exercise ${exerciseId} declares unmappable equipmentId ${equipmentId}.`
    );
  }
  return equipmentSchema.parse(tier);
}

if (draftExerciseCatalogFile.content.artifactKey !== DRAFT_EXERCISE_CATALOG_VERSION) {
  throw new Error(
    `Draft exercise catalog artifactKey ${draftExerciseCatalogFile.content.artifactKey} does not match DRAFT_EXERCISE_CATALOG_VERSION ${DRAFT_EXERCISE_CATALOG_VERSION}.`
  );
}

export const DRAFT_EXERCISE_CATALOG: ReadonlyMap<string, ExerciseItem> = new Map(
  draftExerciseCatalogFile.content.exercises.map((exercise) => {
    const item = exerciseItemSchema.parse({
      id: exercise.id,
      catalogVersion: DRAFT_EXERCISE_CATALOG_VERSION,
      name: exercise.name,
      modality: exercise.modality,
      requiredEquipment: exercise.equipmentIds.map((equipmentId) =>
        projectEquipmentTier(equipmentId, exercise.id)
      ),
      substitutionIds: exercise.substitutionIds,
    });
    return [item.id, item];
  })
);
