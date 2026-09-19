import type { Prisma } from "@/app/generated/prisma/client";
import type { PlanExtras } from "@/types/meal-plan-extras";

/**
 * T-841 frozen merge semantics for `MealPlan.planExtras`.
 *
 * The shipped iOS build (App Store, `origin/main` era) sends a `planExtras`
 * object with only `dayOverrides` whenever a plan has at least one day
 * override — it has no `metadata` or `confidence` fields at all. Both save
 * call sites previously replaced the stored JSON wholesale with whatever the
 * request carried, so an iOS save silently destroyed any web-authored
 * `metadata` (phase, start date, bodyweight, coach notes, highlighted
 * changes) and `confidence`. This function is the fix: a shallow, top-level,
 * key-wise merge, called from both `saveDraftMealPlan` (Server Action) and
 * the REST `PUT /api/coach/clients/[clientId]/meal-plan` — do not
 * reimplement this logic anywhere else (standing rule 1); a second copy is
 * an automatic review CHANGES.
 *
 * Four rules, all load-bearing:
 *
 * 1. `stored` MUST be the RAW column value (`plan.planExtras` straight off
 *    Prisma), never `parsePlanExtras(stored)`. Parsing first would silently
 *    drop unknown legacy top-level keys (`rules`, `cardio`, `hydration`,
 *    `supplements`, `allowances`) that some production rows may still
 *    carry. THE TRUE STATE OF THE EVIDENCE: no writer in this repo writes
 *    those keys today. `extractPlanExtras`
 *    (`lib/validations/meal-plan-import.ts:71-77`) is the only function that
 *    ever moves an LLM-parsed plan into this column, and it filters the
 *    parsed plan down to `metadata`/`dayOverrides`/`confidence` before the
 *    write — `rules`, `cardio`, `hydration`, `supplements`, `allowances`
 *    never reach the column through it, regardless of what
 *    `lib/llm/parse-meal-plan.ts`'s prompt asks the model to emit upstream.
 *    `cardio` and `hydration` are rule *categories*
 *    (`types/meal-plan-extras.ts`), never top-level keys, so they could not
 *    appear even in an older shape. The premise rule 1 guards against rests
 *    entirely on rows written before `extractPlanExtras` filtered this way —
 *    i.e. rows predating current code, not anything current code produces.
 *    NOTE: `app/api/client/meal-plan/current/route.ts` does NOT prove those
 *    rows are absent either — that route hardcodes
 *    `rules`/`cardio`/`hydration`/`supplements` to `null` and never reads
 *    them off the column, and the shipped iOS `PlanExtras` Codable struct
 *    only decodes `supplements` and `dayOverrides`, not
 *    `rules`/`cardio`/`hydration`. The premise is unmeasured, not proven
 *    false — see query 1c in
 *    `docs/migrations/T-841-plan-extras-recovery-preview.sql` for the actual
 *    count. Raw-merge is still the right default regardless (conservative,
 *    costs nothing), but do not cite `lib/llm/parse-meal-plan.ts` as
 *    evidence that these keys ever reach this column again.
 * 2. The merge is exactly ONE level deep. A present top-level key (e.g.
 *    `metadata`) replaces the stored value for that key entirely; nested
 *    objects are never merged into. The web UI clears
 *    `metadata.highlightedChanges` by deleting the sub-key and sending the
 *    rebuilt `metadata` object
 *    (`components/coach/meal-plan/plan-extras-display.tsx:276-278`) — a deep
 *    merge would make that delete a no-op.
 * 3. A key absent from `incoming` (including `undefined`) never clears the
 *    stored value for that key. `dayOverrides: []` IS a present key and
 *    therefore does clear the overrides.
 * 4. Never mutates `stored`; always returns a fresh object.
 *
 * If `stored` is not a non-null, non-array JSON object (SQL NULL, JSON
 * `null`, an array, or a scalar), it is treated as `{}`.
 *
 * KNOWN GAP — NOT closed by this fix: `dayOverrides` is itself a single
 * top-level key, so rule 2 (one level deep) means a present `dayOverrides`
 * array still replaces the stored array wholesale, including any nested
 * `items` inside each override. The shipped iOS `EditableDayOverride`
 * rebuilds every override with `items: nil` on every save
 * (`MealPlanDayOverride.swift`), so an iOS save still permanently drops
 * legacy `dayOverrides[].items` on every plan it touches. This merge
 * protects `metadata`, `confidence`, any other top-level key, and a
 * `dayOverrides` that is absent from the incoming request (rule 3) — it does
 * NOT protect content nested inside a `dayOverrides` array that IS present
 * in the request. Do not read this file as having closed the whole bug
 * class. Deepening the merge
 * to reach inside `dayOverrides` is deliberately out of scope here (it would
 * make the web UI's per-day clear-a-field affordance a no-op, see rule 2)
 * and is tracked separately — T-870 must widen its scope to cover
 * `EditableDayOverride.toDayOverride()` on iOS before this residual is
 * closed.
 *
 * KNOWN TRADE-OFF: before this fix, an unparseable stored blob was silently
 * replaced by the next save (self-healing by accident). After this fix, a
 * stored value that fails `planExtrasSchema` stays stored — every reader
 * goes through `parsePlanExtras`, which returns `null` on any shape
 * mismatch, so such a row renders as having no extras at all, permanently,
 * even after a coach adds new overrides. See query 6 in
 * `docs/migrations/T-841-plan-extras-recovery-preview.sql` to find these.
 */
export function mergePlanExtras(
  stored: Prisma.JsonValue | null | undefined,
  incoming: PlanExtras
): Prisma.InputJsonValue {
  const base: Record<string, unknown> =
    stored !== null &&
    stored !== undefined &&
    typeof stored === "object" &&
    !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    base[key] = value;
  }

  return JSON.parse(JSON.stringify(base)) as Prisma.InputJsonValue;
}
