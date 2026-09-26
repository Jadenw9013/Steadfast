import type { DraftExerciseCatalogFile } from "../artifacts/drafts/exercise-catalog";
import { DRAFT_EXERCISE_CATALOG_VERSION } from "./draft-catalog-version";
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
 * a payload today — `tests/unit/ai-coach-exercise-catalog-draft.test.ts` fails
 * if any module under `lib/`, `app/` or `components/` starts to.
 *
 * {@link projectDraftExerciseCatalog} is a **projection** of
 * `artifacts/drafts/exercise-catalog.draft-unsigned.v1.json`, not a second
 * hand-maintained list. Adding or correcting a movement means editing that one
 * file.
 *
 * **This module must never import the draft JSON, or any module that does.**
 * `catalog/loader.ts` imports this one, and two `"use client"` components
 * import `catalog/loader.ts`, so a static import here puts the whole 123 KB
 * draft — instructions and cues included — into a browser chunk. The first
 * version of this ticket did exactly that. The only link left is
 * `import type { DraftExerciseCatalogFile }`, which is erased at compile time.
 *
 * The draft therefore resolves only where a server-side module has deliberately
 * enabled it through `catalog/draft-exercise-catalog.ts`, which reaches the file
 * through the guarded `loadDraftUnsignedExerciseCatalog()`. Until then, and
 * always in production, `getExerciseItem(id, "exercise-beginner-v1")` reports
 * `UNKNOWN_ID`.
 */
const ARTIFACT_EQUIPMENT_TIERS: Readonly<Record<string, Equipment>> = {
  EQUIPMENT_NONE: "NONE",
  EQUIPMENT_HOME_BASIC: "HOME_BASIC",
  EQUIPMENT_FULL_GYM: "FULL_GYM",
};

function projectEquipmentTier(equipmentId: string, exerciseId: string): Equipment {
  const tier = ARTIFACT_EQUIPMENT_TIERS[equipmentId];
  if (tier === undefined) {
    // Fail loudly rather than silently dropping the tier (or the whole
    // exercise), which would give the composer a catalog that quietly differs
    // from the reviewed file.
    throw new Error(
      `Draft exercise catalog: exercise ${exerciseId} declares unmappable equipmentId ${equipmentId}.`
    );
  }
  return equipmentSchema.parse(tier);
}

/** Pure projection of the draft file into the in-code `ExerciseItem` shape. */
export function projectDraftExerciseCatalog(
  file: DraftExerciseCatalogFile
): ReadonlyMap<string, ExerciseItem> {
  if (file.content.artifactKey !== DRAFT_EXERCISE_CATALOG_VERSION) {
    throw new Error(
      `Draft exercise catalog artifactKey ${file.content.artifactKey} does not match DRAFT_EXERCISE_CATALOG_VERSION ${DRAFT_EXERCISE_CATALOG_VERSION}.`
    );
  }
  return new Map(
    file.content.exercises.map((exercise) => {
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
}

let registeredDraftCatalog: ReadonlyMap<string, ExerciseItem> | null = null;

/**
 * Makes the projected draft catalog resolvable through `getExerciseItem`.
 *
 * Only `catalog/draft-exercise-catalog.ts` calls this, and only after
 * `loadDraftUnsignedExerciseCatalog()` has allowed the read. Nothing under
 * `app/` or `components/` may reach either, which a unit test asserts.
 */
export function registerDraftExerciseCatalog(
  catalog: ReadonlyMap<string, ExerciseItem> | null
): void {
  registeredDraftCatalog = catalog;
}

/**
 * The projected draft catalog, or `null` when it is not available — which means
 * production (always), and any process that has not deliberately enabled it.
 *
 * Returning `null` rather than throwing is deliberate:
 * `planPayloadSchema.superRefine` resolves every exercise ID of every stored
 * payload through `getExerciseItem` on every parse, so a throw here would turn a
 * single stored row into a 500 on a read path. `null` degrades it to
 * `UNKNOWN_ID`, which both platforms already render as "unavailable or paused".
 */
export function getDraftExerciseCatalog(): ReadonlyMap<string, ExerciseItem> | null {
  if (process.env.NODE_ENV === "production") return null;
  return registeredDraftCatalog;
}
