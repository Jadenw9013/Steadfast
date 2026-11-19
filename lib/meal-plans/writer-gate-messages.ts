/**
 * T-2996 / T-2950: copy and types for the meal-plan writer gate.
 *
 * PROPOSED copy, engineering proposal, no external source. Plain text, under 300
 * characters, no HTML (iOS `userFacingErrorMessage` passes it through). Not clinical content.
 *
 * Pure: no db/prisma/server imports, so the two coach editors (client components)
 * can import it. The server check lives in ./writer-gate.ts.
 */

export const MEAL_PLAN_NOT_CURRENT_PROVIDER = "NOT_CURRENT_PROVIDER" as const;

export type MealPlanWriterRefusalReason = "OTHER_PROVIDER" | "UNRESOLVED";

export type MealPlanWriterRefusal = {
  ok: false;
  code: typeof MEAL_PLAN_NOT_CURRENT_PROVIDER;
  reason: MealPlanWriterRefusalReason;
  error: string;
};

export const OTHER_PROVIDER_MESSAGE = "Only this client's current coach can change their plans.";
export const UNRESOLVED_PROVIDER_MESSAGE =
  "This client's coaching setup needs to be resolved before their plans can be changed.";

export function mealPlanWriterRefusalMessage(reason: MealPlanWriterRefusalReason): string {
  return reason === "UNRESOLVED" ? UNRESOLVED_PROVIDER_MESSAGE : OTHER_PROVIDER_MESSAGE;
}

export function isMealPlanWriterRefusal(v: unknown): v is MealPlanWriterRefusal {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.code === MEAL_PLAN_NOT_CURRENT_PROVIDER &&
    typeof r.error === "string" &&
    (r.reason === "OTHER_PROVIDER" || r.reason === "UNRESOLVED")
  );
}
