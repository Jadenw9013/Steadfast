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
        consultationStage: true,
        source: true,
        prospectEmailAddr: true,
        prospectPhone: true,
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
        consultationStage: l.consultationStage,
        source: l.source,
        prospectEmailAddr: l.prospectEmailAddr,
        prospectPhone: l.prospectPhone,
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
  // Optional dedicated email field the iOS client sends alongside the legacy
  // phone/contact field. Not validated with `.email()` at the schema level —
  // a mistyped address must not reject the whole lead (see POST handler,
  // which validates it separately and simply drops it if malformed).
  prospectEmailAddr: z.string().max(100).nullable().optional(),
  intakeAnswers: z
    .object({
      goals: z.string().max(1000).default(""),
      experience: z.string().max(1000).optional(),
      injuries: z.string().max(1000).optional(),
    })
    .default({ goals: "" }),
});

const emailFormat = z.string().trim().toLowerCase().email();

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

    // Malformed values are silently dropped rather than rejected — a coach
    // mistyping an email must not lose the whole lead.
    const emailResult = parsed.data.prospectEmailAddr
      ? emailFormat.safeParse(parsed.data.prospectEmailAddr)
      : null;
    const prospectEmailAddr = emailResult?.success ? emailResult.data : null;

    const lead = await db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName,
        prospectEmail,
        prospectEmailAddr,
        intakeAnswers,
      },
      select: {
        id: true,
        prospectName: true,
        prospectEmail: true,
        prospectEmailAddr: true,
        status: true,
        createdAt: true,
        // iOS decodes this response into LeadRow, which declares `updatedAt`
        // non-optional (SteadfastAPI.swift). Omitting it made every manual
        // add-lead from the app fail to decode even though the row was written.
        updatedAt: true,
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
