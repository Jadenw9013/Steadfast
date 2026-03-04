import { db } from "@/lib/db";
import { sendSms } from "./sendSms";
import { SMSTemplates } from "./templates";

/**
 * Standardized SMS send handler that enforces universal opt-in, phone number presence,
 * and specific toggle rules without throwing errors back to the caller.
 */
async function triggerSmsEvent({
    userId,
    toggleKeys,
    message,
    logType,
    logMetadata = {},
}: {
    userId: string;
    toggleKeys: ("smsMealPlanUpdates" | "smsDailyCheckInReminder" | "smsCoachMessages" | "smsCheckInFeedback" | "smsClientCheckIns" | "smsMissedCheckInAlerts" | "smsClientMessages" | "smsNewClientSignups")[];
    message: string;
    logType: string;
    logMetadata?: Record<string, any>;
}) {
    try {
        const user = await db.user.findUnique({
            where: { id: userId },
            select: {
                phoneNumber: true,
                smsOptIn: true,
                smsMealPlanUpdates: true,
                smsDailyCheckInReminder: true,
                smsCoachMessages: true,
                smsCheckInFeedback: true,
                smsClientCheckIns: true,
                smsMissedCheckInAlerts: true,
                smsClientMessages: true,
                smsNewClientSignups: true,
            },
        });

        if (!user || !user.smsOptIn || !user.phoneNumber) {
            return { sent: false, skipped: "Not opted in or no phone number" };
        }

        // Check if ALL required toggles are enabled. If any are false, skip sending.
        for (const key of toggleKeys) {
            if (!user[key]) {
                return { sent: false, skipped: `Toggle ${key} is disabled` };
            }
        }

        const result = await sendSms(user.phoneNumber, message);

        if (result.success) {
            await db.notificationLog.create({
                data: {
                    type: logType as any,
                    clientId: userId, // Mapping to clientId for compat, though this can be coach ID too
                    ...logMetadata,
                },
            });
            return { sent: true, messageId: result.messageId };
        }

        return { sent: false, error: result.error };
    } catch (error) {
        console.error(`[triggerSmsEvent] Failed for event ${logType}:`, error);
        return { sent: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
}

// ==========================================
// CLIENT NOTIFICATIONS
// ==========================================

export async function notifyMealPlanUpdated(clientId: string, coachName?: string | null) {
    const client = await db.user.findUnique({ where: { id: clientId }, select: { firstName: true } });
    return triggerSmsEvent({
        userId: clientId,
        toggleKeys: ["smsMealPlanUpdates"],
        message: SMSTemplates.mealPlanUpdated(client?.firstName, coachName),
        logType: "MEAL_PLAN_UPDATE",
    });
}

export async function notifyDailyCheckInReminder(clientId: string) {
    return triggerSmsEvent({
        userId: clientId,
        toggleKeys: ["smsDailyCheckInReminder"],
        message: SMSTemplates.dailyCheckInReminder(),
        logType: "DAILY_CHECKIN_REMINDER",
    });
}

export async function notifyCoachMessage(clientId: string) {
    return triggerSmsEvent({
        userId: clientId,
        toggleKeys: ["smsCoachMessages"],
        message: SMSTemplates.coachMessage(),
        logType: "COACH_MESSAGE",
    });
}

export async function notifyCheckInFeedback(clientId: string) {
    return triggerSmsEvent({
        userId: clientId,
        toggleKeys: ["smsCheckInFeedback"],
        message: SMSTemplates.checkInFeedback(),
        logType: "CHECKIN_FEEDBACK",
    });
}

// ==========================================
// COACH NOTIFICATIONS
// ==========================================

export async function notifyClientCheckInSubmitted(coachId: string, clientName: string) {
    return triggerSmsEvent({
        userId: coachId,
        toggleKeys: ["smsClientCheckIns"],
        message: SMSTemplates.clientCheckInSubmitted(clientName),
        logType: "CLIENT_CHECKIN_SUBMITTED",
    });
}

export async function notifyMissedCheckInAlert(coachId: string, clientName: string) {
    return triggerSmsEvent({
        userId: coachId,
        toggleKeys: ["smsMissedCheckInAlerts"],
        message: SMSTemplates.missedCheckInAlert(clientName),
        logType: "MISSED_CHECKIN_ALERT",
    });
}

export async function notifyNewClientSignup(coachId: string, clientName: string) {
    return triggerSmsEvent({
        userId: coachId,
        toggleKeys: ["smsNewClientSignups"],
        message: SMSTemplates.newClientSignup(clientName),
        logType: "NEW_CLIENT_SIGNUP",
    });
}

export async function notifyClientMessage(coachId: string, clientName: string) {
    return triggerSmsEvent({
        userId: coachId,
        toggleKeys: ["smsClientMessages"],
        message: SMSTemplates.clientMessage(clientName),
        logType: "CLIENT_MESSAGE",
    });
}
