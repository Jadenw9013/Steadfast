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

  // CB05: only ever continue editing an existing DRAFT. A PUBLISHED or
  // SUPERSEDED program for this client/week is never demoted or mutated —
  // that previously let a save silently flip a client's live program back
  // to DRAFT (and overwrite its content) mid-edit. Editing one instead
  // creates a brand-new draft.
  const existing = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    select: { id: true },
  });

  const metadata = {
    weeklyFrequency: weeklyFrequency ?? null,
    clientNotes: clientNotes ?? null,
    injuries: injuries ?? null,
    equipment: equipment ?? null,
    templateSourceId: templateSourceId ?? null,
  };
  const dayCreateOps = (programId: string) =>
    days.map((day, i) =>
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
    );

  let programId: string;
  if (existing) {
    programId = existing.id;
    // Metadata and children commit together (CB05 — previously the
    // metadata update and the days/blocks replacement were two separate,
    // non-atomic operations).
    await db.$transaction([
      db.trainingProgram.update({ where: { id: programId }, data: metadata }),
      db.trainingDay.deleteMany({ where: { programId } }),
      ...dayCreateOps(programId),
    ]);
  } else {
    const program = await db.trainingProgram.create({
      data: { clientId, weekOf, status: "DRAFT", ...metadata },
      select: { id: true },
    });
    programId = program.id;
    await db.$transaction(dayCreateOps(programId));
  }

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
  if (program.status !== "DRAFT") throw new Error("Can only publish drafts");

  await verifyCoachAccessToClient(program.clientId);

  // Atomic: demote the client's other currently-PUBLISHED program to
  // SUPERSEDED (CB05 — at most one PUBLISHED program per client, enforced
  // by a partial unique index) before publishing this one, and only flip
  // this program's status if it's still DRAFT (guards a concurrent
  // double-publish via updateMany's affected-row count).
  const publishedAt = new Date();
  const result = await db.$transaction(async (tx) => {
    await tx.trainingProgram.updateMany({
      // Exclude the target itself — see app/actions/meal-plans.ts's identical
      // guard against a losing racer clobbering the winner's just-published row.
      where: { clientId: program.clientId, status: "PUBLISHED", id: { not: parsed.data.programId } },
      data: { status: "SUPERSEDED" },
    });
    return tx.trainingProgram.updateMany({
      where: { id: parsed.data.programId, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt },
    });
  });
  if (result.count === 0) {
    throw new Error("This program was already published or changed by someone else — refresh and try again.");
  }

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");
  return { success: true };
}
