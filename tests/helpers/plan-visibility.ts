import { getPlanVisibility, type PlanVisibility } from "@/lib/coach-client/plan-visibility";
import { getClientProvider } from "@/lib/queries/client-provider";

/**
 * T-2060 mechanical test helpers. The client plan readers used to take
 * `publishedAfter: Date | null`; they now take `PlanVisibility | null`.
 */

/** What every client page and route computes: the real rule for this client's current provider. */
export async function visibilityFor(clientId: string): Promise<PlanVisibility | null> {
  return getPlanVisibility(clientId, await getClientProvider(clientId));
}

/**
 * A pre-T-2060 `publishedAfter` Date as a PlanVisibility: both arms bounded by
 * `since`, so a NULL-author plan and a plan authored by `coachId` behave exactly
 * as they did under the old single bound. Only for tests that deliberately read
 * with a hand-picked bound (e.g. `new Date(0)` as a precondition read).
 */
export function visibleSince(since: Date, coachId: string): PlanVisibility {
  return { coachId, unknownAuthorSince: since, sameCoachSince: since };
}
