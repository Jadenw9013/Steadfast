import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { readBoundedJson } from "@/lib/security/body";
import { reportServerError } from "@/lib/observability/report";

export async function PATCH(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await readBoundedJson(req, 1024);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    const role = body.value && typeof body.value === "object" ? (body.value as Record<string, unknown>).role : undefined;

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
    reportServerError("sf.auth.switch_role_failed", err, { route: "/api/switch-role", method: "PATCH" });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
