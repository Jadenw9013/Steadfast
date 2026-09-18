import { z } from "zod";
import { db } from "@/lib/db";
import type { MealPlanStatus, PlanMode, Prisma } from "@/app/generated/prisma/client";
import { planExtrasSchema } from "@/types/meal-plan-extras";
import { ACTIVE_MEAL_PLAN_ORDER_BY } from "@/lib/meal-plans/active-plan";
import { createMealPlanDraft } from "@/lib/meal-plans/drafts";

/**
 * Single source of truth for meal-plan version history across every
 * transport: the web Server Action (`restoreMealPlanVersion` in
 * `app/actions/meal-plans.ts`) and the three iOS-facing REST routes
 * (`app/api/coach/clients/[clientId]/meal-plan/history/**`,
 * `.../meal-plan/restore`). All four are auth + zod + call + shape-response
 * wrappers with zero business logic (standing rule 1) — T-801.
 *
 * History is PUBLISHED + SUPERSEDED, **never** DRAFT: a DRAFT is work in
 * progress, not a version the client ever saw. Replaces
 * `lib/queries/meal-plans.ts:getMealPlanHistory`, which had zero consumers,
 * excluded SUPERSEDED rows entirely (exactly the rows a coach wants back
 * after a bad publish) and ordered by `publishedAt` alone.
 *
 * Restore never mutates or un-publishes anything. It reads the source version
 * and creates a brand-new DRAFT through T-101's `createMealPlanDraft`, with
 * `startBlank: true` and every field explicit. `startBlank: true` is
 * load-bearing: with `startBlank: false` the draft service would call
 * `findCarryForwardSource` (`lib/meal-plans/drafts.ts`) and any field the
 * source version happens to lack — most importantly `planExtras`
 * (`input.planExtras ?? source?.planExtras`) — would silently fall back to a
 * *different* week's published plan. Nothing in `drafts.ts` or `publish.ts`
 * is touched by this module; it is a caller of the former and never imports
 * the latter.
 *
 * `createDraftFromMealPlanVersion` replaces an existing DRAFT for the target
 * week by **creating the new draft first, then deleting the old one(s)** —
 * never a single transaction (`createMealPlanWithNextVersion` is a retry
 * loop, not a transaction). A crash between the two steps leaves two drafts,
 * which the editor resolves by taking the newest (`orderBy: { createdAt:
 * "desc" }`), never zero. The delete's `where` re-checks `status: "DRAFT"` so
 * a draft published by a concurrent request between the read and the delete
 * is never destroyed.
 *
 * `listMealPlanHistory`'s `currentPublishedMealPlanId` deliberately reuses
 * the exported `ACTIVE_MEAL_PLAN_ORDER_BY` constant — the ordering rule
 * itself — rather than calling `resolveActiveMealPlanId`. That function's
 * mandatory provider gate exists to stop a CLIENT seeing a previous
 * provider's plan; this is a coach-facing read with no client-facing
 * counterpart, so applying that gate here would be wrong, not extra-safe.
 * Coach-facing history is scoped by the `CoachClient` assignment only, NOT by
 * `relationshipStartedAt` — matching every other coach-facing read
 * (`getClientCheckIns`, `getEffectiveMealPlanForReview`) and matching
 * `findCarryForwardSource`, which already seeds a new coach's first draft
 * from a previous coach's published plan.
 *
 * Retention: kept forever. No pruning, no cron, no TTL — the rows are small
 * and `lib/account-deletion/purge.ts` already deletes `MealPlan` /
 * `MealPlanItem` / `MealMacroTarget` by `clientId` with no status filter, so
 * PUBLISHED, SUPERSEDED and DRAFT rows all go on account deletion. No new
 * table, so no new purge line.
 *
 * No network I/O anywhere in this module. No `revalidatePath` — that stays in
 * the Server Action.
 */

/** The two statuses that are "history". DRAFT is never listed: an unpublished
 *  draft is work in progress, not a version the client ever saw. */
export const MEAL_PLAN_HISTORY_STATUSES = ["PUBLISHED", "SUPERSEDED"] as const;

export const MEAL_PLAN_HISTORY_DEFAULT_LIMIT = 50;
export const MEAL_PLAN_HISTORY_MAX_LIMIT = 100;

/** Shared by the REST route's query string and the web page's searchParams so
 *  the two can never disagree on defaults or bounds. Exported for unit test. */
