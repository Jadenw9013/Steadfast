import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { COACH_SETTABLE_STAGES } from "@/lib/leads/activate-lead";

type Params = { params: Promise<{ leadId: string }> };

const stageSchema = z.object({
  stage: z.enum(COACH_SETTABLE_STAGES),
});

// ── PUT — update consultationStage ────────────────────────────────────────────
// ACTIVE is terminal and handled via /activate — excluded from this endpoint.

export async function PUT(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;

    const profile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const lead = await db.coachingRequest.findUnique({
      where: { id: leadId },
      select: { coachProfileId: true, consultationStage: true },
    });
    if (!lead || lead.coachProfileId !== profile.id) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (lead.consultationStage === "ACTIVE") {
      return NextResponse.json(
        { error: "This lead is already active. Use /activate to change active status." },
        { status: 409 }
      );
    }

    const body = await req.json();
    const parsed = stageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid stage", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const updated = await db.coachingRequest.update({
      where: { id: leadId },
      data: { consultationStage: parsed.data.stage },
      select: { id: true, consultationStage: true, updatedAt: true },
    });

    revalidatePath("/coach/leads");
    revalidatePath(`/coach/leads/${leadId}`);

    return NextResponse.json({
      lead: {
        id: updated.id,
        consultationStage: updated.consultationStage,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[PUT /api/coach/leads/[leadId]/stage]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
