import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });
    if (coach.isDeactivated) return NextResponse.json({ error: "Account is pending deletion" }, { status: 403 });

    const uploadId = req.nextUrl.searchParams.get("uploadId");
    if (!uploadId) return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });

    // Verify ownership
    const upload = await db.mealPlanUpload.findUnique({
      where: { id: uploadId },
      include: { draft: true },
    });

    if (!upload || upload.coachId !== coach.id) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (!upload.draft) {
      return NextResponse.json({ error: "No draft found for this upload" }, { status: 404 });
    }

    return NextResponse.json({
      draftId: upload.draft.id,
      uploadId: upload.id,
      extractedText: upload.draft.extractedText,
      parsedJson: upload.draft.parsedJson,
      filename: upload.originalFilename,
      status: upload.status,
    });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[draft]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
