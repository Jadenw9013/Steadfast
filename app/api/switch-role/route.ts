import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentDbUser();
    const { role } = await req.json();

    if (role !== "COACH" && role !== "CLIENT") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (role === "COACH" && !user.isCoach) {
      return NextResponse.json({ error: "No coach access" }, { status: 403 });
    }
    if (role === "CLIENT" && !user.isClient) {
      return NextResponse.json({ error: "No client access" }, { status: 403 });
    }

    await db.user.update({
      where: { id: user.id },
      data: { activeRole: role },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("switch-role error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
