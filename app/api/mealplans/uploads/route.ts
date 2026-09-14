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

    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400 });

    // Verify coach-client relationship
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: coach.id, clientId } },
    });
    if (!assignment) return NextResponse.json({ error: "Not assigned to this client" }, { status: 403 });

    const uploads = await db.mealPlanUpload.findMany({
      where: { coachId: coach.id, clientId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        status: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ uploads });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[uploads]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
