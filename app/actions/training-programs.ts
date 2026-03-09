"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";

const BLOCK_TYPES = ["EXERCISE", "ACTIVATION", "INSTRUCTION", "SUPERSET", "CARDIO", "OPTIONAL"] as const;

const blockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  title: z.string().max(200).default(""),
  content: z.string().max(5000).default(""),
});

const daySchema = z.object({
  dayName: z.string().min(1).max(100),
  blocks: z.array(blockSchema).max(50).default([]),
});

const saveSchema = z.object({
  clientId: z.string().min(1),
  weekStartDate: z.string().min(1),
  days: z.array(daySchema).max(14),
  weeklyFrequency: z.coerce.number().int().min(1).max(7).optional(),
  clientNotes: z.string().max(1000).optional(),
  injuries: z.string().max(500).optional(),
  equipment: z.string().max(500).optional(),
  templateSourceId: z.string().optional(),
});

export async function saveTrainingProgram(input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    console.error("[saveTrainingProgram] Zod error:", JSON.stringify(parsed.error.flatten().fieldErrors));
    return { error: parsed.error.flatten().fieldErrors };
  }
  console.log("[saveTrainingProgram] days count:", parsed.data.days.length, "names:", parsed.data.days.map(d => d.dayName));

  const {
    clientId,
    weekStartDate,
    days,
    weeklyFrequency,
    clientNotes,
    injuries,
    equipment,
    templateSourceId,
  } = parsed.data;
  await verifyCoachAccessToClient(clientId);

  const weekOf = parseWeekStartDate(weekStartDate);

  const existing = await db.trainingProgram.findFirst({
    where: { clientId, weekOf },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  let programId: string;
  if (existing) {
    programId = existing.id;
    await db.trainingProgram.update({
      where: { id: programId },
      data: {
        status: "DRAFT",
        weeklyFrequency: weeklyFrequency ?? null,
        clientNotes: clientNotes ?? null,
        injuries: injuries ?? null,
        equipment: equipment ?? null,
        templateSourceId: templateSourceId ?? null,
      },
    });
  } else {
    const program = await db.trainingProgram.create({
      data: {
        clientId,
        weekOf,
        status: "DRAFT",
        weeklyFrequency: weeklyFrequency ?? null,
        clientNotes: clientNotes ?? null,
        injuries: injuries ?? null,
        equipment: equipment ?? null,
        templateSourceId: templateSourceId ?? null,
      },
      select: { id: true },
    });
    programId = program.id;
  }

  // Atomically replace all days (cascade deletes blocks)
  await db.$transaction([
    db.trainingDay.deleteMany({ where: { programId } }),
    ...days.map((day, i) =>
      db.trainingDay.create({
        data: {
          programId,
          dayName: day.dayName,
          sortOrder: i,
          blocks: {
            create: day.blocks.map((b, j) => ({
              type: b.type,
              title: b.title,
              content: b.content,
              sortOrder: j,
            })),
          },
        },
      })
    ),
  ]);

  revalidatePath("/coach", "layout");
  return { programId };
}

const publishSchema = z.object({
  programId: z.string().min(1),
});

export async function publishTrainingProgram(input: unknown) {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const program = await db.trainingProgram.findUnique({
    where: { id: parsed.data.programId },
    select: { clientId: true, status: true },
  });
  if (!program) throw new Error("Training program not found");

  await verifyCoachAccessToClient(program.clientId);

  await db.trainingProgram.update({
    where: { id: parsed.data.programId },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");
  return { success: true };
}
