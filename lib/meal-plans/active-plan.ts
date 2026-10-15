import { db } from "@/lib/db";
import type { PlanMode, Prisma } from "@/app/generated/prisma/client";

/**
 * Single source of truth for client-facing active-plan selection: "which
 * PUBLISHED meal plan is this client's plan *right now*", and "what are its
 * meal names". Every client-facing reader goes through this module and nothing
 * else — `getCurrentPublishedMealPlan` (`/client`, `/client/plan`,
 * `/client/meal-plan`, `/api/client/home`), `getActiveMealNames` (the daily
 * checkoff list on `/client`, `/api/client/home`,
 * `/api/client/adherence/today`) and `GET /api/client/meal-plan/current` (the
 * whole iOS meal-plan screen). Sits in `lib/meal-plans/` next to `drafts.ts`,
 * `publish.ts` and `plan-mode.ts` because it is plan semantics, not checkoff
 * bookkeeping; `lib/queries/adherence.ts` owns `DailyMealCheckoff` rows only.
 *
 * WHY IT EXISTS (T-105). The rule used to be written out four times, every copy
 * ordering by `publishedAt desc` with no `weekOf` bound. A coach who published
 * a *correction to last week* after this week's plan was already live silently
 * demoted this week's plan: every client-facing reader flipped back to last
 * week's meals and the checkoff list started writing last week's
 * `mealNameSnapshot` rows. Worse, because the copies could drift, two screens
 * could pick two different plans on the same day and persist two disjoint sets
 * of checkoffs. One function, one rule.
 *
 * THE RULE. The PUBLISHED plan with the highest `weekOf` wins, tie-broken by
 * `publishedAt desc, version desc`. One query, no `weekOf` bound, no fallback,
 * no clock — the answer is a pure function of the client's PUBLISHED rows.
 * `weekOf` first IS the fix on its own: a correction to an earlier week can
 * never outrank a later week no matter when it was published, so nothing needs
 * to be excluded from the query. The tie-breaks are not decoration either: the
 * partial unique index `MealPlan_one_published_per_client_week` only guarantees
 * one PUBLISHED row per `(clientId, weekOf)` going forward, and pre-index rows
 * can violate it, so without them the pick is nondeterministic for legacy data.
 * Because there is no bound, no row can ever be excluded by week — a
 * non-normalized mid-week `weekOf` (rows predating `parseWeekStartDate`, and
 * `tests/integration/client-provider-plan.test.ts`) is always eligible, so a
 * client can never be left planless by a week comparison.
 *
 * A newly published FUTURE week is visible to the client immediately (Jaden,
 * 2026-09-16), unchanged from the pre-T-105 behavior: it simply carries the
 * highest `weekOf` and sorts first. The accepted consequence is that it then
 * outranks the current week for as long as it is the highest week, so a later
 * correction to the current week would not surface — unreachable today because
 * no coach surface can publish a strictly future `weekOf` (every
 * `weekStartDate` is pinned to the current week or a check-in's week). Trigger
 * to revisit: the first ticket that adds a coach-facing week picker or a "plan
 * next week" affordance must re-open this rule. Do not reintroduce a ceiling.
 *
 * `publishedAfter: undefined` used to be a LEGACY unfiltered-read state with
 * exactly one caller, `getCurrentPublishedMealPlan`'s optional parameter,
 * which `app/client/meal-plan/page.tsx` relied on. T-665 removed it: that
 * caller is now gated like every other client-facing read, and the
 * `undefined` arm of `PublishedAfter` is gone. Never pass `undefined`.
 *
 * `deriveMealNames` de-dups on the EXACT `mealName` string — no trimming, no
 * case folding. `DailyMealCheckoff` is unique on
 * `(dailyAdherenceId, mealNameSnapshot)` and rows already on disk were written
 * with the unmodified string by both checkoff-writing components, so
 * normalizing here would make this helper disagree with production data.
 * Preventing duplicate macro-row names at the editor is T-103's job.
 */

/** Identical in shape to what `getTodayMealNames` returned. `order` is the
 *  first-seen `sortOrder`, and is what `components/client/today-adherence.tsx`
 *  passes to `toggleMealCheckoff` as `displayOrder`. Do not rename. */
