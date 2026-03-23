import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

type Params = { params: Promise<{ leadId: string }> };

const updateLeadSchema = z.object({
  status: z
    .enum([
      "PENDING",
      "CONTACTED",
      "CALL_SCHEDULED",
      "ACCEPTED",
      "DECLINED",
      "WAITLISTED",
    ])
    .optional(),
});

// ── PUT — update lead stage / status ─────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Params) {
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
    const { leadId } = await params;

    // Verify ownership via coachProfile
    const profile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!profile) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const lead = await db.coachingRequest.findUnique({
      where: { id: leadId },
      select: { coachProfileId: true },
    });
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (lead.coachProfileId !== profile.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { status } = parsed.data;

    const updated = await db.coachingRequest.update({
      where: { id: leadId },
      data: {
        ...(status !== undefined && { status }),
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      lead: {
        id: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[PUT /api/coach/leads/[leadId]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
