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

  // CB04 / T-880: a PUBLISHED program for this client/week is never a save
  // target, because the client may be reading its exact content right now.
  // This lookup is a plain read (no write, nothing to roll back), so it can
  // stay outside the transaction — only the create below needs to move
  // inside it (finding H).
  const existing = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  // T-880 finding 3 (round 2, finding H): the empty-DRAFT create now runs
  // INSIDE this transaction. It used to run before $transaction opened, so a
  // failure partway through the day rewrite left a bare, empty DRAFT row
  // behind — and getTrainingProgramForReview prefers a DRAFT over a
  // PUBLISHED row for the same week, so the coach's next load showed a blank
  // editor for a week that still has published content. Now a failed save
  // rolls back the create itself; the coach reloads into the unchanged
  // PUBLISHED program instead (release-safety: degrade, never disappear).
  //
  // This requires an interactive transaction rather than the previous
  // batched `$transaction([...])` array form, because the guard below must
  // branch on a prior statement's result (abort before the destructive
  // deleteMany if the updateMany matched zero rows) — an array-form
  // transaction cannot express that. Worst-case round-trip count is 16
  // (optional create + guarded update + deleteMany + up to 14 day creates).
  // Measured locally: exactly that shape (guard + deleteMany + 14 creates)
  // completed in 28ms against local Postgres. Neon's pooled connection adds
  // real network latency per round trip but nowhere near enough to threaten
  // Prisma's default 5000ms interactive timeout even at 10x that
  // measurement, so an explicit 15000ms timeout is applied below purely as
  // headroom against a slow Neon window, not because the measured cost is
  // close to the default.
  const programId = await db.$transaction(
    async (tx) => {
      let id: string;
      if (existing) {
        id = existing.id;
      } else {
        const program = await tx.trainingProgram.create({
          data: { clientId, weekOf, status: "DRAFT" },
          select: { id: true },
        });
        id = program.id;
      }

      // T-880 finding 3: the row above may have been read as DRAFT (or just
      // created as DRAFT), but a concurrent publish (e.g. from iOS) can land
      // between that read and this write. Guard the write itself on
      // status: "DRAFT", and refuse rather than silently rewriting a
      // now-PUBLISHED row's days out from under the client.
      const guarded = await tx.trainingProgram.updateMany({
        where: { id, status: "DRAFT" },
        data: {
          weeklyFrequency: weeklyFrequency ?? null,
          clientNotes: clientNotes ?? null,
          injuries: injuries ?? null,
          equipment: equipment ?? null,
          templateSourceId: templateSourceId ?? null,
        },
      });
      if (guarded.count === 0) {
        throw new Error("TRAINING_PROGRAM_PUBLISHED_DURING_SAVE");
      }

      // Atomically replace all days (cascade deletes blocks)
      await tx.trainingDay.deleteMany({ where: { programId: id } });
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        await tx.trainingDay.create({
          data: {
            programId: id,
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
        });
      }

      return id;
    },
    { timeout: 15000 }
  );

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
