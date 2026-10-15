import { db } from "@/lib/db";
import type { ClientProviderState } from "@/lib/queries/client-provider";

/**
 * T-2060 — which PUBLISHED plans a HUMAN-coached client may see, from recorded
 * facts only (no evidence heuristics; T-2058's Rule R was withdrawn).
 *
 * Two arms, by plan author (`MealPlan`/`TrainingProgram.publishedByCoachId`,
 * stamped only by the two publish services):
 *  - **Unknown author** (NULL: every plan published before T-2060, or by a
 *    coach whose account was purged): today's strict bound, the current
 *    `CoachClient.createdAt` (S), narrowed further past the end of any other
 *    provider's episode that overlapped the current link.
 *  - **Authored by the current coach C:** visible from the start of C's
 *    uninterrupted recorded run of episodes. Any other coach's episode
 *    (including an anonymised, purged one) or any AI transition/consent ends
 *    the run, so A->B->A and A->AI->A stay strict.
 *  - **Authored by anyone else:** never visible.
 *
 * Privacy follows from authorship alone: the widening arm only admits rows
 * whose author is C. Episodes only decide staleness. Every inconsistency
 * (no matching open episode, a zombie, a missing backfill) falls back to the
 * strict bound S, never to "show nothing" and never to anything wider.
 *
 * Readers: `lib/meal-plans/active-plan.ts`, `lib/queries/meal-plans.ts`,
 * `lib/queries/training-programs.ts` and the inline query in
 * `app/api/client/training/current/route.ts`, all through
 * `publishedPlanVisibilityWhere`. Deliberately NOT folded into
 * `getClientProvider`: its object is spread verbatim onto
 * `/api/client/coaching-context`, so a new field would change the wire.
 */

export type PlanVisibility = {
  /** provider.coachId */
  coachId: string;
  /** Lower bound on `publishedAt` for plans with `publishedByCoachId IS NULL`. */
  unknownAuthorSince: Date;
  /** Lower bound on `publishedAt` for plans with `publishedByCoachId = coachId`; always <= relationshipStartedAt. */
  sameCoachSince: Date;
};

export type PlanVisibilityEpisode = {
  coachId: string | null;
  coachClientId: string;
  startedAt: Date;
  endedAt: Date | null;
};

const maxDate = (dates: Date[]): Date | null =>
  dates.length === 0 ? null : new Date(Math.max(...dates.map((d) => d.getTime())));

/** Pure. Exported for unit tests (tests/unit/plan-visibility.test.ts). */
export function computePlanVisibility(input: {
  coachId: string;
  activeCoachClientId: string;
  relationshipStartedAt: Date;
  episodes: PlanVisibilityEpisode[];
  /** max AiCoachProviderTransitionReceipt.createdAt, AiCoachProfile.consentedAt */
  aiTimes: (Date | null)[];
  now: Date;
}): PlanVisibility {
  const { coachId: C, activeCoachClientId: r, relationshipStartedAt: S, episodes: E, aiTimes, now } = input;

  // Any other provider period: another coach, or an anonymised (purged) one.
  // An open one has not ended, so it counts up to now.
  const others = E.filter((e) => e.coachId === null || e.coachId !== C);
  const Xp = maxDate(others.map((e) => e.endedAt ?? now));
  const Xa = maxDate(aiTimes.filter((t): t is Date => t !== null));

  const unknownAuthorSince = Xp && Xp.getTime() > S.getTime() ? Xp : S;

  // The current link's own open episode, matched exactly. Missing (a row the
  // backfill never saw, a test fixture inserting CoachClient directly) means
  // the strict bound.
  const cur = E.find(
    (e) => e.coachClientId === r && e.endedAt === null && e.coachId === C && e.startedAt.getTime() === S.getTime(),
  );
  if (!cur) return { coachId: C, unknownAuthorSince, sameCoachSince: S };

  const barrier = maxDate([Xp, Xa].filter((d): d is Date => d !== null));
  const run = E.filter((e) => e.coachId === C && (!barrier || e.startedAt.getTime() >= barrier.getTime()));
  if (!run.includes(cur)) return { coachId: C, unknownAuthorSince, sameCoachSince: S };

  const sameCoachSince = new Date(Math.min(...run.map((e) => e.startedAt.getTime())));
  return { coachId: C, unknownAuthorSince, sameCoachSince };
}

/**
 * Null unless the provider is an unambiguous HUMAN coach with a current link;
 * readers return no plan for null, exactly as they did for a null
 * `relationshipStartedAt`. Three indexed reads, no network I/O.
 */
export async function getPlanVisibility(
  clientId: string,
  provider: Pick<
    ClientProviderState,
    "origin" | "resolutionRequired" | "coachId" | "activeCoachClientId" | "relationshipStartedAt"
  >,
): Promise<PlanVisibility | null> {
  const { coachId, activeCoachClientId, relationshipStartedAt } = provider;
  if (provider.origin !== "HUMAN" || provider.resolutionRequired) return null;
  if (!coachId || !activeCoachClientId || !relationshipStartedAt) return null;

  const [episodes, receipts, profile] = await db.$transaction([
    db.coachClientEpisode.findMany({
      where: { clientId },
      select: { coachId: true, coachClientId: true, startedAt: true, endedAt: true },
    }),
    db.aiCoachProviderTransitionReceipt.aggregate({ where: { clientId }, _max: { createdAt: true } }),
    db.aiCoachProfile.findUnique({ where: { clientId }, select: { consentedAt: true } }),
  ]);

  return computePlanVisibility({
    coachId,
    activeCoachClientId,
    relationshipStartedAt,
    episodes,
    aiTimes: [receipts._max.createdAt ?? null, profile?.consentedAt ?? null],
    now: new Date(),
  });
}

/**
 * The `where` fragment every client-facing plan reader spreads after
 * `clientId`. Valid as both a MealPlanWhereInput and a
 * TrainingProgramWhereInput (both models carry both columns).
 */
export function publishedPlanVisibilityWhere(v: PlanVisibility): {
  status: "PUBLISHED";
  OR: [
    { publishedByCoachId: null; publishedAt: { gte: Date } },
    { publishedByCoachId: string; publishedAt: { gte: Date } },
  ];
} {
  return {
    status: "PUBLISHED",
    OR: [
      { publishedByCoachId: null, publishedAt: { gte: v.unknownAuthorSince } },
      { publishedByCoachId: v.coachId, publishedAt: { gte: v.sameCoachSince } },
    ],
  };
}
