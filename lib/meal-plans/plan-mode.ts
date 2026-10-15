import { db } from "@/lib/db";
import type { PlanModeInput } from "@/lib/meal-plans/macro-targets";

/**
 * Single source of truth for the COACH-FACING editor mode (T-102a).
 *
 * There are two different plan-mode columns and conflating them is the bug this
 * module exists to make impossible:
 *
 *  - `MealPlan.planMode` is the **snapshot the client sees**. It belongs to one
 *    plan row and, once that row is PUBLISHED, it never changes (CB04). Every
 *    client-facing reader picks its representation from this column.
 *  - `CoachClient.planMode` is the **coach's intent for new work**. The mode
 *    toggle writes it, and it is what a brand-new draft starts from.
 *
 * The mode the coach's EDITOR renders is neither column on its own — it is
 * `draft?.planMode ?? clientPlanMode` (confirmed by Jaden 2026-09-15). The draft
 * for the requested week owns it when one exists, otherwise the client's
 * persistent default. It is deliberately NOT computed from the PUBLISHED plan:
 * doing so would silently undo a toggle made on a week that has only a published
 * plan, which is the exact defect T-102a fixes.
 *
 * This is the ONLY place that precedence is written. Both coach-facing readers
 * call it — the web query `getEffectiveMealPlanForReview` (lib/queries/meal-plans.ts)
 * and the iOS-facing REST `GET /api/coach/clients/[clientId]/meal-plan` — so the
 * two surfaces cannot drift, and no consumer on either platform infers a mode
 * for itself. They also compose it identically: `resolveDefaultPlanMode` goes in
 * the same `Promise.all` as the draft/published reads (it depends on neither, so
 * it costs no extra latency), then the DRAFT's mode — never the published one —
 * is fed to `resolveEditorPlanMode`. Callers MUST have authorized coach access
 * to `clientId` first.
 *
 * **No client-facing reader may ever import this module.** Specifically
 * `app/api/client/meal-plan/current/route.ts`, `lib/queries/adherence.ts`,
 * `lib/pdf/meal-plan-pdf.tsx` and `app/api/mealplans/[mealPlanId]/export/route.ts`
 * pick by the published row's own `planMode` and must stay that way — a coach
 * toggling `CoachClient.planMode` must never change what a client already sees
 * (T-101).
 */

/**
 * THE rule. Pure; no I/O; the only place this precedence is written.
 */
export function resolveEditorPlanMode(
  draftPlanMode: PlanModeInput | null | undefined,
  clientPlanMode: PlanModeInput
): PlanModeInput {
  return draftPlanMode ?? clientPlanMode;
}

/** Resolve the planMode a brand-new draft should start with when the caller
 *  didn't explicitly specify one: the CoachClient's persistent default. */
export async function resolveDefaultPlanMode(
  coachId: string,
  clientId: string
): Promise<PlanModeInput> {
  const assignment = await db.coachClient.findUnique({
    where: { coachId_clientId: { coachId, clientId } },
    select: { planMode: true },
  });
  return assignment?.planMode ?? "MEAL_PLAN";
}
