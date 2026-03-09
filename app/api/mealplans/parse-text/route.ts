import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { parseMealPlanTextToJson } from "@/lib/llm/parse-meal-plan";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 60; // Allow up to 60s for LLM

const bodySchema = z.object({
  clientId: z.string().min(1),
  text: z.string().min(10, "Text must be at least 10 characters").max(10000, "Text must be at most 10,000 characters"),
});

function sanitizeText(text: string): string {
  return text
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { clientId, text } = parsed.data;

    // Verify coach-client relationship
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: coach.id, clientId } },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this client" }, { status: 403 });
    }

    // Create upload record (text/plain, no file stored)
    const upload = await db.mealPlanUpload.create({
      data: {
        coachId: coach.id,
        clientId,
        mimeType: "text/plain",
        storagePath: "",
        originalFilename: "pasted-text",
        status: "PROCESSING",
      },
    });

    try {
      const sanitizedText = sanitizeText(text);

      // Skip OCR — send directly to LLM
      const parsedJson = await parseMealPlanTextToJson(sanitizedText);

      // Create draft
      await db.mealPlanDraft.create({
        data: {
          uploadId: upload.id,
          extractedText: sanitizedText,
          parsedJson,
        },
      });

      // Mark as needs_review
      await db.mealPlanUpload.update({
        where: { id: upload.id },
        data: { status: "NEEDS_REVIEW" },
      });

      return NextResponse.json({ uploadId: upload.id, status: "needs_review" });
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Unknown error";
      console.error("[mealplan-parse-text] Processing failed:", message);

      await db.mealPlanUpload.update({
        where: { id: upload.id },
        data: { status: "FAILED", errorMessage: message },
      });

      return NextResponse.json(
        { status: "failed", error: "Processing failed. Please try again or re-paste the text." },
        { status: 500 }
      );
    }
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[parse-text]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
