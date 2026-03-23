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

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    preferences: {
      // SMS
      phoneNumber: user.phoneNumber,
      smsOptIn: user.smsOptIn,
      smsMealPlanUpdates: user.smsMealPlanUpdates,
      smsDailyCheckInReminder: user.smsDailyCheckInReminder,
      smsCoachMessages: user.smsCoachMessages,
      smsCheckInFeedback: user.smsCheckInFeedback,
      smsCheckInReminderTime: user.smsCheckInReminderTime,
      // Email
      emailCheckInReminders: user.emailCheckInReminders,
      emailMealPlanUpdates: user.emailMealPlanUpdates,
      emailCoachMessages: user.emailCoachMessages,
    },
  });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

// Mirrors clientPrefsSchema from app/actions/notification-preferences.ts
const updateNotificationsSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "Must be a valid E.164 phone number")
    .or(z.literal(""))
    .optional(),
  smsOptIn: z.boolean().optional(),
  smsMealPlanUpdates: z.boolean().optional(),
  smsDailyCheckInReminder: z.boolean().optional(),
  smsCoachMessages: z.boolean().optional(),
  smsCheckInFeedback: z.boolean().optional(),
  smsCheckInReminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM")
    .optional(),
  emailCheckInReminders: z.boolean().optional(),
  emailMealPlanUpdates: z.boolean().optional(),
  emailCoachMessages: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
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
        smsMealPlanUpdates: true,
        smsDailyCheckInReminder: true,
        smsCoachMessages: true,
        smsCheckInFeedback: true,
        smsCheckInReminderTime: true,
        emailCheckInReminders: true,
        emailMealPlanUpdates: true,
        emailCoachMessages: true,
      },
    });

    return NextResponse.json({ preferences: updated });
  } catch (err) {
    console.error("[PUT /api/client/settings/notifications]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
