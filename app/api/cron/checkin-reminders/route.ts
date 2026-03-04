import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyDailyCheckInReminder, notifyMissedCheckInAlert } from "@/lib/sms/notify";
import { getLocalDate } from "@/lib/utils/date";

/**
 * Checks if the configured DB time string (e.g., "19:00") aligns with the current server hour.
 * Since this cron presumably runs hourly, we just check if the hours match.
 */
function isTimeToTrigger(configuredTime: string, currentHourStr: string) {
  const timeParts = configuredTime.split(":");
  return timeParts[0] === currentHourStr;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sentClientReminders = 0;
  let sentCoachAlerts = 0;

  // Note: We use the server's current timezone as the baseline because
  // running a cron every hour for every user's individual timezone is complex
  // and wasn't requested strictly, but we get the local Date string to check check-ins.
  const serverTime = new Date();

  // Format current hour block as "00" through "23" in the server's local time
  const currentHourStr = serverTime.getHours().toString().padStart(2, "0");

  // Find all active clients opted into SMS with daily reminders enabled
  const clientsToRemind = await db.user.findMany({
    where: {
      activeRole: "CLIENT",
      smsOptIn: true,
      smsDailyCheckInReminder: true,
    },
    select: {
      id: true,
      timezone: true,
      smsCheckInReminderTime: true,
      coachCode: true,
    }
  });

  for (const client of clientsToRemind) {
    // Check if this hour matches their configured reminder time hour block
    if (!isTimeToTrigger(client.smsCheckInReminderTime, currentHourStr)) {
      continue;
    }

    const localDate = getLocalDate(serverTime, client.timezone || "America/Los_Angeles");

    // Check if this client already submitted ANY check-in today
    const existing = await db.checkIn.findFirst({
      where: {
        clientId: client.id,
        localDate: localDate, // Check today specifically
        deletedAt: null,
      },
      select: { id: true },
    });

    // If they already checked in today, skip the reminder
    if (existing) continue;

    await notifyDailyCheckInReminder(client.id);
    sentClientReminders++;
  }

  // Find all active coaches opted into SMS expecting missed alerts
  const coachesToAlert = await db.user.findMany({
    where: {
      activeRole: "COACH",
      smsOptIn: true,
      smsMissedCheckInAlerts: true,
    },
    select: {
      id: true,
      smsMissedCheckInAlertTime: true,
      coachAssignments: {
        select: {
          client: {
            select: {
              id: true,
              firstName: true,
              timezone: true,
            }
          }
        }
      }
    }
  });

  for (const coach of coachesToAlert) {
    if (!isTimeToTrigger(coach.smsMissedCheckInAlertTime, currentHourStr)) {
      continue;
    }

    for (const assignment of coach.coachAssignments) {
      const localDate = getLocalDate(serverTime, assignment.client.timezone || "America/Los_Angeles");

      // Check if this specific client missed their check-in today
      const existing = await db.checkIn.findFirst({
        where: {
          clientId: assignment.client.id,
          localDate: localDate,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!existing) {
        await notifyMissedCheckInAlert(coach.id, assignment.client.firstName || "Your client");
        sentCoachAlerts++;
      }
    }
  }

  return NextResponse.json({ sentClientReminders, sentCoachAlerts });
}
