import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── POST — connect client to coach via invite code ───────────────────────────
//
// iOS calls POST /api/client/connect-coach with { coachCode: string }.
// The coachCode maps to ClientInvite.inviteToken from the direct-invite system.
//
// Response contract (matches iOS ConnectCoachResponse):
//   Success: { success: true }
//   Failure: { success: false, error: string }

const connectCoachSchema = z.object({
  coachCode: z.string().min(1, "Code is required").max(100),
});

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = connectCoachSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "invalid_code" },
        { status: 422 }
      );
    }

    const { coachCode } = parsed.data;

    // ── Look up invite by token ───────────────────────────────────────────
    const invite = await db.clientInvite.findUnique({
      where: { inviteToken: coachCode },
      select: {
        id: true,
        coachId: true,
        email: true,
        status: true,
        expiresAt: true,
        coach: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!invite) {
      return NextResponse.json(
        { success: false, error: "invalid_code" },
        { status: 404 }
      );
    }

    // ── Check invite status ───────────────────────────────────────────────
    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { success: false, error: "invalid_code" },
        { status: 410 }
      );
    }

    // ── Check expiry (7-day TTL) ──────────────────────────────────────────
    if (invite.expiresAt < new Date()) {
      await db.clientInvite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      });
      return NextResponse.json(
        { success: false, error: "expired" },
        { status: 410 }
      );
    }

    // ── Verify email match ────────────────────────────────────────────────
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: "invalid_code" },
        { status: 403 }
      );
    }

    // ── Check for existing assignment ─────────────────────────────────────
    const existingAssignment = await db.coachClient.findUnique({
      where: {
        coachId_clientId: {
          coachId: invite.coachId,
          clientId: user.id,
        },
      },
      select: { id: true },
    });

    if (existingAssignment) {
      // Mark invite as accepted anyway (idempotent)
      await db.clientInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED" },
      });
      return NextResponse.json(
        { success: false, error: "already_connected" },
        { status: 409 }
      );
    }

    // ── Create CoachClient + accept invite ────────────────────────────────
    await db.coachClient.create({
      data: {
        coachId: invite.coachId,
        clientId: user.id,
        coachNotes: "Joined via invite code.",
      },
    });

    await db.clientInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/client/connect-coach]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
