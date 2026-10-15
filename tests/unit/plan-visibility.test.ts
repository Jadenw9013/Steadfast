import { describe, expect, it, vi } from "vitest";

/**
 * T-2060 — the recorded-facts plan visibility rule, in isolation.
 * `computePlanVisibility` is pure; `getPlanVisibility`'s null arms must return
 * before any database read.
 */

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));

import {
  computePlanVisibility,
  getPlanVisibility,
  publishedPlanVisibilityWhere,
  type PlanVisibility,
  type PlanVisibilityEpisode,
} from "@/lib/coach-client/plan-visibility";

const A = "coach-a";
const B = "coach-b";
const R = "row-current";
const d = (day: number) => new Date(Date.UTC(2026, 0, day));
const NOW = d(100);
const S = d(50);

const ep = (coachId: string | null, coachClientId: string, start: Date, end: Date | null): PlanVisibilityEpisode => ({
  coachId, coachClientId, startedAt: start, endedAt: end,
});
/** The current link's own open episode. */
const CUR = ep(A, R, S, null);

function run(episodes: PlanVisibilityEpisode[], aiTimes: (Date | null)[] = [null, null]) {
  return computePlanVisibility({
    coachId: A, activeCoachClientId: R, relationshipStartedAt: S, episodes, aiTimes, now: NOW,
  });
}

type Case = { name: string; episodes: PlanVisibilityEpisode[]; aiTimes?: (Date | null)[]; unknown: Date; same: Date };

const CASES: Case[] = [
  { name: "1. no episodes -> both = S", episodes: [], unknown: S, same: S },
  { name: "2. cur only -> sameCoachSince = S", episodes: [CUR], unknown: S, same: S },
  { name: "3. A1 (closed) + cur A2 -> A1.start", episodes: [ep(A, "a1", d(10), d(20)), CUR], unknown: S, same: d(10) },
  {
    name: "4. A1, B, A2 -> S",
    episodes: [ep(A, "a1", d(10), d(20)), ep(B, "b", d(25), d(40)), CUR],
    unknown: S, same: S,
  },
  {
    name: "5. A1, B with coachId NULL (purged), A2 -> S",
    episodes: [ep(A, "a1", d(10), d(20)), ep(null, "b", d(25), d(40)), CUR],
    unknown: S, same: S,
  },
  {
    name: "6. A1, AI receipt between, A2 -> S",
    episodes: [ep(A, "a1", d(10), d(20)), CUR], aiTimes: [d(30), null],
    unknown: S, same: S,
  },
  {
    name: "7. A1, consentedAt between, A2 -> S",
    episodes: [ep(A, "a1", d(10), d(20)), CUR], aiTimes: [null, d(30)],
    unknown: S, same: S,
  },
  {
    name: "8. AI time before A1 -> A1.start",
    episodes: [ep(A, "a1", d(10), d(20)), CUR], aiTimes: [d(5), d(4)],
    unknown: S, same: d(10),
  },
  {
    name: "9. B ended before A1, then A1, A2 -> A1.start",
    episodes: [ep(B, "b", d(1), d(5)), ep(A, "a1", d(10), d(20)), CUR],
    unknown: S, same: d(10),
  },
  {
    name: "10. B overlapping cur and closed after S -> unknownAuthorSince = B.end, sameCoachSince = S",
    episodes: [ep(B, "b", d(45), d(60)), CUR],
    unknown: d(60), same: S,
  },
  {
    name: "11. open other episode -> unknownAuthorSince = now",
    episodes: [ep(B, "b", d(45), null), CUR],
    unknown: NOW, same: S,
  },
  {
    name: "12. no cur (no open episode for r) -> S/S",
    episodes: [ep(A, "a1", d(10), d(20)), ep(A, R, S, d(55))],
    unknown: S, same: S,
  },
  {
    name: "13. cur.startedAt != S -> S",
    episodes: [ep(A, "a1", d(10), d(20)), ep(A, R, d(49), null)],
    unknown: S, same: S,
  },
];

describe("computePlanVisibility (T-2060 exact rule)", () => {
  it.each(CASES)("$name", ({ episodes, aiTimes, unknown, same }) => {
    const v = run(episodes, aiTimes);
    expect(v).toEqual({ coachId: A, unknownAuthorSince: unknown, sameCoachSince: same });
  });

  it("14. invariant sameCoachSince <= S <= unknownAuthorSince over the generated table", () => {
    // Every case above, plus each one with every AI time pattern, plus each one
    // with its episodes reversed (input order must not matter).
    const aiPatterns: (Date | null)[][] = [[null, null], [d(1), null], [null, d(30)], [d(30), d(70)], [NOW, null]];
    let checked = 0;
    for (const c of CASES) {
      for (const ai of aiPatterns) {
        for (const episodes of [c.episodes, [...c.episodes].reverse()]) {
          const v = run(episodes, ai);
          expect(v.sameCoachSince.getTime()).toBeLessThanOrEqual(S.getTime());
          expect(S.getTime()).toBeLessThanOrEqual(v.unknownAuthorSince.getTime());
          checked++;
        }
      }
    }
    expect(checked).toBe(CASES.length * aiPatterns.length * 2);
  });
});

describe("publishedPlanVisibilityWhere", () => {
  it("returns the exact two-arm where fragment", () => {
    const v: PlanVisibility = { coachId: A, unknownAuthorSince: d(60), sameCoachSince: d(10) };
    expect(publishedPlanVisibilityWhere(v)).toEqual({
      status: "PUBLISHED",
      OR: [
        { publishedByCoachId: null, publishedAt: { gte: d(60) } },
        { publishedByCoachId: A, publishedAt: { gte: d(10) } },
      ],
    });
  });
});

describe("getPlanVisibility null arms (no database read)", () => {
  const human = {
    origin: "HUMAN" as const, resolutionRequired: false, coachId: A, activeCoachClientId: R, relationshipStartedAt: S,
  };

  it.each([
    ["NONE", { ...human, origin: "NONE" as const, coachId: null, activeCoachClientId: null, relationshipStartedAt: null }],
    ["AI", { ...human, origin: "AI" as const, coachId: null, activeCoachClientId: null, relationshipStartedAt: null }],
    ["resolutionRequired", { ...human, resolutionRequired: true }],
    ["null coachId", { ...human, coachId: null }],
    ["null activeCoachClientId", { ...human, activeCoachClientId: null }],
    ["null relationshipStartedAt", { ...human, relationshipStartedAt: null }],
  ])("%s -> null", async (_name, provider) => {
    mocks.transaction.mockReset();
    expect(await getPlanVisibility("client-1", provider)).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
