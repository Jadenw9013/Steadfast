"use server";

import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday } from "@/lib/utils/date";
import { revalidatePath } from "next/cache";

const saveExerciseResultSchema = z.object({
  exerciseName: z.string().min(1).max(200),
  programDay: z.string().min(1).max(200),
  weight: z.number().positive().max(9999),
  reps: z.number().int().positive().max(999),
});

/** Client saves their weekly exercise result (weight × reps). */
export async function saveExerciseResult(input: unknown) {
  const parsed = saveExerciseResultSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { exerciseName, programDay, weight, reps } = parsed.data;

  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") throw new Error("Client role required");

  // Verify client has a coach assignment
  const assignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: { id: true },
  });
  if (!assignment) throw new Error("No coach assignment");

  const weekOf = normalizeToMonday(new Date());

  await db.exerciseResult.upsert({
    where: {
      clientId_exerciseName_programDay_setNumber_weekOf: {
        clientId: user.id,
        exerciseName,
        programDay,
        setNumber: 1,
        weekOf,
      },
    },
    create: {
      clientId: user.id,
      exerciseName,
      programDay,
      setNumber: 1,
      weekOf,
      weight,
      reps,
    },
    update: {
      weight,
      reps,
    },
  });

  revalidatePath("/client/training");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true };
}
