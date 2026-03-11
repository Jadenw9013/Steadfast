"use server";

import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";
import {
  submitClientIntakeSchema,
  SubmitClientIntakeInput,
} from "@/lib/validations/client-intake";

/**
 * Coach sends a structured intake questionnaire to a specific client.
 * Idempotent — does nothing if one already exists.
 */
export async function sendClientIntake(clientId: string) {
  const coach = await verifyCoachAccessToClient(clientId);

  const existing = await db.clientIntake.findUnique({
    where: { clientId },
  });

  if (existing) {
    return { alreadySent: true };
  }

  await db.clientIntake.create({
    data: {
      coachId: coach.id,
      clientId,
      status: "PENDING",
    },
  });

  revalidatePath(`/coach/clients/${clientId}`);
  return { success: true };
}

/**
 * Coach resends the intake questionnaire to a client.
 * Resets all answer fields and status back to PENDING.
 * This allows the coach to request a fresh intake if needed.
 */
export async function resendClientIntake(clientId: string) {
  const coach = await verifyCoachAccessToClient(clientId);

  await db.clientIntake.upsert({
    where: { clientId },
    update: {
      coachId: coach.id,
      status: "PENDING",
      sentAt: new Date(),
      startedAt: null,
      completedAt: null,
      bodyweightLbs: null,
      heightInches: null,
      ageYears: null,
      gender: null,
      primaryGoal: null,
      targetTimeline: null,
      injuries: null,
      dietaryRestrictions: null,
      dietaryPreferences: null,
      currentDiet: null,
      trainingExperience: null,
      trainingDaysPerWeek: null,
      gymAccess: null,
    },
    create: {
      coachId: coach.id,
      clientId,
      status: "PENDING",
    },
  });

  revalidatePath(`/coach/clients/${clientId}`);
  return { success: true };
}

/**
 * Client marks their intake as started when they open the questionnaire.
 * Sets status to IN_PROGRESS so the coach can see progress.
 * Safe to call multiple times — only transitions from PENDING.
 */
export async function markIntakeStarted() {
  const user = await getCurrentDbUser();
  if (!user.isClient) throw new Error("Unauthorized");

  const intake = await db.clientIntake.findUnique({
    where: { clientId: user.id },
  });

  if (!intake || intake.status !== "PENDING") return;

  await db.clientIntake.update({
    where: { clientId: user.id },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
}

/**
 * Client submits the completed intake questionnaire.
 * Validates all fields before writing. Returns field errors on failure.
 * Intake answers are NOT written to CheckIn — see schema rationale comment.
 */
export async function submitClientIntake(input: SubmitClientIntakeInput) {
  const user = await getCurrentDbUser();
  if (!user.isClient) throw new Error("Unauthorized");

  const parsed = submitClientIntakeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const intake = await db.clientIntake.findUnique({
    where: { clientId: user.id },
  });

  if (!intake) throw new Error("No intake questionnaire found");
  if (intake.status === "COMPLETED") throw new Error("Intake already submitted");

  const d = parsed.data;
  await db.clientIntake.update({
    where: { clientId: user.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      startedAt: intake.startedAt ?? new Date(),
      bodyweightLbs: d.bodyweightLbs,
      heightInches: d.heightInches,
      ageYears: d.ageYears,
      gender: d.gender,
      primaryGoal: d.primaryGoal,
      targetTimeline: d.targetTimeline,
      injuries: d.injuries || null,
      dietaryRestrictions: d.dietaryRestrictions || null,
      dietaryPreferences: d.dietaryPreferences || null,
      currentDiet: d.currentDiet || null,
      trainingExperience: d.trainingExperience,
      trainingDaysPerWeek: d.trainingDaysPerWeek,
      gymAccess: d.gymAccess,
    },
  });

  revalidatePath("/client", "layout");
  return { success: true };
}
