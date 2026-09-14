import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { acceptClientInviteForUser } from "@/lib/activation";
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
    const invite = await db.clientInvite.findUnique({ where: { inviteToken: coachCode } });

    if (!invite) {
      return NextResponse.json(
        { success: false, error: "invalid_code" },
        { status: 404 }
      );
    }

    // ── Accept via the single shared acceptance service ────────────────────
    const result = await acceptClientInviteForUser(invite, user);
    if (!result.success) {
      const status = result.error.includes("expired") ? 410 : 403;
      return NextResponse.json(
        { success: false, error: result.error.includes("expired") ? "expired" : "invalid_code" },
        { status }
      );
    }

    if (result.alreadyConnected) {
      return NextResponse.json(
        { success: false, error: "already_connected" },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/client/connect-coach]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
