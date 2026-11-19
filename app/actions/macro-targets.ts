"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { checkMealPlanWriter } from "@/lib/meal-plans/writer-gate";
import { revalidatePath } from "next/cache";

const upsertMacroSchema = z.object({
  clientId: z.string().min(1),
  weekStartDate: z.string().min(1),
  calories: z.coerce.number().int().min(0),
  protein: z.coerce.number().int().min(0),
  carbs: z.coerce.number().int().min(0),
  fats: z.coerce.number().int().min(0),
});

export async function upsertMacroTarget(input: unknown) {
  const parsed = upsertMacroSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { clientId, weekStartDate, calories, protein, carbs, fats } =
    parsed.data;

  const coach = await verifyCoachAccessToClient(clientId);
  const writer = await checkMealPlanWriter(coach.id, clientId);
  if (!writer.ok) return writer;

  const weekOf = parseWeekStartDate(weekStartDate);

  await db.macroTarget.upsert({
    where: { clientId_weekOf: { clientId, weekOf } },
    update: { calories, protein, carbs, fats },
    create: { clientId, weekOf, calories, protein, carbs, fats },
  });

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");

  return { success: true };
}
