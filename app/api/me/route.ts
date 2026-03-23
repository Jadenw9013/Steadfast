import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export async function GET() {
  // ── Auth ────────────────────────────────────────────────────────────────
  let dbUser: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    dbUser = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Fetch with explicit select — no select * ─────────────────────────
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id: dbUser.id },
      select: {
        id: true,
        clerkId: true,
        firstName: true,
        lastName: true,
        email: true,
        profilePhotoPath: true,
        activeRole: true,
        isCoach: true,
        isClient: true,
        timezone: true,
      },
    });

    return NextResponse.json(user);
  } catch (err) {
    console.error("[GET /api/me]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
