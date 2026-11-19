import { NextResponse } from "next/server";
import { getClientProvider } from "@/lib/queries/client-provider";
import { db } from "@/lib/db";
import { isCurrentCoachInTransaction } from "@/lib/coach-client/write-access";
import {
  MEAL_PLAN_NOT_CURRENT_PROVIDER,
  mealPlanWriterRefusalMessage,
  type MealPlanWriterRefusal,
  type MealPlanWriterRefusalReason,
} from "@/lib/meal-plans/writer-gate-messages";

/**
 * T-2996 / T-2950: only the client's current provider may write a meal-plan draft.
 * Callers have already verified the coach is assigned to the client; this adds the
 * "and is the current provider" half. Provider resolution stays in getClientProvider.
 * If getClientProvider throws, the error propagates (never fails open).
 */
export type MealPlanWriterCheck = { ok: true } | MealPlanWriterRefusal;

function refuse(reason: MealPlanWriterRefusalReason): MealPlanWriterRefusal {
  return {
    ok: false,
    code: MEAL_PLAN_NOT_CURRENT_PROVIDER,
    reason,
    error: mealPlanWriterRefusalMessage(reason),
  };
}

export async function checkMealPlanWriter(
  coachId: string,
  clientId: string
): Promise<MealPlanWriterCheck> {
  const p = await getClientProvider(clientId);
  if (p.coachId === coachId && await db.$transaction((tx) => isCurrentCoachInTransaction(tx, coachId, clientId))) return { ok: true };
  if (p.resolutionRequired || p.origin === "NONE" || (p.origin === "HUMAN" && p.coachId === null)) {
    return refuse("UNRESOLVED");
  }
  return refuse("OTHER_PROVIDER");
}

/** REST mapping so the gated routes cannot drift. */
export function mealPlanWriterRefusalResponse(r: MealPlanWriterRefusal): NextResponse {
  return NextResponse.json({ error: r.error, code: r.code, reason: r.reason }, { status: 403 });
}
