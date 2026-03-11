"use server";

import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";

// ── Schemas ──────────────────────────────────────────────────────────────────

const setAdherenceEnabledSchema = z.object({
  clientId: z.string().min(1),
  enabled: z.boolean(),
});

const toggleWorkoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.boolean(),
});

const toggleMealCheckoffSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealNameSnapshot: z.string().min(1).max(100),
  displayOrder: z.number().int().min(0),
  completed: z.boolean(),
});

const toggleExerciseCheckoffSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayLabel: z.string().min(1).max(200),
  exerciseName: z.string().min(1).max(200),
  exerciseOrder: z.number().int().min(0),
  completed: z.boolean(),
});

// ── Coach Actions ─────────────────────────────────────────────────────────────

/** Coach enables or disables daily adherence tracking for a client. */
export async function setAdherenceEnabled(input: unknown) {
  const parsed = setAdherenceEnabledSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { clientId, enabled } = parsed.data;

  // Verify coach owns this client assignment
  const coach = await verifyCoachAccessToClient(clientId);

  await db.coachClient.update({
    where: { coachId_clientId: { coachId: coach.id, clientId } },
    data: { adherenceEnabled: enabled },
  });

  revalidatePath(`/coach/clients/${clientId}`);
  revalidatePath("/client");
  return { success: true };
}

// ── Client Actions ────────────────────────────────────────────────────────────

/** Ensure client role + coach assignment, return client user. */
async function verifyClientAdherenceAccess() {
  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") throw new Error("Client role required");

  const assignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: { id: true },
  });
  if (!assignment) throw new Error("No coach assignment");

  return user;
}

/** Upsert the DailyAdherence record for a given date, return its id. */
async function upsertDailyAdherence(clientId: string, date: string): Promise<string> {
  const weekOf = normalizeToMonday(new Date(date + "T12:00:00Z"));
  const record = await db.dailyAdherence.upsert({
    where: { clientId_date: { clientId, date } },
    create: { clientId, date, weekOf },
    update: {},
    select: { id: true },
  });
  return record.id;
}

/** Client marks workout complete or incomplete for a given day. */
export async function toggleWorkoutComplete(input: unknown) {
  const parsed = toggleWorkoutSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { date, completed } = parsed.data;
  const user = await verifyClientAdherenceAccess();

  const adherenceId = await upsertDailyAdherence(user.id, date);

  await db.dailyAdherence.update({
    where: { id: adherenceId },
    data: {
      workoutCompleted: completed,
      workoutCompletedAt: completed ? new Date() : null,
    },
  });

  revalidatePath("/client");
  revalidatePath("/client/training");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true };
}

/** Client toggles a meal checkoff for a given day. */
export async function toggleMealCheckoff(input: unknown) {
  const parsed = toggleMealCheckoffSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { date, mealNameSnapshot, displayOrder, completed } = parsed.data;
  const user = await verifyClientAdherenceAccess();

  const adherenceId = await upsertDailyAdherence(user.id, date);

  await db.dailyMealCheckoff.upsert({
    where: {
      dailyAdherenceId_mealNameSnapshot: { dailyAdherenceId: adherenceId, mealNameSnapshot },
    },
    create: {
      dailyAdherenceId: adherenceId,
      mealNameSnapshot,
      displayOrder,
      completed,
      completedAt: completed ? new Date() : null,
    },
    update: {
      completed,
      completedAt: completed ? new Date() : null,
    },
  });

  revalidatePath("/client");
  revalidatePath("/client/meal-plan");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true };
}

/** Client toggles an exercise checkoff for a given day. */
export async function toggleExerciseCheckoff(input: unknown) {
  const parsed = toggleExerciseCheckoffSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { date, dayLabel, exerciseName, exerciseOrder, completed } = parsed.data;
  const user = await verifyClientAdherenceAccess();

  const adherenceId = await upsertDailyAdherence(user.id, date);

  await db.exerciseCheckoff.upsert({
    where: {
      dailyAdherenceId_dayLabel_exerciseOrder: {
        dailyAdherenceId: adherenceId,
        dayLabel,
        exerciseOrder,
      },
    },
    create: {
      dailyAdherenceId: adherenceId,
      dayLabel,
      exerciseName,
      exerciseOrder,
      completed,
      completedAt: completed ? new Date() : null,
    },
    update: {
      completed,
      completedAt: completed ? new Date() : null,
    },
  });

  revalidatePath("/client");
  revalidatePath("/client/training");
  revalidatePath(`/coach/clients/${user.id}`);
  return { success: true };
}
