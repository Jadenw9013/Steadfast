import { db } from "@/lib/db";
import { sendPushNotification } from "./apns";

// ── Push notification types ──────────────────────────────────────────────────

export type PushType =
  | "NEW_MESSAGE"
  | "CHECKIN_REMINDER"
  | "CHECKIN_OVERDUE"
  | "CHECKIN_REVIEWED"
  | "CHECKIN_FEEDBACK"
  | "MEAL_PLAN_UPDATED"
  | "CLIENT_CHECKIN_SUBMITTED"
  | "MISSED_CHECKIN"
  | "NEW_CLIENT_SIGNUP";

interface PushPayload {
  title: string;
  body: string;
  type: PushType;
  data?: Record<string, string>;
}

// ── Send push to a user by their userId ──────────────────────────────────────

/**
 * Sends an APNs push notification to a user if they have a registered device token.
 * Silently skips if no token is stored. Fire-and-forget — never throws.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { apnsToken: true },
    });

    if (!user?.apnsToken) {
      return { sent: false, reason: "No device token" };
    }

    const apnsPayload = {
      aps: {
        alert: {
          title: payload.title,
          body: payload.body,
        },
        sound: "default",
        badge: 1,
      },
      // Custom data for deep linking
      type: payload.type,
      ...payload.data,
    };

    const result = await sendPushNotification(user.apnsToken, apnsPayload);
    return { sent: true, result };
  } catch (error) {
    console.error(
      `[Push] Failed to send push to user ${userId}:`,
      error
    );
    return { sent: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ── Convenience helpers ──────────────────────────────────────────────────────

export async function pushNewMessage(recipientId: string, senderName: string) {
  return sendPushToUser(recipientId, {
    title: "New Message",
    body: `${senderName} sent you a message`,
    type: "NEW_MESSAGE",
  });
}

export async function pushCheckinReminder(clientId: string) {
  return sendPushToUser(clientId, {
    title: "Check-In Reminder",
    body: "Your check-in is due — submit it so your coach can review your progress.",
    type: "CHECKIN_REMINDER",
  });
}

export async function pushCheckinOverdue(clientId: string) {
  return sendPushToUser(clientId, {
    title: "Check-In Overdue",
    body: "Your check-in is overdue. Submit it now to stay on track.",
    type: "CHECKIN_OVERDUE",
  });
}

export async function pushCheckinReviewed(clientId: string) {
  return sendPushToUser(clientId, {
    title: "Check-In Reviewed",
    body: "Your coach has reviewed your check-in. Tap to view feedback.",
    type: "CHECKIN_REVIEWED",
  });
}

export async function pushMealPlanUpdated(clientId: string, coachName: string) {
  return sendPushToUser(clientId, {
    title: "Meal Plan Updated",
    body: `${coachName} published an updated meal plan for you.`,
    type: "MEAL_PLAN_UPDATED",
  });
}

export async function pushClientCheckinSubmitted(coachId: string, clientName: string) {
  return sendPushToUser(coachId, {
    title: "Check-In Submitted",
    body: `${clientName} submitted their check-in.`,
    type: "CLIENT_CHECKIN_SUBMITTED",
  });
}

export async function pushMissedCheckin(coachId: string, clientName: string) {
  return sendPushToUser(coachId, {
    title: "Missed Check-In",
    body: `${clientName} hasn't checked in and is overdue.`,
    type: "MISSED_CHECKIN",
  });
}

export async function pushNewClientSignup(coachId: string, clientName: string) {
  return sendPushToUser(coachId, {
    title: "New Client",
    body: `${clientName} just signed up.`,
    type: "NEW_CLIENT_SIGNUP",
  });
}
