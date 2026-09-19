import { db } from "@/lib/db";
import { reportAnomaly } from "@/lib/observability/report";
import { TRAINING_WEEK_EMPTY } from "@/lib/observability/events";

const daySelect = {
  id: true,
  dayName: true,
  sortOrder: true,
  blocks: {
    orderBy: { sortOrder: "asc" as const },
    select: { id: true, type: true, title: true, content: true, sortOrder: true },
  },
} as const;

const programInclude = {
  days: {
    orderBy: { sortOrder: "asc" as const },
    select: daySelect,
  },
};

export async function getTrainingProgramForReview(clientId: string, weekOf: Date) {
  const draft = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    include: programInclude,
  });
  if (draft) return { source: "draft" as const, program: draft };

  const published = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "PUBLISHED" },
    include: programInclude,
  });
  if (published) return { source: "published" as const, program: published };

  // T-920 — only reached once this week already missed on both DRAFT and
  // PUBLISHED, so the extra query never runs on the normal path. If the
  // client has a program in ANY other week, an empty read here is the T-803
  // shape (a narrow per-week lookup with no cross-week fallback) rather than
  // the benign case of a client who has never had a program at all.
  //
  // `status: { in: ["DRAFT", "PUBLISHED"] }` — SUPERSEDED must never count.
  // `supersedeOtherPrograms` (`lib/training-programs/publish.ts`) has no
  // `weekOf` filter, so the steady state of any client who has published
  // twice is one live PUBLISHED row and a SUPERSEDED row for every earlier
  // week. Counting those would make this beacon fire on every past-week view
  // of every multi-week client (and on the current week the instant a coach
  // publishes the next one) — the normal case, not the T-803 anomaly this
  // beacon exists to catch. `weekOf: { not: weekOf }` drops the read week's
  // own row too (defensive only: both `findFirst` calls above already missed
  // DRAFT/PUBLISHED at this exact week, so it can only ever exclude a
  // SUPERSEDED row that the status filter would drop anyway).
  //
  // The whole block, including the destructure below, is wrapped in
  // try/catch — not just the query — so a malformed result shape (or any
  // other synchronous failure while turning `statusCounts` into the beacon's
  // context) degrades to "no beacon" instead of reproducing the original
  // BLOCKER. This call sits inside a `Promise.all` on the coach client
  // dashboard (`app/coach/clients/[clientId]/page.tsx` and
  // `.../review/[weekStartDate]/page.tsx`); an unguarded rejection here would
  // fail the ENTIRE page — meal plan, messages, adherence, all of it — for
  // what today renders fine as an empty training tab. On a pool blip or
  // timeout this degrades to "no beacon fires", never "the dashboard 500s".
  try {
    const statusCounts = await db.trainingProgram
      .groupBy({
        by: ["status", "weekOf"],
        where: { clientId, status: { in: ["DRAFT", "PUBLISHED"] }, weekOf: { not: weekOf } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ status: string; weekOf: Date; _count: { _all: number } }>);
    // Distinct weeks, not row count — a single week can hold both a DRAFT and
    // a PUBLISHED row, and counting rows would report 2 for one week.
    const weeksWithPrograms = new Set(statusCounts.map((row) => row.weekOf.getTime())).size;
    if (weeksWithPrograms > 0) {
      const hasPublished = statusCounts.some((row) => row.status === "PUBLISHED");
      const hasDraft = statusCounts.some((row) => row.status === "DRAFT");
      reportAnomaly(TRAINING_WEEK_EMPTY.evt, {
        ids: { clientId },
        context: { weeksWithPrograms, hasPublished, hasDraft },
        allow: TRAINING_WEEK_EMPTY.allow,
      });
    }
  } catch {
    // Monitoring must never be able to fail a read that would otherwise
    // succeed — see the comment above.
  }

  return { source: "empty" as const, program: null };
}

export async function getPublishedTrainingProgram(clientId: string, publishedAfter: Date | null) {
  // `== null` (not `===`): fails closed on `undefined` too, so an untyped or
  // `as any` caller cannot reintroduce the pre-T-665 unfiltered read — Prisma
  // treats `gte: undefined` as no filter.
  if (publishedAfter == null) return null;
  return db.trainingProgram.findFirst({
    where: { clientId, status: "PUBLISHED", publishedAt: { gte: publishedAfter } },
    // T-744: the ordering rule here is still publishedAt desc; aligning it with
    // ACTIVE_MEAL_PLAN_ORDER_BY is T-744's scope, not this ticket's.
    orderBy: { publishedAt: "desc" },
    include: programInclude,
  });
}
