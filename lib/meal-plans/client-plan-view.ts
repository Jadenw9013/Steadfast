/**
 * Single source of truth for WHAT THE CLIENT'S PLAN SCREEN RENDERS (T-802a).
 *
 * Distinct from `lib/meal-plans/active-plan.ts`, which decides WHICH plan a
 * client is looking at. This module decides which BODY (foods or macros) that
 * plan's screen shows once the plan is already in hand — a pure function of
 * `(planMode, itemCount, macroTargetCount)`. The truth table is T-802 §4 (in
 * `board/tickets/T-802.md`), frozen there and not re-litigated here.
 *
 * Pure. No `db` import, no `next/*` import. It must be importable from a
 * `"use client"` component (`components/client/simple-meal-plan.tsx`) and from
 * the ui-qa esbuild harness — precedent: `lib/meal-plans/editor-state.ts`. It
 * must NOT go in `lib/meal-plans/plan-mode.ts`, whose header explicitly
 * forbids client-facing readers from importing it (that module resolves the
 * COACH editor's mode, a different question entirely).
 *
 * Row 2 of the truth table (`MACROS`, 0 targets, >0 items → render the foods
 * body) is the T-800 production incident: a foods editor created a new
 * version without an explicit `planMode`, it fell through to a stale
 * `CoachClient` default of MACROS, and every client-facing reader rendered a
 * blank screen for a plan that plainly had food in it. Row 5 is this ticket's
 * deliberate, symmetric extension of that rule (T-802 §4.1) — the same
 * blank-screen defect in the other direction, reachable from the same
 * carry-forward legacy data.
 *
 * The twin implementation is `MealPlanViewModel.planView` on iOS
 * (T-802b). Same truth table, same output shape. If one moves, the other
 * must.
 *
 * Also exports small helpers the shell derives from this module's output:
 * `isCheckoffEligible` (degraded rows are read-only, per the lead's
 * 2026-09-18 decision on T-802), `seedSelectedDay` (seed the shell's initial
 * day from the server's clock, not the browser's), and `deriveCheckoffNames`
 * (the one derivation of which meal names the rendered body offers for
 * check-off — review r3, MINOR 1).
 */

export type ClientPlanBody = "FOODS" | "MACROS" | "EMPTY";
export type ClientPlanDegradation = "NONE" | "MACROS_WITHOUT_TARGETS" | "FOODS_WITHOUT_ITEMS";

export type ClientPlanView = {
  body: ClientPlanBody;
  degradation: ClientPlanDegradation;
};

/**
 * THE rule. T-802 §4's truth table, and the only place the client-facing body
 * is decided.
 *
 * `planMode` null/undefined behaves as `MEAL_PLAN`, matching iOS's
 * `resolvedPlanMode` (SteadfastAPI.swift:831) for cached pre-field responses,
 * and matching this repo's own optional `planMode` typing on the client
 * (`simple-meal-plan.tsx`'s local `MealPlan` type has always treated it that
 * way).
 */
export function resolveClientPlanView(input: {
  planMode: "MEAL_PLAN" | "MACROS" | null | undefined;
  itemCount: number;
  macroTargetCount: number;
}): ClientPlanView {
  const { itemCount, macroTargetCount } = input;
  const isMacros = input.planMode === "MACROS";

  if (isMacros) {
    if (macroTargetCount > 0) return { body: "MACROS", degradation: "NONE" };
    if (itemCount > 0) return { body: "FOODS", degradation: "MACROS_WITHOUT_TARGETS" };
    return { body: "EMPTY", degradation: "NONE" };
  }

  // MEAL_PLAN / null / undefined
  if (itemCount > 0) return { body: "FOODS", degradation: "NONE" };
  if (macroTargetCount > 0) return { body: "MACROS", degradation: "FOODS_WITHOUT_ITEMS" };
  return { body: "EMPTY", degradation: "NONE" };
}

/**
 * T-802a review r2, MAJOR 1 / lead decision (`board/tickets/T-802.md`
 * "## Decision (lead architect, 2026-09-18 — degraded states are
 * read-only)"). In a degraded row (row 2 or row 5) the rendered body offers
 * meal names that `deriveMealNames` (`lib/meal-plans/active-plan.ts`, keyed
 * strictly on the plan's DECLARED `planMode`) never counts. Writing
 * check-offs for those names would persist `DailyMealCheckoff` rows the
 * dashboard, `/api/client/home` and the coach's weekly adherence view all
 * ignore or double-count. Until T-814 makes the counting rule follow the
 * rendered body, the degraded body is READ-ONLY: no check-off circles, no
 * progress bar. The notice still explains why. Callers gate both the
 * check-off controls and the derivation of `checkoffNames` on this.
 */
