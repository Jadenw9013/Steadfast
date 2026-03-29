import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── POST — register APNs device token ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const token = body?.token;

    if (!token || typeof token !== "string" || token.length < 10) {
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 422 }
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: { apnsToken: token },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/me/push-token]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── DELETE — clear APNs device token (on sign-out) ────────────────────────────

export async function DELETE(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await db.user.update({
      where: { id: user.id },
      data: { apnsToken: null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/me/push-token]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
