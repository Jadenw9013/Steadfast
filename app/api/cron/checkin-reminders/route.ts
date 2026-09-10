import { isReminderHour } from "@/lib/scheduling/reminder-time";
import { claimDailyReminder } from "@/lib/security/quota";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { notifyDailyCheckInReminder, notifyMissedCheckInAlert } from "@/lib/sms/notify";
import { sendEmail } from "@/lib/email/sendEmail";
import { checkinReminderEmail, checkinOverdueEmail } from "@/lib/email/templates";
import { pushCheckinReminder, pushCheckinOverdue } from "@/lib/notifications/push";
import { getLocalDate } from "@/lib/utils/date";
import { parseCadenceConfig, getEffectiveCadence, getClientCadenceStatus, cadenceFromLegacyDays } from "@/lib/scheduling/cadence";

/** Timing-safe bearer token comparison. */
function verifyCronSecret(authHeader: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const actual = authHeader || "";
  const bufA = Buffer.from(actual);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sentClientReminders = 0;
  let sentEmailReminders = 0;
  let sentCoachAlerts = 0;

  try {
    const serverTime = new Date();

    // ── Client reminders ──────────────────────────────────────────────────────
    // Find all active clients with coach assignments who might need reminders
    const clientsToRemind = await db.user.findMany({
      where: {
        activeRole: "CLIENT",
        isDeactivated: false,
        clientAssignments: { some: {} },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        timezone: true,
        smsOptIn: true,
        smsDailyCheckInReminder: true,
        smsCheckInReminderTime: true,
        emailCheckInReminders: true,
        pushCheckInReminders: true,
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
      if (!isReminderHour(client.smsCheckInReminderTime, client.timezone || "America/Los_Angeles", serverTime)) {
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

      if (!await claimDailyReminder("client", client.id, localDate)) continue;
      // Respect the client's push preference independently of SMS/email.
      if (client.pushCheckInReminders && cadenceResult.status === "overdue") {
        pushCheckinOverdue(client.id).catch(console.error);
      } else if (client.pushCheckInReminders) {
        pushCheckinReminder(client.id).catch(console.error);
      }

      // SMS reminder (if opted in)
      if (client.smsOptIn && client.smsDailyCheckInReminder) {
        try {
          await notifyDailyCheckInReminder(client.id);
          sentClientReminders++;
        } catch (err) {
          console.error(`Failed to send SMS reminder to client ${client.id}`, err);
        }
      }

      // Email reminder (if opted in, with dedupe via NotificationLog)
      if (client.emailCheckInReminders && client.email) {
        try {
          // Dedupe: check if we already sent an email reminder today
          const windowDate = new Date(localDate + "T00:00:00.000Z");
          const existing = await db.notificationLog.findUnique({
            where: {
              reminder_dedupe: {
                clientId: client.id,
                windowStartDate: windowDate,
                type: "CHECKIN_REMINDER",
                stage: cadenceResult.status === "overdue" ? "OVERDUE" : "PRE_DUE",
              },
            },
          });
          if (!existing) {
            // Use overdue template if overdue, standard reminder if due
            const email = cadenceResult.status === "overdue"
              ? checkinOverdueEmail(client.firstName || "there")
              : checkinReminderEmail(client.firstName || "there");
            const result = await sendEmail({ to: client.email, ...email });
            if (result.success) {
              await db.notificationLog.create({
                data: {
                  type: "CHECKIN_REMINDER",
                  clientId: client.id,
                  windowStartDate: windowDate,
                  stage: cadenceResult.status === "overdue" ? "OVERDUE" : "PRE_DUE",
                },
              });
              sentEmailReminders++;
            }
          }
        } catch (err) {
          console.error(`Failed to send email reminder to client ${client.id}`, err);
        }
      }
    }

    // ── Coach missed-check-in alerts ──────────────────────────────────────────
    const coachesToAlert = await db.user.findMany({
      where: {
        activeRole: "COACH",
        isDeactivated: false,
        smsOptIn: true,
        smsMissedCheckInAlerts: true,
      },
      select: {
        id: true,
        smsMissedCheckInAlertTime: true,
        timezone: true,
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
      if (!isReminderHour(coach.smsMissedCheckInAlertTime, coach.timezone || "America/Los_Angeles", serverTime)) {
        continue;
      }

      if (!await claimDailyReminder("coach", coach.id, getLocalDate(serverTime, coach.timezone || "America/Los_Angeles"))) continue;
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

    // ── Purge expired account deletions (piggybacked on this cron) ──────────
    let purgeResult = { processed: 0, errors: 0 };
    try {
      const { sweepAccountDeletions } = await import("@/lib/account-deletion/sweep");
      purgeResult = await sweepAccountDeletions();
    } catch (err) {
      console.error("[cron] purge sweep error:", err);
    }

    return NextResponse.json({ sentClientReminders, sentEmailReminders, sentCoachAlerts, purge: purgeResult });

  } catch (err) {
    console.error("Cron checkin-reminders failed", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