export function isCheckoffEligible(view: ClientPlanView): boolean {
  return view.degradation === "NONE";
}

/**
 * T-802a review r2, MAJOR 2. Seeds the shell's `selectedDay` state. Macro
 * mode has no weekday strip (T-802 §2.1), so if `selectedDay` started from
 * the browser's local-clock weekday while check-off eligibility is judged
 * against the server's profile-timezone `todayWeekday`
 * (`app/client/plan/page.tsx`'s `user.timezone`), a client whose device
 * weekday differs from the profile timezone would lose every check-off
 * circle for the whole day with no affordance to get back. Prefer the
 * server's `todayWeekday` when it is present (both bodies); fall back to
 * the caller's browser-clock guess only when adherence — and therefore
 * `todayWeekday` — hasn't loaded.
 */
export function seedSelectedDay(
  todayWeekday: string | undefined,
  browserFallback: () => string
): string {
  return todayWeekday ?? browserFallback();
}

/** Frozen client-facing copy. Byte-identical to the iOS strings in T-802b. */
export const DEGRADED_NOTICE: Record<
  Exclude<ClientPlanDegradation, "NONE">,
  string
> = {
  MACROS_WITHOUT_TARGETS:
    "Showing the foods your coach saved for this week. Macro targets haven't been set yet.",
  FOODS_WITHOUT_ITEMS:
    "Showing this week's macro targets. Your coach hasn't added foods yet.",
};

/**
 * T-802a review r2, MINOR-3 follow-up (lead decision, `board/tickets/T-802.md`
 * "## Decision (lead architect, 2026-09-18 — degraded hint + number
 * formatting, both platforms)"). Second frozen hint line rendered under
 * `DEGRADED_NOTICE`, shown only when the day context would otherwise offer
 * check-offs (viewing today, adherence available). Byte-identical to iOS
 * (T-802b). Do not amend on web only.
 */
export const CHECKOFFS_PAUSED_HINT =
  "Meal check-offs are paused until your coach updates this plan.";

/**
 * T-802a review r3, MINOR 1. THE single derivation of the ordered,
 * exact-string de-duplicated list of meal names the RENDERED body offers for
 * check-off (T-802 §2.3). No trimming, no case folding — these are
 * `DailyMealCheckoff.mealNameSnapshot` values and must match `deriveMealNames`
 * (`lib/meal-plans/active-plan.ts`) and rows already on disk.
 *
 * Empty for a degraded row (`isCheckoffEligible(view) === false`):
 * `deriveMealNames` keys strictly on the plan's DECLARED `planMode`, which for
 * a degraded row disagrees with the RENDERED body, so a name from this list
 * would write a `DailyMealCheckoff` row no other reader ever counts.
 *
 * `foodsNames` / `macroNames` are the caller's already-resolved display
 * names for the day (the shell passes the day-resolved foods meal names and
 * the raw macro target names respectively) — this function only applies the
 * eligibility gate, body selection and de-dupe; it does not resolve overrides
 * or targets itself.
 */
export function deriveCheckoffNames(
  view: ClientPlanView,
  foodsNames: string[],
  macroNames: string[]
): string[] {
  if (!isCheckoffEligible(view)) return [];
  const source = view.body === "MACROS" ? macroNames : foodsNames;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of source) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * The single shape of the degraded-render server log (T-802 §4.3). No client
 * id, no client name, no meal or food strings — ids and counts only. Called
 * ONLY from server code (the two pages and the REST route), never from a
 * client component. Returns immediately when `view.degradation === "NONE"`.
 */
export function logDegradedPlanRender(input: {
  mealPlanId: string;
  planMode: "MEAL_PLAN" | "MACROS" | null | undefined;
  itemCount: number;
  macroTargetCount: number;
  view: ClientPlanView;
}): void {
  if (input.view.degradation === "NONE") return;
  console.warn("[client-plan] degraded render", {
    mealPlanId: input.mealPlanId,
    planMode: input.planMode,
    items: input.itemCount,
    macroTargets: input.macroTargetCount,
    degradation: input.view.degradation,
  });
}
