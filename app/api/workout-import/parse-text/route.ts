import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { parseWorkoutPlanTextToJson } from "@/lib/llm/parse-workout-plan";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 60;

const bodySchema = z.object({
  text: z
    .string()
    .min(10, "Text must be at least 10 characters")
    .max(10000, "Text must be at most 10,000 characters"),
  clientId: z.string().optional(),
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
        { status: 400 }
      );
    }

    const { text, clientId } = parsed.data;

    // If clientId provided, verify coach-client relationship
    if (clientId) {
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: coach.id, clientId } },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Not assigned to this client" }, { status: 403 });
      }
    }

    const workoutImport = await db.workoutImport.create({
      data: {
        coachId: coach.id,
        clientId: clientId ?? null,
        mimeType: "text/plain",
        status: "PROCESSING",
      },
    });

    try {
      const sanitizedText = sanitizeText(text);
      const parsedJson = await parseWorkoutPlanTextToJson(sanitizedText);

      await db.workoutImportDraft.create({
        data: {
          importId: workoutImport.id,
          extractedText: sanitizedText,
          parsedJson,
        },
      });

      await db.workoutImport.update({
        where: { id: workoutImport.id },
        data: { status: "NEEDS_REVIEW" },
      });

      return NextResponse.json({ importId: workoutImport.id, status: "needs_review" });
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Unknown error";
      console.error("[workout-parse-text] Processing failed:", message);
      await db.workoutImport.update({
        where: { id: workoutImport.id },
        data: { status: "FAILED", errorMessage: message },
      });
      return NextResponse.json(
        { status: "failed", error: "Processing failed. Please try again or re-paste the text." },
        { status: 500 }
      );
    }
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[workout-import/parse-text]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
