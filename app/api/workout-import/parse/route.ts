import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { downloadWorkoutFile } from "@/lib/supabase/workout-storage";
import { extractText } from "@/lib/ocr/google-vision";
import { parseWorkoutPlanTextToJson } from "@/lib/llm/parse-workout-plan";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

    const body = await req.json();
    const { importId } = body as { importId?: string };
    if (!importId) return NextResponse.json({ error: "Missing importId" }, { status: 400 });

    const workoutImport = await db.workoutImport.findUnique({ where: { id: importId } });
    if (!workoutImport || workoutImport.coachId !== coach.id) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    if (workoutImport.status !== "UPLOADED" && workoutImport.status !== "FAILED") {
      return NextResponse.json(
        { error: `Cannot parse import with status: ${workoutImport.status}` },
        { status: 400 }
      );
    }

    await db.workoutImport.update({
      where: { id: importId },
      data: { status: "PROCESSING", errorMessage: null },
    });

    try {
      const fileBytes = await downloadWorkoutFile(workoutImport.storagePath);
      const mime = workoutImport.mimeType ?? "";
      const extractedText = await extractText(fileBytes, mime);
      const parsedJson = await parseWorkoutPlanTextToJson(extractedText);

      await db.workoutImportDraft.upsert({
        where: { importId },
        update: { extractedText, parsedJson, updatedAt: new Date() },
        create: { importId, extractedText, parsedJson },
      });

      await db.workoutImport.update({
        where: { id: importId },
        data: { status: "NEEDS_REVIEW" },
      });

      return NextResponse.json({ status: "needs_review" });
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Unknown error";
      await db.workoutImport.update({
        where: { id: importId },
        data: { status: "FAILED", errorMessage: message },
      });
      return NextResponse.json({ status: "failed", error: message }, { status: 500 });
    }
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[workout-import/parse]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