export type MealNameEntry = { mealName: string; order: number };

/** Provider gate (house rule 2). Two states:
 *    Date  → HUMAN provider: only plans published at/after it are visible
 *    null  → no active human provider (AI / NONE / resolutionRequired) → no plan
 *  T-665 deleted the legacy `undefined` (unfiltered) arm; it had exactly one
 *  caller, `app/client/meal-plan/page.tsx`, and that caller is now gated. */
export type PublishedAfter = Date | null;

export const ACTIVE_MEAL_PLAN_ORDER_BY: Prisma.MealPlanOrderByWithRelationInput[] = [
  { weekOf: "desc" },
  { publishedAt: "desc" },
  { version: "desc" },
];

/** THE rule. Every client-facing "what is this client's plan right now" read
 *  goes through this and nothing else. No clock: the answer is a pure function
 *  of the client's PUBLISHED rows. */
export async function resolveActiveMealPlanId(
  clientId: string,
  publishedAfter: PublishedAfter
): Promise<string | null> {
  // `== null` (not `===`): fails closed on `undefined` too, so an untyped or
  // `as any` caller cannot reintroduce the pre-T-665 unfiltered read — Prisma
  // treats `gte: undefined` as no filter.
  if (publishedAfter == null) return null;

  // Covered by `@@index([clientId, weekOf])`: equality on `clientId`, then a
  // backward ordered scan on `weekOf`, with `status`/`publishedAt` as filters.
  const plan = await db.mealPlan.findFirst({
    where: {
      clientId,
      status: "PUBLISHED",
      publishedAt: { gte: publishedAfter },
    },
    orderBy: ACTIVE_MEAL_PLAN_ORDER_BY,
    select: { id: true },
  });
  return plan?.id ?? null;
}

/**
 * Pure. No DB. Exported for unit tests and for any future reader that already
 * holds the plan rows.
 *
 * Mode-gated (T-101). `items` and `macroTargets` now coexist on every version
 * — carry-forward keeps both representations so switching modes is reversible
 * — so "which array is non-empty" is not a usable signal. A MACROS plan
 * routinely carries the previous foods plan's items, and deriving the
 * checklist from those would write `mealNameSnapshot` rows for meals the
 * client is never shown: the client plan shell
 * (`components/client/simple-meal-plan.tsx`, T-802a) builds its own checklist
 * from whichever body `resolveClientPlanView` renders and calls
 * `toggleMealCheckoff` with THOSE names, so the two lists would persist two
 * disjoint sets of checkoffs for the same day. Pick by `planMode`, exactly as
 * the client view's non-degraded rows do. (Degraded rows are read-only on the
 * client per T-802's lead decision, so this function's own set is never
 * challenged there either.)
 */
export function deriveMealNames(plan: {
  planMode: PlanMode;
  items: { mealName: string; sortOrder: number }[];
  macroTargets: { mealName: string; sortOrder: number }[];
}): MealNameEntry[] {
  const rows = plan.planMode === "MACROS" ? plan.macroTargets : plan.items;
  // Deduplicate by exact mealName preserving first-seen sortOrder.
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!seen.has(row.mealName)) seen.set(row.mealName, row.sortOrder);
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([mealName, order]) => ({ mealName, order }));
}

/** This ticket's headline helper. Replaces `getTodayMealNames`.
 *  `publishedAfter` is REQUIRED — `Date | null`, never optional, never
 *  `undefined`. Pass `provider.relationshipStartedAt` verbatim. */
export async function getActiveMealNames(
  clientId: string,
  publishedAfter: Date | null
): Promise<MealNameEntry[]> {
  const id = await resolveActiveMealPlanId(clientId, publishedAfter);
  if (!id) return [];
  const plan = await db.mealPlan.findUnique({
    where: { id },
    select: {
      planMode: true,
      items: { orderBy: { sortOrder: "asc" }, select: { mealName: true, sortOrder: true } },
      macroTargets: { orderBy: { sortOrder: "asc" }, select: { mealName: true, sortOrder: true } },
    },
  });
  return plan ? deriveMealNames(plan) : [];
}
