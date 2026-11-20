import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { readBoundedJson } from "@/lib/security/body";
import { reportServerError } from "@/lib/observability/report";

const roleSchema = z.object({
  role: z.enum(["COACH", "CLIENT"]),
});

export async function POST(req: NextRequest) {
  let dbUser: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    dbUser = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await readBoundedJson(req, 1024);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    const parsed = roleSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { role } = parsed.data;

    // Ensure the user actually has the role they're switching to
    if (role === "COACH" && !dbUser.isCoach) {
      return NextResponse.json({ error: "User is not a coach" }, { status: 403 });
    }
    if (role === "CLIENT" && !dbUser.isClient) {
      return NextResponse.json({ error: "User is not a client" }, { status: 403 });
    }

    const updated = await db.user.update({
      where: { id: dbUser.id },
      data: { activeRole: role },
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

    return NextResponse.json(updated);
  } catch (err) {
    reportServerError("sf.auth.set_role_failed", err, { route: "/api/me/role", method: "POST" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
