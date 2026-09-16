import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Shared macro-target logic for MACROS-mode meal plans.
 *
 * Both the web Server Action (app/actions/meal-plans.ts) and the iOS-facing
 * REST route (app/api/coach/clients/[clientId]/meal-plan/route.ts) call these
 * — do not re-implement this logic in either place. This codebase's biggest
 * recurring bug class is exactly that: the same CRUD logic drifting apart
 * between the web and iOS surfaces (see the 2026-09-09 security review).
 */

export const mealMacroTargetSchema = z.object({
  mealName: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  calories: z.coerce.number().int().min(0).max(20000).default(0),
  protein: z.coerce.number().int().min(0).max(2000).default(0),
  carbs: z.coerce.number().int().min(0).max(2000).default(0),
  fats: z.coerce.number().int().min(0).max(2000).default(0),
});

export type MealMacroTargetInput = z.infer<typeof mealMacroTargetSchema>;

export const planModeSchema = z.enum(["MEAL_PLAN", "MACROS"]);
export type PlanModeInput = z.infer<typeof planModeSchema>;

/** Delete-then-recreate ops for a plan's macro targets — splice into the same
 *  $transaction array as the item replace-all so a save can't leave items and
 *  macro targets inconsistent. Mirrors saveDraftMealPlan's item-replace pattern. */
export function macroTargetTransactionOps(
  mealPlanId: string,
  targets: MealMacroTargetInput[]
): Prisma.PrismaPromise<unknown>[] {
  return [
    db.mealMacroTarget.deleteMany({ where: { mealPlanId } }),
    ...targets.map((t, i) =>
      db.mealMacroTarget.create({
        data: {
          mealPlanId,
          mealName: t.mealName,
          sortOrder: i,
          calories: t.calories,
          protein: t.protein,
          carbs: t.carbs,
          fats: t.fats,
        },
      })
    ),
  ];
}

/** `resolveDefaultPlanMode` moved to `lib/meal-plans/plan-mode.ts` (T-102a) —
 *  it is a plan-mode read, not macro-target logic, and it reads the same
 *  `CoachClient.planMode` column the editor-mode rule needs. */

/** Coach sets a client's persistent default plan mode. Caller must have
 *  already verified coach ownership of this client (verifyCoachAccessToClient).
 *
 *  Also updates the client's current DRAFT plan (if one exists) to match, so
 *  a coach mid-edit sees the switch take effect immediately — but PUBLISHED
 *  plans are never touched here; a client already viewing a published week
 *  keeps seeing exactly what was published, per plan §2. */
export async function setClientPlanModeForCoach(
  coachId: string,
  clientId: string,
  mode: PlanModeInput
): Promise<void> {
  await db.$transaction([
    db.coachClient.update({
      where: { coachId_clientId: { coachId, clientId } },
      data: { planMode: mode },
    }),
    db.mealPlan.updateMany({
      where: { clientId, status: "DRAFT" },
      data: { planMode: mode },
    }),
  ]);
}
