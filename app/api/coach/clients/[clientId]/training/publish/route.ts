import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  getTrainingProgramPublishTarget,
  publishTrainingProgramTarget,
} from "@/lib/training-programs/publish";

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

    const target = await getTrainingProgramPublishTarget(programId);
    if (!target) {
      return NextResponse.json(
        { error: "Training program not found" },
        { status: 404 }
      );
    }
    if (target.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await publishTrainingProgramTarget(target);
    if (!result.ok) {
      return NextResponse.json(
        result.code === "RACE_LOST"
          ? {
              error:
                "This program was already published or changed by someone else",
              code: "PUBLISH_RACE_LOST",
            }
          : { error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" },
        { status: 409 }
      );
    }

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
