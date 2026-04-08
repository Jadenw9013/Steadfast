import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

type Params = { params: Promise<{ clientId: string }> };

const publishSchema = z.object({
  programId: z.string().min(1),
});

// ── POST — publish a training program ────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { clientId } = await params;

    // Verify assignment
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { programId } = parsed.data;

    const program = await db.trainingProgram.findUnique({
      where: { id: programId },
      select: { clientId: true, status: true },
    });
    if (!program) {
      return NextResponse.json(
        { error: "Training program not found" },
        { status: 404 }
      );
    }
    if (program.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (program.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Can only publish drafts" },
        { status: 409 }
      );
    }

    await db.trainingProgram.update({
      where: { id: programId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // Fire-and-forget push to client
    // NOTE: The schema has no separate pushTrainingUpdates preference column. We gate
    // on pushMealPlanUpdates as a short-term approximation — both are "plan published"
    // events from the client's perspective. Add a dedicated column when training
    // notifications need a separate opt-in.
    Promise.resolve().then(async () => {
      try {
        const client = await db.user.findUnique({
          where: { id: clientId },
          select: { pushMealPlanUpdates: true },
        });
        if (client?.pushMealPlanUpdates) {
          const { pushTrainingProgramPublished } = await import("@/lib/notifications/push");
          await pushTrainingProgramPublished(clientId);
        }
      } catch (err) {
        console.error("[training publish] Failed to send push:", err);
      }
    }).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/coach/clients/[clientId]/training/publish]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
