import { db } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";
import type { MealPlanStatus } from "@/app/generated/prisma/client";

/**
 * Single source of truth for both meal-plan publish transports (the
 * `publishMealPlan` server action and the iOS-facing
 * `/api/coach/clients/[clientId]/meal-plan/publish` route — CB04). This is the
 * only place *coach-initiated publish* should set `MealPlan.status =
 * "PUBLISHED"`. It is not yet literally the only writer: as of this writing
 * `app/api/mealplans/import-plan/route.ts` still publishes directly and
 * bypasses this service — see T-730, which moves it onto this module.
 * Both transports MUST call it instead of re-implementing the supersede
 * transaction: the route used to do a bare single-row `update`, which left two
 * PUBLISHED rows for one week (and, once the partial unique index shipped,
 * turned every iOS re-publish into a 500).
 *
 * Supersede is scoped to `(clientId, weekOf)`, NOT `clientId` alone. This is
 * deliberately different from the training-program twin
 * (`app/api/coach/clients/[clientId]/training/publish/route.ts`), whose index
 * is `TrainingProgram(clientId) WHERE status='PUBLISHED'` — one current program
 * per client. The meal index is `MealPlan(clientId, weekOf) WHERE
 * status='PUBLISHED'` — one current plan per week — so superseding by
 * `clientId` alone would wipe every other week's published plan. Do not
 * "harmonize" the two.
 *
 * P2002 → RACE_LOST: the transaction alone does not eliminate unique-index
 * violations under concurrency. Two transactions publishing two *different*
 * drafts of the same week each run their supersede `updateMany` against a
 * pre-commit snapshot, neither sees the other's uncommitted PUBLISHED row, and
 * the second commit trips the partial unique index. That is a lost race, not a
 * server fault, so it maps to the same result as the `count === 0` path and
 * surfaces as a 409 rather than a 500. The match is on the index *name*, never
 * on a bare `code === "P2002"`, so the `@@unique([clientId, weekOf, version])`
 * race that `lib/meal-plans/version.ts` already retries can never be misread as
 * a lost publish race.
 *
 * Notifications deliberately stay in the two entry points; this module must not
 * import from `lib/sms`, `lib/email` or `lib/notifications`, and performs no
 * network I/O inside the transaction.
 */

/** Name of the partial unique index created by 20260913220000_plan_supersede_backfill. */
export const PUBLISHED_MEAL_PLAN_INDEX = "MealPlan_one_published_per_client_week";

export type MealPlanPublishTarget = {
  id: string;
  clientId: string;
  weekOf: Date;
  status: MealPlanStatus;
};

export type PublishMealPlanResult =
  | {
      ok: true;
      mealPlanId: string;
      clientId: string;
      weekOf: Date;
      publishedAt: Date;
      supersededCount: number;
    }
  | { ok: false; code: "NOT_DRAFT"; status: MealPlanStatus }
  | { ok: false; code: "RACE_LOST" };

/**
 * Reads the row both surfaces need before their own authorization check.
 * Returns null when the plan does not exist. Performs no authorization.
 */
export async function getMealPlanPublishTarget(
  mealPlanId: string
): Promise<MealPlanPublishTarget | null> {
  return db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: { id: true, clientId: true, weekOf: true, status: true },
  });
}

/** `meta.target` is a string for some errors and a string[] for others. */
function targetMentionsIndex(target: unknown): boolean {
  if (typeof target === "string") return target.includes(PUBLISHED_MEAL_PLAN_INDEX);
  if (Array.isArray(target)) {
    return target.some((t) => typeof t === "string" && t.includes(PUBLISHED_MEAL_PLAN_INDEX));
  }
  return false;
}

/** True only for a P2002 raised by PUBLISHED_MEAL_PLAN_INDEX. Exported for unit test. */
export function isDuplicatePublishedPlanError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  // Prisma's `meta` shape for an index it doesn't know about isn't guaranteed,
  // so check the structured meta as well as the raw message. Read the known
  // paths directly rather than round-tripping the whole object through
  // JSON.stringify: a circular reference, a BigInt or a throwing getter in a
  // future Prisma/adapter version would make stringify throw out of the
  // caller's catch block and mask a real lost race as an unrelated 500. The
  // probe is wrapped for the same reason — a hostile `meta` degrades to the
  // message check instead of throwing.
  let metaMentionsIndex = false;
  try {
    const meta = err.meta as Record<string, unknown> | undefined;
    // @prisma/adapter-pg (confirmed empirically against the local test DB,
    // T-660): for this raw-SQL index the name survives ONLY here — `meta.target`
    // is absent and `err.message` says just "the fields: (clientId, weekOf)".
    const cause = (meta?.driverAdapterError as { cause?: { originalMessage?: unknown } } | undefined)
      ?.cause;
    metaMentionsIndex =
      String(cause?.originalMessage ?? "").includes(PUBLISHED_MEAL_PLAN_INDEX) ||
      targetMentionsIndex(meta?.target);
  } catch {
    metaMentionsIndex = false;
  }
  return metaMentionsIndex || err.message.includes(PUBLISHED_MEAL_PLAN_INDEX);
}

/**
 * CB04 — the only place coach-initiated publish sets `MealPlan.status =
 * "PUBLISHED"` (`app/api/mealplans/import-plan/route.ts` still bypasses this
 * service until T-730; see the file header). Callers MUST have authorized coach
 * access to target.clientId first.
 */
export async function publishMealPlanTarget(
  target: MealPlanPublishTarget,
  opts?: { now?: Date }
): Promise<PublishMealPlanResult> {
  if (target.status !== "DRAFT") {
    return { ok: false, code: "NOT_DRAFT", status: target.status };
  }

  const publishedAt = opts?.now ?? new Date();

  let counts: { superseded: number; flipped: number };
  try {
    counts = await db.$transaction(async (tx) => {
      // Exclude the target itself: a losing racer in a concurrent
      // double-publish must never demote the row the winner just published.
      // The `weekOf` filter and the `id: { not }` exclusion are both
      // load-bearing — do not "simplify" either.
      const superseded = await tx.mealPlan.updateMany({
        where: {
          clientId: target.clientId,
          weekOf: target.weekOf,
          status: "PUBLISHED",
          id: { not: target.id },
        },
        data: { status: "SUPERSEDED" },
      });
      // Only flip if it's still DRAFT — the count tells us whether we won the
      // concurrent double-publish race.
      const flipped = await tx.mealPlan.updateMany({
        where: { id: target.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt },
      });
      return { superseded: superseded.count, flipped: flipped.count };
    });
  } catch (err) {
    if (isDuplicatePublishedPlanError(err)) return { ok: false, code: "RACE_LOST" };
    // Any other failure — including a P2002 from a different constraint — must
    // still surface as a 500 so it stays visible, never silently swallowed.
    throw err;
  }

  if (counts.flipped === 0) return { ok: false, code: "RACE_LOST" };

  return {
    ok: true,
    mealPlanId: target.id,
    clientId: target.clientId,
    weekOf: target.weekOf,
    publishedAt,
    supersededCount: counts.superseded,
  };
}
