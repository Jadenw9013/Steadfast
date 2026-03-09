import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { downloadMealPlanFile } from "@/lib/supabase/meal-plan-storage";
import { extractText } from "@/lib/ocr/google-vision";
import { parseMealPlanTextToJson } from "@/lib/llm/parse-meal-plan";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Allow up to 60s for OCR + LLM

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

    const body = await req.json();
    const { uploadId } = body as { uploadId?: string };
    if (!uploadId) return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });

    // Verify ownership
    const upload = await db.mealPlanUpload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.coachId !== coach.id) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (upload.status !== "UPLOADED" && upload.status !== "FAILED") {
      return NextResponse.json({ error: `Cannot parse upload with status: ${upload.status}` }, { status: 400 });
    }

    // Set processing status
    await db.mealPlanUpload.update({
      where: { id: uploadId },
      data: { status: "PROCESSING", errorMessage: null },
    });

    try {
      // 1. Download file from Supabase
      const fileBytes = await downloadMealPlanFile(upload.storagePath);

      // 2. Extract text (Vision API handles both images and PDFs)
      const mime = upload.mimeType ?? "";
      const extractedText = await extractText(fileBytes, mime);

      // 3. Send to LLM for structuring
      const parsedJson = await parseMealPlanTextToJson(extractedText);

      // 4. Upsert draft
      await db.mealPlanDraft.upsert({
        where: { uploadId },
        update: { extractedText, parsedJson, updatedAt: new Date() },
        create: { uploadId, extractedText, parsedJson },
      });

      // 5. Mark as needs_review
      await db.mealPlanUpload.update({
        where: { id: uploadId },
        data: { status: "NEEDS_REVIEW" },
      });

      return NextResponse.json({ status: "needs_review" });
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Unknown error";

      await db.mealPlanUpload.update({
        where: { id: uploadId },
        data: { status: "FAILED", errorMessage: message },
      });

      return NextResponse.json({ status: "failed", error: message }, { status: 500 });
    }
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[parse]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
