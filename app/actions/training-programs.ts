"use server";

import { z } from "zod";
import { parseWeekStartDate } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import {
  getTrainingProgramPublishTarget,
  publishTrainingProgramTarget,
} from "@/lib/training-programs/publish";
import {
  clientNotesSchema,
  createTrainingProgramDraft,
  findTrainingDraftForWeek,
  saveTrainingProgramContent,
  trainingDaysSchema,
  weeklyFrequencySchema,
} from "@/lib/training-programs/drafts";
import { revalidatePath } from "next/cache";

// The block/day schemas, the block-type enum, sortOrder normalization and the
// CB05 fork rule all live in lib/training-programs/drafts.ts — the single
// writer of training-program content, shared verbatim with the iOS-facing
// PUT/POST /api/coach/clients/[clientId]/training. Do not redeclare them here
// (T-622: the two copies had drifted to different block types and limits).
const saveSchema = z.object({
  clientId: z.string().min(1),
  weekStartDate: z.string().min(1),
  days: trainingDaysSchema,
  weeklyFrequency: weeklyFrequencySchema.optional(),
  clientNotes: clientNotesSchema.optional(),
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

  const metadata = {
    weeklyFrequency: weeklyFrequency ?? null,
    clientNotes: clientNotes ?? null,
    injuries: injuries ?? null,
    equipment: equipment ?? null,
    templateSourceId: templateSourceId ?? null,
  };

  // CB05: only ever continue editing an existing DRAFT. A PUBLISHED or
  // SUPERSEDED program for this client/week is never demoted or mutated —
  // that previously let a save silently flip a client's live program back
  // to DRAFT (and overwrite its content) mid-edit. Editing one instead
  // creates a brand-new draft.
  const existing = await findTrainingDraftForWeek(clientId, weekOf);

  const { programId } = existing
    ? await saveTrainingProgramContent(existing, { days, metadata })
    : await createTrainingProgramDraft({ clientId, weekOf, days, metadata });

  revalidatePath("/coach", "layout");
  return { programId };
}

const publishSchema = z.object({
  programId: z.string().min(1),
});

export async function publishTrainingProgram(input: unknown) {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const target = await getTrainingProgramPublishTarget(parsed.data.programId);
  if (!target) throw new Error("Training program not found");

  await verifyCoachAccessToClient(target.clientId);

  // CB05 supersede + race guard live in lib/training-programs/publish.ts, the
  // only writer of TrainingProgram.status = "PUBLISHED" (T-739). The
  // status !== "DRAFT" check now runs inside the service, i.e. AFTER the
  // access check rather than before it — intentional, and identical to the
  // ordering T-660 established for meal plans.
  const result = await publishTrainingProgramTarget(target);
  if (!result.ok) {
    if (result.code === "NOT_DRAFT") throw new Error("Can only publish drafts");
    throw new Error("This program was already published or changed by someone else — refresh and try again.");
  }

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");
  return { success: true };
}