export const mealPlanHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MEAL_PLAN_HISTORY_MAX_LIMIT)
    .default(MEAL_PLAN_HISTORY_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type MealPlanHistoryItem = {
  id: string;
  weekOf: Date;
  version: number;
  status: "PUBLISHED" | "SUPERSEDED";
  publishedAt: Date | null;
  planMode: PlanMode;
  itemCount: number;
  macroTargetCount: number;
  hasPlanNotes: boolean;
  /** A DRAFT row exists for this item's week. Drives the restore confirm
   *  wording on both surfaces so neither has to guess. */
  weekHasDraft: boolean;
};

export type MealPlanHistoryPage = {
  items: MealPlanHistoryItem[];
  total: number;
  limit: number;
  offset: number;
  /** The plan the client is actually on right now, or null. */
  currentPublishedMealPlanId: string | null;
};

/** Callers MUST have authorized coach access to `clientId` first. */
export async function listMealPlanHistory(args: {
  clientId: string;
  limit?: number;
  offset?: number;
}): Promise<MealPlanHistoryPage> {
  const { clientId } = args;
  const limit = args.limit ?? MEAL_PLAN_HISTORY_DEFAULT_LIMIT;
  const offset = args.offset ?? 0;
  const where = { clientId, status: { in: [...MEAL_PLAN_HISTORY_STATUSES] } };

  const [rows, total, current] = await Promise.all([
    db.mealPlan.findMany({
      where,
      orderBy: [
        { weekOf: "desc" },
        { publishedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
        { version: "desc" },
      ],
      skip: offset,
      take: limit,
      select: {
        id: true, weekOf: true, version: true, status: true, publishedAt: true,
        planMode: true, supportContent: true,
        _count: { select: { items: true, macroTargets: true } },
      },
    }),
    db.mealPlan.count({ where }),
    // Coach-facing "which one is the client on right now". Deliberately reuses
    // the exported ordering constant from lib/meal-plans/active-plan.ts — the
    // rule itself — instead of restating it, and deliberately does NOT go through
    // resolveActiveMealPlanId: that function's provider gate exists to stop a
    // CLIENT seeing a previous provider's plan, and its `undefined` arm is
    // documented as legacy-only. See the file header, "Provider awareness".
    db.mealPlan.findFirst({
      where: { clientId, status: "PUBLISHED" },
      orderBy: ACTIVE_MEAL_PLAN_ORDER_BY,
      select: { id: true },
    }),
  ]);

  const weeks = [...new Set(rows.map((r) => r.weekOf.getTime()))].map((t) => new Date(t));
  const draftWeeks = weeks.length
    ? await db.mealPlan.findMany({
        where: { clientId, status: "DRAFT", weekOf: { in: weeks } },
        select: { weekOf: true },
      })
    : [];
  const draftWeekSet = new Set(draftWeeks.map((d) => d.weekOf.getTime()));

  return {
    items: rows.map((row) => ({
      id: row.id,
      weekOf: row.weekOf,
      version: row.version,
      // `where.status` bounds this to PUBLISHED | SUPERSEDED.
      status: row.status as "PUBLISHED" | "SUPERSEDED",
      publishedAt: row.publishedAt,
      planMode: row.planMode,
      itemCount: row._count.items,
      macroTargetCount: row._count.macroTargets,
      hasPlanNotes: (row.supportContent ?? "").trim().length > 0,
      weekHasDraft: draftWeekSet.has(row.weekOf.getTime()),
    })),
    total,
    limit,
    offset,
    currentPublishedMealPlanId: current?.id ?? null,
  };
}

/** Does this client have a DRAFT meal plan for this week? Drives the restore
 *  confirm wording on both surfaces. Callers MUST have authorized coach access
 *  to `clientId` first. */
export async function hasDraftForWeek(clientId: string, weekOf: Date): Promise<boolean> {
  return (await db.mealPlan.count({ where: { clientId, weekOf, status: "DRAFT" } })) > 0;
}

const versionDetailItemSelect = {
  id: true,
  mealName: true,
  sortOrder: true,
  foodName: true,
  quantity: true,
  unit: true,
  servingDescription: true,
  calories: true,
  protein: true,
  carbs: true,
  fats: true,
} as const;

const versionDetailMacroTargetSelect = {
  id: true,
  mealName: true,
  sortOrder: true,
  calories: true,
  protein: true,
  carbs: true,
  fats: true,
} as const;

export type MealPlanVersionDetail = {
  id: string;
  clientId: string;
  weekOf: Date;
  version: number;
  status: MealPlanStatus;
  planMode: PlanMode;
  publishedAt: Date | null;
  supportContent: string | null;
  planExtras: Prisma.JsonValue | null;
  items: {
    id: string; mealName: string; sortOrder: number; foodName: string;
    quantity: string; unit: string; servingDescription: string | null;
    calories: number; protein: number; carbs: number; fats: number;
  }[];
  macroTargets: {
    id: string; mealName: string; sortOrder: number;
    calories: number; protein: number; carbs: number; fats: number;
  }[];
};

/** Reads the row both surfaces need BEFORE their own authorization check.
 *  Returns null when the plan does not exist. Performs no authorization —
 *  same split as `getMealPlanSaveTarget` (drafts.ts) and
 *  `getMealPlanPublishTarget` (publish.ts). `clientId` is returned precisely
 *  so every caller can compare it against the URL segment. */
export async function getMealPlanVersionDetail(
  mealPlanId: string
): Promise<MealPlanVersionDetail | null> {
  return db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: {
      id: true,
      clientId: true,
      weekOf: true,
      version: true,
      status: true,
      planMode: true,
      publishedAt: true,
      supportContent: true,
      planExtras: true,
      items: { orderBy: { sortOrder: "asc" }, select: versionDetailItemSelect },
      macroTargets: { orderBy: { sortOrder: "asc" }, select: versionDetailMacroTargetSelect },
    },
  });
}

