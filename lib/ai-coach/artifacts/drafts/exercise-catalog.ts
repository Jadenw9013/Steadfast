import { z } from "zod";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "../schema";
import { exerciseCatalogContentSchema } from "../schema";
import {
  artifactFileReviewMetadataSchema,
  reportReviewStateMismatch,
  requireSignedReviewMetadata,
} from "./file-review";
import { DRAFT_EXERCISE_CATALOG_VERSION } from "../../catalog/draft-catalog-version";
import rawDraftExerciseCatalog from "./exercise-catalog.draft-unsigned.v1.json";

/**
 * T-2038 — the DRAFT_UNSIGNED beginner exercise catalog.
 *
 * `exercise-catalog.draft-unsigned.v1.json` is the single source of exercise
 * content in this repository. `lib/ai-coach/catalog/exercise-catalog.ts`
 * projects the same file into the in-code `ExerciseItem` map; it is a
 * projection, never a transcription, so a movement is added or corrected in one
 * place.
 *
 * What the file does and does not claim:
 *
 * - Every movement, every instruction and every cue is written from scratch for
 *   Steadfast. Nothing is copied from a certification manual, coaching course,
 *   book or paid database, and the schema carries no image, video, GIF or
 *   animation field.
 * - `source.authority` is the literal `"REVIEWED_SOURCE"` that
 *   `reviewedSourceSchema` fixes for every artifact of every kind. It describes
 *   the class of the reference, not this record: the American College of Sports
 *   Medicine has not reviewed, endorsed or validated any Steadfast exercise, and
 *   `source.reviewedAt` records only the date the referenced page was consulted.
 *   See `docs/ai-coach/catalog/README.md` — the reviewer is asked to confirm or
 *   replace that reference.
 * - The file carries no dose. Sets, repetitions, rest, load, tempo, frequency
 *   and duration are policy-bundle parameters (T-2039) and are absent here by
 *   construction; `tests/unit/ai-coach-exercise-catalog-draft.test.ts` fails if a
 *   number ever appears in an instruction or a cue.
 *
 * Nothing in this file may reach a client. It ships `DRAFT_UNSIGNED` with every
 * item `PROPOSED`, {@link loadDraftUnsignedExerciseCatalog} refuses to run in
 * production, and T-2034's four refusal points (`assertUsable`,
 * `publishArtifactVersion`, `loadLiveArtifactSetForLaunchValidation` and
 * `parseArtifactDraftInput`) reject the metadata if it were ever registered.
 *
 * **This module is server-side and test-side only, and it is what keeps the
 * draft out of the browser.** It statically imports the 123 KB JSON, so any
 * module that imports it carries the whole draft into its bundle. The first
 * version of this ticket was imported by `lib/ai-coach/catalog/exercise-catalog.ts`,
 * which `catalog/loader.ts` imports, which `components/ai-coach/evidence-forms.tsx`
 * ("use client") imports — and 120 KB of unsigned draft movements, instructions
 * included, shipped to every client that loaded that route. Nothing under
 * `app/` or `components/` may import this module; a unit test asserts it, and
 * `lib/ai-coach/catalog/exercise-catalog.ts` reaches the content only through
 * {@link loadDraftUnsignedExerciseCatalog}, so the production refusal below is
 * the single door into the data.
 */

/**
 * Re-exported from `lib/ai-coach/catalog/draft-catalog-version.ts`, which has no
 * imports, so the client-reachable catalog loader can route on the version
 * without pulling this module (and the JSON) into a browser chunk. The name is
 * exported from here because T-2005 froze it here.
 */
export { DRAFT_EXERCISE_CATALOG_VERSION };

/**
 * Per-item review marks, so the reviewer can strike a movement without deleting
 * it and without the reviewer's own workflow state entering the hashed artifact
 * content. They live in the file envelope rather than inside `content` for that
 * reason, and because T-2005 froze the additive `content` fields and this is not
 * one of them.
 */
export const draftExerciseReviewStateSchema = z
  .object({
    itemKind: z.enum(["EXERCISE", "TEMPLATE"]),
    itemId: z.string().min(1).max(160),
    reviewState: z.enum(["PROPOSED", "ACCEPTED", "STRUCK"]),
  })
  .strict();

export type DraftExerciseReviewState = z.infer<typeof draftExerciseReviewStateSchema>;

export const draftExerciseCatalogFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: artifactFileReviewMetadataSchema,
    reviewStates: z.array(draftExerciseReviewStateSchema).min(1).max(20_000),
    content: exerciseCatalogContentSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    reportReviewStateMismatch(file.reviewMetadata, file.reviewStates, ctx);
    const expected = new Map<string, "EXERCISE" | "TEMPLATE">();
    for (const exercise of file.content.exercises) expected.set(exercise.id, "EXERCISE");
    for (const template of file.content.templates) expected.set(template.id, "TEMPLATE");

    const seen = new Set<string>();
    file.reviewStates.forEach((state, index) => {
      if (seen.has(state.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemId"],
          message: `Duplicate review state for ${state.itemId}`,
        });
      }
      seen.add(state.itemId);
      const kind = expected.get(state.itemId);
      if (kind === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemId"],
          message: `Review state references an item that is not in the catalog: ${state.itemId}`,
        });
        return;
      }
      if (kind !== state.itemKind) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemKind"],
          message: `Review state for ${state.itemId} declares ${state.itemKind}; the catalog carries it as ${kind}`,
        });
      }
    });

    for (const [itemId] of expected) {
      if (!seen.has(itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates"],
          message: `Every catalog item needs a review state; missing: ${itemId}`,
        });
      }
    }
  });

export type DraftExerciseCatalogFile = z.infer<typeof draftExerciseCatalogFileSchema>;

/**
 * Loads and strictly parses the checked-in DRAFT_UNSIGNED exercise catalog.
 * Throws in production environments — draft artifacts must never be loaded in
 * production. Mirrors `loadDraftUnsignedPolicyBundle` / `loadDraftUnsignedFoodCatalog`.
 */
export function loadDraftUnsignedExerciseCatalog(): DraftExerciseCatalogFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  const file = draftExerciseCatalogFileSchema.parse(rawDraftExerciseCatalog);
  if (file.content.artifactKey !== DRAFT_EXERCISE_CATALOG_VERSION) {
    throw new Error(
      `Draft exercise catalog artifactKey ${file.content.artifactKey} does not match DRAFT_EXERCISE_CATALOG_VERSION ${DRAFT_EXERCISE_CATALOG_VERSION}.`
    );
  }
  return file;
}

/**
 * Converts the validated file into an `ArtifactDraftInput` ready for
 * registration. The signature is read from the file rather than passed in, so
 * the file and the registered artifact cannot disagree about who signed what,
 * and {@link requireSignedReviewMetadata} refuses an unsigned one from
 * JavaScript as well as from TypeScript.
 *
 * No caller exists, and that is still intentional: registering is activation,
 * and activation is Jaden's step alone.
 */
export function exerciseCatalogToArtifactDraftInput(
  file: DraftExerciseCatalogFile,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  const signed = requireSignedReviewMetadata(file.reviewMetadata, "exercise catalog");
  return {
    id: `${file.content.artifactKey}:v${file.content.version}`,
    artifactKey: file.content.artifactKey,
    version: file.content.version,
    kind: "EXERCISE_CATALOG",
    schemaVersion: 1,
    engineVersions: ["ai-coach-artifact-engine-v1"],
    dependencies,
    synthetic: false,
    reviewMetadata: signed,
    content: file.content,
  };
}
