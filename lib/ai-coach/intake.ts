import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * A03 — staged, confirmed intake.
 *
 * *** SYNTHETIC FIXTURE SCHEMA ***
 * The fields below are a reasonable placeholder structure for engineering
 * purposes, not an approved intake instrument. The actual required-input
 * mapping for a personalized numerical prescription is G01's deliverable
 * (docs/ai-coach/13). Height/weight are optional here specifically
 * because a missing calculation input must leave personalized nutrition
 * pending rather than inventing a default (docs/ai-coach/06 §4).
 */

export const intakeAnswersSchema = z.object({
  goal: z.enum(["GENERAL_FITNESS", "STRENGTH", "ENDURANCE", "BODY_COMPOSITION"]),
  experienceLevel: z.enum(["NEW", "RETURNING", "EXPERIENCED"]),
  trainingDaysPerWeek: z.number().int().min(1).max(7),
  equipmentAccess: z.array(z.enum(["NONE", "HOME_BASIC", "FULL_GYM"])).min(1),
  dietaryRestrictions: z.array(z.string().max(100)).max(20),
  allergies: z.array(z.string().max(100)).max(20),
  foodBudgetLevel: z.enum(["LOW", "MODERATE", "FLEXIBLE"]),
  trackingPreference: z.enum(["NUMBERS_VISIBLE", "PORTIONS_ONLY"]),
  unitsPreference: z.enum(["METRIC", "IMPERIAL"]),
  // Calculation inputs — optional. Absent means personalized nutrition
  // stays pending; it is never inferred from name/appearance/gender string.
  heightCm: z.number().positive().max(300).optional(),
  weightKg: z.number().positive().max(400).optional(),
}).strict();
export type IntakeAnswers = z.infer<typeof intakeAnswersSchema>;

const intakeDraftSchema = intakeAnswersSchema.partial();
export type IntakeDraftAnswers = z.infer<typeof intakeDraftSchema>;

export type SaveIntakeDraftResult =
  | { success: true; answers: IntakeDraftAnswers }
  | { success: false; error: Record<string, string[]> };

/** Merges partial answers into the existing draft. Never requires completeness. */
export async function saveIntakeDraft(clientId: string, rawPartialAnswers: unknown): Promise<SaveIntakeDraftResult> {
  const parsed = intakeDraftSchema.safeParse(rawPartialAnswers);
  if (!parsed.success) {
    return { success: false, error: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.aiIntakeDraft.findUnique({ where: { clientId } });
  const merged = { ...(existing?.answers as IntakeDraftAnswers | undefined), ...parsed.data };

  await db.aiIntakeDraft.upsert({
    where: { clientId },
    create: { clientId, answers: merged as Prisma.InputJsonValue },
    update: { answers: merged as Prisma.InputJsonValue },
  });

  return { success: true, answers: merged };
}

export async function getIntakeDraft(clientId: string): Promise<IntakeDraftAnswers | null> {
  const draft = await db.aiIntakeDraft.findUnique({ where: { clientId } });
  return (draft?.answers as IntakeDraftAnswers | undefined) ?? null;
}

export type ConfirmIntakeResult =
  | { success: true; profileRevision: number }
  | { success: false; error: Record<string, string[]> | string };

/**
 * Confirms a complete intake — the only path that writes
 * AiCoachProfile.confirmedIntake and bumps profileRevision. The draft row
 * is removed once confirmed (it is no longer a draft, and keeping a stale
 * copy around risks it being read as if still pending).
 */
export async function confirmIntake(clientId: string, rawAnswers: unknown): Promise<ConfirmIntakeResult> {
  const parsed = intakeAnswersSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    return { success: false, error: parsed.error.flatten().fieldErrors };
  }

  const profile = await db.$transaction(async (tx) => {
    const updated = await tx.aiCoachProfile.upsert({
      where: { clientId },
      create: { clientId, confirmedIntake: parsed.data as unknown as Prisma.InputJsonValue, profileRevision: 1, consentedAt: new Date() },
      update: { confirmedIntake: parsed.data as unknown as Prisma.InputJsonValue, profileRevision: { increment: 1 } },
    });
    await tx.aiIntakeDraft.deleteMany({ where: { clientId } });
    return updated;
  });

  return { success: true, profileRevision: profile.profileRevision };
}