export type RestoreMealPlanVersionResult =
  | { ok: true; draftMealPlanId: string; weekOf: Date; replacedDraftIds: string[] }
  | { ok: false; code: "SOURCE_NOT_RESTORABLE"; status: MealPlanStatus }
  | { ok: false; code: "DRAFT_EXISTS"; existingDraftId: string };

/** The single copy of each user-facing sentence, all three transports call it.
 *  Both are well under the 300-char cutoff in iOS `userFacingErrorMessage`
 *  (APIService.swift), which returns the `error` key verbatim. */
export function sourceNotRestorableMessage(): string {
  return "Only published plan versions can be restored.";
}

export function draftExistsMessage(): string {
  return "This week already has a draft. Restoring will replace it.";
}

/** Named for what it does, not for the button that calls it, so the Server
 *  Action can be called `restoreMealPlanVersion` with no import alias.
 *  Callers MUST have authorized coach access to `source.clientId` first. */
export async function createDraftFromMealPlanVersion(args: {
  source: MealPlanVersionDetail;
  /** Already-authorized coach. Passed straight through to createMealPlanDraft. */
  coachId: string;
  /** Already parsed by parseWeekStartDate. Defaults to `source.weekOf`. */
  weekOf?: Date;
  replaceExistingDraft?: boolean;
}): Promise<RestoreMealPlanVersionResult> {
  const { source } = args;

  if (source.status !== "PUBLISHED" && source.status !== "SUPERSEDED") {
    return { ok: false, code: "SOURCE_NOT_RESTORABLE", status: source.status };
  }

  const targetWeekOf = args.weekOf ?? source.weekOf;

  const existingDrafts = await db.mealPlan.findMany({
    where: { clientId: source.clientId, weekOf: targetWeekOf, status: "DRAFT" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  if (existingDrafts.length > 0 && !args.replaceExistingDraft) {
    return { ok: false, code: "DRAFT_EXISTS", existingDraftId: existingDrafts[0].id };
  }

  // Create through T-101, `startBlank: true` and every field explicit —
  // content comes ONLY from `source`; no carry-forward lookup. See the file
  // header and Risk 1 in the T-801 spec.
  const parsed = source.planExtras ? planExtrasSchema.safeParse(source.planExtras) : null;
  const { mealPlanId } = await createMealPlanDraft({
    clientId: source.clientId,
    coachId: args.coachId,
    weekOf: targetWeekOf,
    startBlank: true,
    planMode: source.planMode, // the SOURCE's mode, not CoachClient.planMode — see Risk 3
    items: source.items.map((i) => ({
      mealName: i.mealName, sortOrder: i.sortOrder, foodName: i.foodName,
      quantity: i.quantity, unit: i.unit,
      servingDescription: i.servingDescription ?? undefined,
      calories: i.calories, protein: i.protein, carbs: i.carbs, fats: i.fats,
    })),
    macroTargets: source.macroTargets.map((t) => ({
      mealName: t.mealName, sortOrder: t.sortOrder,
      calories: t.calories, protein: t.protein, carbs: t.carbs, fats: t.fats,
    })),
    planExtras: parsed?.success ? parsed.data : undefined,
    supportContent: source.supportContent, // null is meaningful: leaves the column null
  });

  // Create first, delete second. Never one transaction — see the file header.
  const replacedDraftIds = existingDrafts.map((d) => d.id);
  if (replacedDraftIds.length > 0) {
    const deleted = await db.mealPlan.deleteMany({
      where: {
        id: { in: replacedDraftIds },
        clientId: source.clientId,
        weekOf: targetWeekOf,
        status: "DRAFT",
      },
    });
    // `status: "DRAFT"` is re-checked in the filter so a draft a concurrent
    // request published between the read above and here is never deleted.
    if (deleted.count !== replacedDraftIds.length) {
      // Nothing to undo: the new draft already exists and is correct either
      // way. A row that stopped being a DRAFT simply survives untouched.
    }
  }

  return { ok: true, draftMealPlanId: mealPlanId, weekOf: targetWeekOf, replacedDraftIds };
}
