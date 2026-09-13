"use server";

import { z } from "zod";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { planModeSchema, setClientPlanModeForCoach } from "@/lib/meal-plans/macro-targets";
import { revalidatePath } from "next/cache";

const setPlanModeSchema = z.object({
  clientId: z.string().min(1),
  mode: planModeSchema,
});

/** Coach switches a client between meal-plan mode and macro-only mode. */
export async function setClientPlanMode(input: unknown) {
  const parsed = setPlanModeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { clientId, mode } = parsed.data;
  const coach = await verifyCoachAccessToClient(clientId);

  await setClientPlanModeForCoach(coach.id, clientId, mode);

  revalidatePath(`/coach/clients/${clientId}`, "layout");
  revalidatePath("/client");
  return { success: true };
}
