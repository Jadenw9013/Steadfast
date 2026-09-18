import { db } from "@/lib/db";
import { emptyPlanMessage, type PlanModeValue } from "./publish-messages";

/**
 * T-800 hotfix. This is the only emptiness rule for publishing a meal plan —
 * both the web Server Action (app/actions/meal-plans.ts) and the iOS-facing
 * REST route (app/api/coach/clients/[clientId]/meal-plan/publish/route.ts)
 * call checkPlanPublishable. Do not re-implement this logic in either place.
 *
 * T-102b's lib/meal-plans/publish.ts (team/sprint-1 only) supersedes this
 * file when team/sprint-1 merges — see board/tickets/T-800.md's merge plan.
 */

export function isPlanEmptyForMode(
  planMode: PlanModeValue,
  counts: { items: number; macroTargets: number }
): boolean {
  return planMode === "MACROS" ? counts.macroTargets === 0 : counts.items === 0;
}

export type PublishGuardResult =
  | { ok: true }
  | { ok: false; code: "EMPTY_PLAN"; planMode: PlanModeValue; message: string };

/**
 * One read, no transaction, no network I/O. A missing row resolves to
 * { ok: true } — the caller has already 404'd on a missing plan by the time
 * this runs.
 */
export async function checkPlanPublishable(mealPlanId: string): Promise<PublishGuardResult> {
  const plan = await db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: { planMode: true, _count: { select: { items: true, macroTargets: true } } },
  });
  if (!plan) return { ok: true };

  const counts = { items: plan._count.items, macroTargets: plan._count.macroTargets };
  if (isPlanEmptyForMode(plan.planMode, counts)) {
    return {
      ok: false,
      code: "EMPTY_PLAN",
      planMode: plan.planMode,
      message: emptyPlanMessage(plan.planMode),
    };
  }
  return { ok: true };
}
