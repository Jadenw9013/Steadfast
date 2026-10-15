import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
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

    // T-2069: ownership + CURRENT CoachClient link before the draft is read.
    const owner = await db.mealPlanUpload.findUnique({
      where: { id: uploadId },
      select: { coachId: true, clientId: true },
    });
    if (!owner || owner.coachId !== coach.id) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }
    try {
      await verifyCoachAccessToClient(owner.clientId);
    } catch (e) {
      if (e instanceof Error && e.message === "Not assigned to this client") {
        return NextResponse.json({ error: e.message }, { status: 403 });
      }
      throw e;
    }

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
