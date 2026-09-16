import { db } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";
import type { MealPlanStatus, PlanMode } from "@/app/generated/prisma/client";

/**
 * Single source of truth for every meal-plan publish transport: the
 * `publishMealPlan` server action, the iOS-facing
 * `/api/coach/clients/[clientId]/meal-plan/publish` route (CB04), and the OCR
 * import path `app/api/mealplans/import-plan/route.ts`. This is the only place
 * in the codebase that sets `MealPlan.status = "PUBLISHED"`.
 * Every transport MUST call it instead of re-implementing the supersede
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
 * The transaction is atomic with respect to its OWN outcome: when the target
 * row is no longer a DRAFT (or has been deleted) by the time the flip runs, the
 * callback throws the private `RaceLost` sentinel so the supersede half rolls
 * back with it. Returning `RACE_LOST` after a committed transaction instead
 * would demote the week's live PUBLISHED plan while publishing nothing, leaving
 * the client with ZERO published plans for that week — reachable whenever the
 * publish target stops being a DRAFT between the T-102b content read below and
 * the transaction (a concurrent draft delete through
 * `DELETE /api/coach/clients/[clientId]/meal-plan`). Do not move the zero-count
 * check back outside the callback.
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
 *
 * EMPTY_PLAN (T-102b): a plan with no content for its OWN `planMode` — a MACROS
 * plan with zero `MealMacroTarget` rows, or a MEAL_PLAN plan with zero
 * `MealPlanItem` rows — is rejected here rather than in the entry points, so all
 * three transports reject identically by construction. Two consequences of
 * where the check sits:
 *   - It does its own small content read instead of widening
 *     `MealPlanPublishTarget`. The import route hand-constructs a target literal
 *     (`{ id, clientId, weekOf, status: "DRAFT" }`) rather than reading one
 *     through `getMealPlanPublishTarget`, so any field added to that type would
 *     have to be invented there. The target type must stay as it is.
 *   - The read is deliberately OUTSIDE the transaction. A coach emptying the
 *     plan in another tab in the milliseconds between the read and the commit
 *     slips through, which degrades to exactly the pre-T-102b behavior (an empty
 *     publish) and is not a correctness regression: emptiness is a UX guard, not
 *     a data invariant. The real invariants — one PUBLISHED row per week and the
 *     DRAFT-only transition — stay inside the transaction.
 * Order is load-bearing: NOT_DRAFT (no read) → EMPTY_PLAN (one read) →
 * transaction. Re-publishing an already-PUBLISHED plan must keep returning
 * NOT_DRAFT, never EMPTY_PLAN.
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
  | { ok: false; code: "RACE_LOST" }
  /** T-102b — the plan has no content for its own planMode. */
  | { ok: false; code: "EMPTY_PLAN"; planMode: PlanMode };

/**
 * The single definition of "empty for this mode". Pure; exported for unit test.
 *
 * Keys off `planMode` ONLY. It must never become "some array is non-empty":
 * T-101 made carry-forward the default and made it carry EVERY representation,
 * so `items` and `macroTargets` routinely coexist on the same row. A MACROS plan
 * carrying last week's foods has zero targets and is exactly the empty plan this
 * guard exists to reject.
 */
export function isPlanEmptyForMode(
  planMode: PlanMode,
  counts: { items: number; macroTargets: number }
): boolean {
  return planMode === "MACROS" ? counts.macroTargets === 0 : counts.items === 0;
}

/**
 * The single copy of the user-facing wording. All three transports call it;
 * none writes its own string. Exported for unit test.
 *
 * Both strings are well under the 300-character cutoff in iOS's
 * `userFacingErrorMessage` (APIService.swift), which returns the `error` key
 * verbatim, so the coach sees this sentence on every surface.
 */
export function emptyPlanMessage(planMode: PlanMode): string {
  return planMode === "MACROS"
    ? "Add at least one meal with macro targets before publishing."
    : "Add at least one food before publishing.";
}

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
 * Thrown inside the publish transaction when the flip matches zero rows, so the
 * supersede rolls back with it. Private on purpose: it never escapes
 * `publishMealPlanTarget`, which maps it to `RACE_LOST`.
 */
class RaceLost extends Error {
  constructor() {
    super("meal plan publish race lost");
    this.name = "RaceLost";
  }
}

/**
 * CB04 — the only place `MealPlan.status` becomes `"PUBLISHED"`. Callers MUST
 * have authorized coach access to target.clientId first.
 */
export async function publishMealPlanTarget(
  target: MealPlanPublishTarget,
  opts?: { now?: Date }
): Promise<PublishMealPlanResult> {
  if (target.status !== "DRAFT") {
    return { ok: false, code: "NOT_DRAFT", status: target.status };
  }

  // T-102b — see the file header for why this read is here and not inside the
  // transaction or inside getMealPlanPublishTarget.
  const content = await db.mealPlan.findUnique({
    where: { id: target.id },
    select: { planMode: true, _count: { select: { items: true, macroTargets: true } } },
  });
  // Deleted between the caller's read and here — the same outcome the
  // DRAFT-only updateMany would have produced.
  if (!content) return { ok: false, code: "RACE_LOST" };
  if (isPlanEmptyForMode(content.planMode, content._count)) {
    return { ok: false, code: "EMPTY_PLAN", planMode: content.planMode };
  }

  const publishedAt = opts?.now ?? new Date();

  let supersededCount: number;
  try {
    supersededCount = await db.$transaction(async (tx) => {
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
      // concurrent double-publish race. Losing it must undo the supersede
      // above, so throw rather than returning the count (see the file header).
      const flipped = await tx.mealPlan.updateMany({
        where: { id: target.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt },
      });
      if (flipped.count === 0) throw new RaceLost();
      return superseded.count;
    });
  } catch (err) {
    if (err instanceof RaceLost) return { ok: false, code: "RACE_LOST" };
    if (isDuplicatePublishedPlanError(err)) return { ok: false, code: "RACE_LOST" };
    // Any other failure — including a P2002 from a different constraint — must
    // still surface as a 500 so it stays visible, never silently swallowed.
    throw err;
  }

  return {
    ok: true,
    mealPlanId: target.id,
    clientId: target.clientId,
    weekOf: target.weekOf,
    publishedAt,
    supersededCount,
  };
}
