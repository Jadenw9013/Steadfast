import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── GET — list all coaching requests (leads) ──────────────────────────────────

export async function GET() {
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
    // Find coach profile
    const profile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ leads: [] });
    }

    const leads = await db.coachingRequest.findMany({
      where: { coachProfileId: profile.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        prospectName: true,
        prospectEmail: true,
        status: true,
        intakeAnswers: true,
        prospectId: true,
        inviteLastSentAt: true,
        inviteSendCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      leads: leads.map((l) => ({
        id: l.id,
        prospectName: l.prospectName,
        prospectEmail: l.prospectEmail,
        status: l.status,
        intakeAnswers: l.intakeAnswers,
        prospectId: l.prospectId,
        inviteLastSentAt: l.inviteLastSentAt?.toISOString() ?? null,
        inviteSendCount: l.inviteSendCount,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[GET /api/coach/leads]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── POST — create a manual lead ───────────────────────────────────────────────

const createLeadSchema = z.object({
  prospectName: z.string().min(2).max(100),
  prospectEmail: z.string().max(100),
  intakeAnswers: z
    .object({
      goals: z.string().max(1000).default(""),
      experience: z.string().max(1000).optional(),
      injuries: z.string().max(1000).optional(),
    })
    .default({ goals: "" }),
});

export async function POST(req: NextRequest) {
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
    const profile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!profile) {
      return NextResponse.json(
        { error: "Coach profile not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { prospectName, prospectEmail, intakeAnswers } = parsed.data;

    const lead = await db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName,
        prospectEmail,
        intakeAnswers,
      },
      select: {
        id: true,
        prospectName: true,
        prospectEmail: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/coach/leads]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
