"use server";

import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday, getLocalDate } from "@/lib/utils/date";
import { revalidatePath } from "next/cache";

const saveExerciseResultSchema = z.object({
  exerciseName: z.string().min(1).max(200),
  programDay: z.string().min(1).max(200),
  setNumber: z.number().int().positive().max(99).default(1),
  weight: z.number().positive().max(9999),
  reps: z.number().int().positive().max(999),
});

/** Client saves their weekly exercise result (weight × reps). */
export async function saveExerciseResult(input: unknown) {
  const parsed = saveExerciseResultSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { exerciseName, programDay, setNumber, weight, reps } = parsed.data;

  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") throw new Error("Client role required");

  const assignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: { id: true },
  });
  if (!assignment) throw new Error("No coach assignment");

  const now = new Date();
  const weekOf = normalizeToMonday(now);
  // CB08: uniqueness is keyed on the actual calendar day this session
  // happened, not the week — a program day repeated more than once in the
  // same week (an ordinary training pattern) must not collide with and
  // silently overwrite an earlier session's recorded weight/reps.
  const sessionDate = getLocalDate(now, user.timezone || "America/Los_Angeles");

  const result = await db.exerciseResult.upsert({
    where: {
      clientId_exerciseName_programDay_setNumber_sessionDate: {
        clientId: user.id,
        exerciseName,
        programDay,
        setNumber,
        sessionDate,
      },
    },
    create: {
      clientId: user.id,
      exerciseName,
      programDay,
      setNumber,
      weekOf,
      sessionDate,
      weight,
      reps,
    },
    update: {
      weight,
      reps,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  revalidatePath("/client/training");
  revalidatePath("/client/plan");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true, id: result.id, createdAt: result.createdAt.toISOString() };
}

/** Delete a single exercise result by ID. */
export async function deleteExerciseResult(resultId: string) {
  if (!resultId) return { error: "Missing result ID" };

  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") throw new Error("Client role required");

  const existing = await db.exerciseResult.findUnique({
    where: { id: resultId },
    select: { clientId: true },
  });
  if (!existing || existing.clientId !== user.id) {
    return { error: "Not found" };
  }

  await db.exerciseResult.delete({ where: { id: resultId } });

  revalidatePath("/client/training");
  revalidatePath("/client/plan");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true };
}

/** Clear all exercise results for a specific exercise this week. */
export async function clearExerciseHistory(exerciseName: string) {
  if (!exerciseName) return { error: "Missing exercise name" };

  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") throw new Error("Client role required");

  const weekOf = normalizeToMonday(new Date());

  const deleted = await db.exerciseResult.deleteMany({
    where: {
      clientId: user.id,
      exerciseName,
      weekOf,
    },
  });

  revalidatePath("/client/training");
  revalidatePath("/client/plan");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true, deleted: deleted.count };
}
