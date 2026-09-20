import { Prisma } from "@/app/generated/prisma/client";
import type { MealPlanStatus } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { checkPlanPublishable } from "@/lib/meal-plans/publish-guard";

/**
 * Single source of truth for both coach meal-plan publish transports: the
 * `publishMealPlan` Server Action and the iOS-facing
 * `/api/coach/clients/[clientId]/meal-plan/publish` route (CB04).
 *
 * Supersede is scoped to `(clientId, weekOf)`. The partial unique index permits
 * one PUBLISHED meal plan per client and week, so publishing a revision must
 * demote only the previous plan for that same week.
 *
 * The supersede and DRAFT-to-PUBLISHED flip share one transaction. If the flip
 * loses a race, throwing inside the transaction rolls the supersede back so the
 * client is never left with zero published plans for the week.
 */

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
  | { ok: false; code: "EMPTY_PLAN"; message: string }
  | { ok: false; code: "RACE_LOST" };

/** Reads the publish target before the caller performs its authorization check. */
export async function getMealPlanPublishTarget(
  mealPlanId: string
): Promise<MealPlanPublishTarget | null> {
  return db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: { id: true, clientId: true, weekOf: true, status: true },
  });
}

function targetMentionsIndex(target: unknown): boolean {
  if (typeof target === "string") return target.includes(PUBLISHED_MEAL_PLAN_INDEX);
  if (Array.isArray(target)) {
    return target.some(
      (entry) =>
        typeof entry === "string" && entry.includes(PUBLISHED_MEAL_PLAN_INDEX)
    );
  }
  return false;
}

/** True only for a P2002 raised by the published-plan partial unique index. */
export function isDuplicatePublishedPlanError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  let metaMentionsIndex = false;
  try {
    const meta = error.meta as Record<string, unknown> | undefined;
    const cause = (
      meta?.driverAdapterError as
        | { cause?: { originalMessage?: unknown } }
        | undefined
    )?.cause;
    metaMentionsIndex =
      String(cause?.originalMessage ?? "").includes(PUBLISHED_MEAL_PLAN_INDEX) ||
      targetMentionsIndex(meta?.target);
  } catch {
    metaMentionsIndex = false;
  }

  return metaMentionsIndex || error.message.includes(PUBLISHED_MEAL_PLAN_INDEX);
}

class RaceLost extends Error {
  constructor() {
    super("meal plan publish race lost");
    this.name = "RaceLost";
  }
}

/**
 * Publishes an authorized target. Callers must verify coach access to
 * `target.clientId` before calling this function.
 */
export async function publishMealPlanTarget(
  target: MealPlanPublishTarget,
  options?: { now?: Date }
): Promise<PublishMealPlanResult> {
  if (target.status !== "DRAFT") {
    return { ok: false, code: "NOT_DRAFT", status: target.status };
  }

  const publishGuard = await checkPlanPublishable(target.id);
  if (!publishGuard.ok) {
    // T-952a: sprint-1 mode-disagreement anomaly reporting is stripped from this hotfix.
    return { ok: false, code: "EMPTY_PLAN", message: publishGuard.message };
  }

  const publishedAt = options?.now ?? new Date();

  let supersededCount: number;
  try {
    supersededCount = await db.$transaction(async (transaction) => {
      // schema.prisma now mirrors production's already-deployed SUPERSEDED
      // enum value, so Prisma validates this write and subsequent reads alike.
      const superseded = await transaction.mealPlan.updateMany({
        where: {
          clientId: target.clientId,
          weekOf: target.weekOf,
          status: "PUBLISHED",
          id: { not: target.id },
        },
        data: { status: "SUPERSEDED" },
      });

      const flipped = await transaction.mealPlan.updateMany({
        where: { id: target.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt },
      });

      if (flipped.count === 0) throw new RaceLost();
      return superseded.count;
    });
  } catch (error) {
    if (error instanceof RaceLost) return { ok: false, code: "RACE_LOST" };
    if (isDuplicatePublishedPlanError(error)) {
      return { ok: false, code: "RACE_LOST" };
    }
    throw error;
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
