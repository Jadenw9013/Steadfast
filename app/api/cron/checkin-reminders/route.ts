import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyDailyCheckInReminder, notifyMissedCheckInAlert } from "@/lib/sms/notify";
import { getLocalDate } from "@/lib/utils/date";
import { parseCadenceConfig, getEffectiveCadence, getClientCadenceStatus, cadenceFromLegacyDays } from "@/lib/scheduling/cadence";

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

  try {
    const serverTime = new Date();
    const currentHourStr = serverTime.getHours().toString().padStart(2, "0");

    // ── Client reminders ──────────────────────────────────────────────────────
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
        clientAssignments: {
          take: 1,
          include: {
            coach: {
              select: { checkInDaysOfWeek: true, cadenceConfig: true },
            },
          },
        },
      }
    });

    for (const client of clientsToRemind) {
      // Check if this hour matches their configured reminder time hour block
      if (!isTimeToTrigger(client.smsCheckInReminderTime, currentHourStr)) {
        continue;
      }

      // Skip clients with no coach assignment — they can't submit check-ins
      const assignment = client.clientAssignments[0];
      if (!assignment) continue;

      const localDate = getLocalDate(serverTime, client.timezone || "America/Los_Angeles");
      const clientTz = client.timezone || "America/Los_Angeles";

      // Check if this client already submitted ANY check-in today (safety backstop)
      const existing = await db.checkIn.findFirst({
        where: {
          clientId: client.id,
          localDate: localDate,
          deletedAt: null,
        },
        select: { id: true, submittedAt: true, status: true },
      });

      // If they already checked in today, skip the reminder
      if (existing) continue;

      // Cadence-aware check: only remind if due or overdue
      const coachCadence = parseCadenceConfig(assignment.coach.cadenceConfig);
      const clientCadenceOverride = parseCadenceConfig(assignment.cadenceConfig);
      const effectiveCadence = getEffectiveCadence(
        coachCadence ?? cadenceFromLegacyDays(assignment.coach.checkInDaysOfWeek),
        clientCadenceOverride
      );

      // Get last check-in for status derivation
      const lastCheckIn = await db.checkIn.findFirst({
        where: { clientId: client.id, deletedAt: null },
        orderBy: { submittedAt: "desc" },
        select: { submittedAt: true, status: true },
      });

      const cadenceResult = getClientCadenceStatus(
        effectiveCadence,
        lastCheckIn ? { submittedAt: lastCheckIn.submittedAt, status: lastCheckIn.status } : null,
        clientTz
      );

      // Only send reminder if check-in is due or overdue
      if (cadenceResult.status !== "due" && cadenceResult.status !== "overdue") {
        continue;
      }

      try {
        await notifyDailyCheckInReminder(client.id);
        sentClientReminders++;
      } catch (err) {
        // Individual send failures should not crash the batch
        console.error(`Failed to send reminder to client ${client.id}`, err);
      }
    }

    // ── Coach missed-check-in alerts ──────────────────────────────────────────
    const coachesToAlert = await db.user.findMany({
      where: {
        activeRole: "COACH",
        smsOptIn: true,
        smsMissedCheckInAlerts: true,
      },
      select: {
        id: true,
        smsMissedCheckInAlertTime: true,
        checkInDaysOfWeek: true,
        cadenceConfig: true,
        coachAssignments: {
          select: {
            cadenceConfig: true,
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

      const coachCadence = parseCadenceConfig(coach.cadenceConfig);

      for (const assignment of coach.coachAssignments) {
        const clientTz = assignment.client.timezone || "America/Los_Angeles";
        const localDate = getLocalDate(serverTime, clientTz);

        // Check if this specific client has a check-in today (safety backstop)
        const existing = await db.checkIn.findFirst({
          where: {
            clientId: assignment.client.id,
            localDate: localDate,
            deletedAt: null,
          },
          select: { id: true },
        });

        if (existing) continue;

        // Cadence-aware check: only alert if client is overdue
        const clientCadenceOverride = parseCadenceConfig(assignment.cadenceConfig);
        const effectiveCadence = getEffectiveCadence(
          coachCadence ?? cadenceFromLegacyDays(coach.checkInDaysOfWeek),
          clientCadenceOverride
        );

        const lastCheckIn = await db.checkIn.findFirst({
          where: { clientId: assignment.client.id, deletedAt: null },
          orderBy: { submittedAt: "desc" },
          select: { submittedAt: true, status: true },
        });

        const cadenceResult = getClientCadenceStatus(
          effectiveCadence,
          lastCheckIn ? { submittedAt: lastCheckIn.submittedAt, status: lastCheckIn.status } : null,
          clientTz
        );

        // Only alert coach if the client is overdue
        if (cadenceResult.status !== "overdue") continue;

        try {
          await notifyMissedCheckInAlert(coach.id, assignment.client.firstName || "Your client");
          sentCoachAlerts++;
        } catch (err) {
          console.error(`Failed to send missed alert for coach ${coach.id}`, err);
        }
      }
    }

    return NextResponse.json({ sentClientReminders, sentCoachAlerts });

  } catch (err) {
    console.error("Cron checkin-reminders failed", err);
    return NextResponse.json(
      { error: "Internal error", detail: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
