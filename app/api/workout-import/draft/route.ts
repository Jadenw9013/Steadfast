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

    const importId = req.nextUrl.searchParams.get("importId");
    if (!importId) return NextResponse.json({ error: "Missing importId" }, { status: 400 });

    const workoutImport = await db.workoutImport.findUnique({
      where: { id: importId },
      include: { draft: true },
    });

    if (!workoutImport || workoutImport.coachId !== coach.id) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }

    if (!workoutImport.draft) {
      return NextResponse.json({ error: "No draft found for this import" }, { status: 404 });
    }

    return NextResponse.json({
      draftId: workoutImport.draft.id,
      importId: workoutImport.id,
      parsedJson: workoutImport.draft.parsedJson,
      filename: workoutImport.originalFilename,
      status: workoutImport.status,
      clientId: workoutImport.clientId,
    });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[workout-import/draft]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
