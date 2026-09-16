import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { parsedWorkoutProgramSchema } from "@/lib/validations/workout-import";
import { getCurrentWeekMonday } from "@/lib/utils/date";
import { publishTrainingProgramTarget } from "@/lib/training-programs/publish";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const bodySchema = z.object({
  draftId: z.string().min(1),
  parsedJson: z.unknown(), // validated via parsedWorkoutProgramSchema below
  saveAsTemplate: z.boolean(),
  clientId: z.string().optional(),
  publish: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });
    if (coach.isDeactivated) return NextResponse.json({ error: "Account is pending deletion" }, { status: 403 });

    const rawBody = await req.json();
    const bodyParsed = bodySchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const { draftId, parsedJson, saveAsTemplate, clientId, publish } = bodyParsed.data;

    // Get draft + import record
    const draft = await db.workoutImportDraft.findUnique({
      where: { id: draftId },
      include: { workoutImport: true },
    });

    if (!draft || draft.workoutImport.coachId !== coach.id) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.workoutImport.status === "IMPORTED") {
      return NextResponse.json({ error: "Already imported" }, { status: 400 });
    }

    // Validate the edited program JSON
    const validated = parsedWorkoutProgramSchema.safeParse(parsedJson);
    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid program data", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const program = validated.data;

    if (saveAsTemplate) {
      // ── Save as Template ────────────────────────────────────────────────
      const template = await db.trainingTemplate.create({
        data: {
          coachId: coach.id,
          name: program.name,
          description: program.notes || null,
          days: {
            create: program.days.map((day, i) => ({
              dayName: day.dayName,
              sortOrder: i,
              blocks: {
                create: day.blocks.map((block, j) => ({
                  type: block.type,
                  title: block.title,
                  content: block.content,
                  sortOrder: j,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });

      await db.workoutImportDraft.update({
        where: { id: draftId },
        data: { parsedJson: program },
      });

      await db.workoutImport.update({
        where: { id: draft.workoutImport.id },
        data: { status: "IMPORTED" },
      });

      revalidatePath("/coach/templates");

      return NextResponse.json({
        status: "imported",
        mode: "template",
        templateId: template.id,
      });
    } else {
      // ── Assign to Client ────────────────────────────────────────────────
      const targetClientId = clientId ?? draft.workoutImport.clientId;
      if (!targetClientId) {
        return NextResponse.json({ error: "clientId required for program assignment" }, { status: 400 });
      }

      // Verify coach-client assignment
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: coach.id, clientId: targetClientId } },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Not assigned to this client" }, { status: 403 });
      }

      const weekOf = getCurrentWeekMonday();

      // Delete any existing draft for this week
      const existing = await db.trainingProgram.findFirst({
        where: { clientId: targetClientId, weekOf, status: "DRAFT" },
        select: { id: true },
      });
      if (existing) {
        await db.trainingProgram.delete({ where: { id: existing.id } });
      }

      // Always created as a DRAFT: lib/training-programs/publish.ts is the only
      // writer of TrainingProgram.status = "PUBLISHED" (T-739), and it owns the
      // CB05 supersede this route used to skip entirely.
      const trainingProgram = await db.trainingProgram.create({
        data: {
          clientId: targetClientId,
          weekOf,
          status: "DRAFT",
          clientNotes: program.notes || null,
          days: {
            create: program.days.map((day, i) => ({
              dayName: day.dayName,
              sortOrder: i,
              blocks: {
                create: day.blocks.map((block, j) => ({
                  type: block.type,
                  title: block.title,
                  content: block.content,
                  sortOrder: j,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });

      if (publish) {
        // `status: "DRAFT"` is constructed, not re-read: the row was created
        // microseconds earlier with that literal, and the flip itself is gated
        // in the database (`updateMany where status: "DRAFT"`), so any
        // staleness degrades to RACE_LOST rather than a wrong publish.
        const result = await publishTrainingProgramTarget({
          id: trainingProgram.id,
          clientId: targetClientId,
          status: "DRAFT",
        });
        if (!result.ok) {
          // Return BEFORE the bookkeeping writes. Marking the import IMPORTED
          // on a failed publish would trip the "Already imported" 400 on the
          // coach's retry and strand the import permanently.
          return NextResponse.json(
            result.code === "RACE_LOST"
              ? {
                  error: "This program was already published or changed by someone else",
                  code: "PUBLISH_RACE_LOST",
                }
              : { error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" },
            { status: 409 }
          );
        }
      }

      await db.workoutImportDraft.update({
        where: { id: draftId },
        data: { parsedJson: program },
      });

      await db.workoutImport.update({
        where: { id: draft.workoutImport.id },
        data: { status: "IMPORTED" },
      });

      revalidatePath("/coach", "layout");
      if (publish) revalidatePath("/client", "layout");

      return NextResponse.json({
        status: "imported",
        mode: "program",
        programId: trainingProgram.id,
        clientId: targetClientId,
        weekStartDate: weekOf.toISOString().split("T")[0],
      });
    }
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[workout-import/import]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
