/**
 * T-2038 — the draft exercise catalog's version key, and nothing else.
 *
 * This module has **no imports, by design**. `lib/ai-coach/catalog/loader.ts`
 * routes `getExerciseItem` on this string, and `catalog/loader.ts` is reachable
 * from two `"use client"` components (`components/ai-coach/plan-display.tsx`,
 * `components/ai-coach/evidence-forms.tsx`). Taking the constant from
 * `artifacts/drafts/exercise-catalog.ts` instead would drag that module — and
 * with it the whole 123 KB draft JSON — into the browser chunk, which is
 * exactly what the first version of this ticket did.
 *
 * `artifacts/drafts/exercise-catalog.ts` re-exports this name, so the frozen
 * contract in T-2005 (`DRAFT_EXERCISE_CATALOG_VERSION` exported from the drafts
 * module) still holds for server-side consumers such as T-2039's composer.
 */
export const DRAFT_EXERCISE_CATALOG_VERSION = "exercise-beginner-v1";
