import {
  loadDraftUnsignedExerciseCatalog,
  type DraftExerciseCatalogFile,
} from "../artifacts/drafts/exercise-catalog";
import { projectDraftExerciseCatalog, registerDraftExerciseCatalog } from "./exercise-catalog";

/**
 * T-2038 — the one place that wires the draft exercise catalog into
 * `getExerciseItem`, and the only module outside the drafts folder and the tests
 * that touches the draft content.
 *
 * It is deliberately separate from `catalog/exercise-catalog.ts`: importing the
 * draft loader pulls in the 123 KB JSON it statically imports, and
 * `catalog/exercise-catalog.ts` is reachable from two `"use client"` components
 * through `catalog/loader.ts`. Keeping the import here means the draft reaches
 * server bundles only, and `loadDraftUnsignedExerciseCatalog()`'s production
 * refusal stays the single door into the data.
 *
 * Nothing under `app/` or `components/` imports this module, and a unit test
 * asserts that. T-2039's composer is the intended first caller; it receives the
 * catalog injected, per T-2005's composer contract, so even it does not need
 * `getExerciseItem` to resolve the draft.
 */
export function enableDraftExerciseCatalog(): DraftExerciseCatalogFile {
  const file = loadDraftUnsignedExerciseCatalog();
  registerDraftExerciseCatalog(projectDraftExerciseCatalog(file));
  return file;
}

/** Undoes {@link enableDraftExerciseCatalog}. For tests that assert the default. */
export function disableDraftExerciseCatalog(): void {
  registerDraftExerciseCatalog(null);
}
