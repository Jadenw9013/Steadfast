import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { submitCheckIn } from "@/lib/check-ins/submit";
import { ROUTE_FAILED } from "@/lib/observability/events";
import { reportServerError } from "@/lib/observability/report";

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

    const result = await submitCheckIn(user, body);

    if ("error" in result) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error },
        { status: 422 }
      );
    }
    if ("conflict" in result) {
      return NextResponse.json({ conflict: result.conflict }, { status: 409 });
    }

    // Notify coach on a brand-new check-in (not an overwrite) — mirrors the
    // server action's notification side effects.
    if (!result.overwritten) {
      const coachAssignment = await db.coachClient.findFirst({ where: { clientId: user.id }, select: { coachId: true } });
      if (coachAssignment?.coachId) {
        const coachId = coachAssignment.coachId;
        const clientName = user.firstName || "Your client";
        Promise.resolve().then(async () => {
          try {
            const { notifyClientCheckInSubmitted } = await import("@/lib/sms/notify");
            notifyClientCheckInSubmitted(coachId, clientName).catch(console.error);
          } catch { /* ignore */ }
          try {
            const coach = await db.user.findUnique({
              where: { id: coachId },
              select: { email: true, firstName: true, emailClientCheckIns: true },
            });
            if (coach?.email && coach.emailClientCheckIns) {
              const { sendEmail } = await import("@/lib/email/sendEmail");
              const { clientCheckinSubmittedEmail } = await import("@/lib/email/templates");
              const email = clientCheckinSubmittedEmail(coach.firstName || "Coach", clientName);
              sendEmail({ to: coach.email, ...email }).catch(console.error);
            }
          } catch { /* ignore */ }
        }).catch(console.error);
      }
    }

    return NextResponse.json({ checkIn: { id: result.checkInId } }, { status: 201 });
  } catch (err) {
    reportServerError(ROUTE_FAILED.evt, err, {
      route: "/api/client/checkin",
      method: "POST",
      statusCode: 500,
      context: { handler: "POST /api/client/checkin" },
      allow: ROUTE_FAILED.allow,
    });
    console.error("[POST /api/client/checkin]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
