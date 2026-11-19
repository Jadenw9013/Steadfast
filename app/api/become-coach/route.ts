import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

import { checkCoachRegistration } from "@/lib/security/coach-registration";
import { readBoundedJson } from "@/lib/security/body";
import { reportServerError } from "@/lib/observability/report";

/**
 * POST /api/become-coach
 *
 * REST endpoint for iOS (mirrors the become-coach server action).
 * Validates the access code against STEADFAST_COACH_ACCESS_CODE and
 * grants coach capabilities to the authenticated user.
 *
 * Security: timing-safe comparison, per-user rate limiting (3/15m), audit log.
 *
 * Body: { accessCode: string }
 * 200 → updated user JSON
 * 401 → not authenticated
 * 403 → invalid code or already a coach
 * 422 → validation error
 * 429 → rate limited
 */
export async function POST(req: NextRequest) {
  let dbUser: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    dbUser = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await readBoundedJson(req, 2048);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    const check = await checkCoachRegistration(dbUser.id, body.value);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    // Already a coach
    if (dbUser.isCoach) {
      return NextResponse.json(
        { error: "You already have coach access." },
        { status: 403 }
      );
    }

    // Grant coach capabilities
    const updated = await db.user.update({
      where: { id: dbUser.id },
      data: {
        isCoach: true,
        isClient: true,
        activeRole: "COACH",
      },
    });

    console.warn(`[become-coach] SUCCESS userId=${dbUser.id} at=${new Date().toISOString()}`);

    return NextResponse.json(updated);
  } catch (err) {
    reportServerError("sf.coach-registration.failed", err, { route: "/api/become-coach", statusCode: 500 });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
