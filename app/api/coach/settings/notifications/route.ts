import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── GET ───────────────────────────────────────────────────────────────────────

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

  return NextResponse.json({
    preferences: {
      // SMS — common
      phoneNumber: user.phoneNumber,
      smsOptIn: user.smsOptIn,
      // SMS — coach-specific
      smsClientCheckIns: user.smsClientCheckIns,
      smsMissedCheckInAlerts: user.smsMissedCheckInAlerts,
      smsClientMessages: user.smsClientMessages,
      smsNewClientSignups: user.smsNewClientSignups,
      smsMissedCheckInAlertTime: user.smsMissedCheckInAlertTime,
      // Email — coach-specific
      emailClientCheckIns: user.emailClientCheckIns,
      emailClientMessages: user.emailClientMessages,
      emailCoachingRequests: user.emailCoachingRequests,
    },
  });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

const updateNotificationsSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "Must be a valid E.164 phone number")
    .or(z.literal(""))
    .optional(),
  smsOptIn: z.boolean().optional(),
  smsClientCheckIns: z.boolean().optional(),
  smsMissedCheckInAlerts: z.boolean().optional(),
  smsClientMessages: z.boolean().optional(),
  smsNewClientSignups: z.boolean().optional(),
  smsMissedCheckInAlertTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM")
    .optional(),
  emailClientCheckIns: z.boolean().optional(),
  emailClientMessages: z.boolean().optional(),
  emailCoachingRequests: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
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
    const body = await req.json();
    const parsed = updateNotificationsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: parsed.data,
      select: {
        phoneNumber: true,
        smsOptIn: true,
        smsClientCheckIns: true,
        smsMissedCheckInAlerts: true,
        smsClientMessages: true,
        smsNewClientSignups: true,
        smsMissedCheckInAlertTime: true,
        emailClientCheckIns: true,
        emailClientMessages: true,
        emailCoachingRequests: true,
      },
    });

    return NextResponse.json({ preferences: updated });
  } catch (err) {
    console.error("[PUT /api/coach/settings/notifications]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
