const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const SMSTemplates = {
    mealPlanUpdated: (clientName?: string | null, coachName?: string | null) =>
        `Hi ${clientName || "there"}, coach ${coachName || "your coach"} has updated your meal plan. View it here: ${APP_URL}/client`,

    dailyCheckInReminder: () =>
        `Reminder: Please submit your daily check-in for today. ${APP_URL}/client/check-in`,

    coachMessage: () =>
        `You have a new message from your coach. Log in to view: ${APP_URL}/client`,

    checkInFeedback: () =>
        `Your coach has left feedback on your recent check-in. View it here: ${APP_URL}/client`,

    clientCheckInSubmitted: (clientName: string) =>
        `${clientName} has submitted their check-in. Review it here: ${APP_URL}/coach`,

    missedCheckInAlert: (clientName: string) =>
        `Alert: ${clientName} missed their check-in today.`,

    newClientSignup: (clientName: string) =>
        `New sign up! ${clientName} has joined your coaching roster. ${APP_URL}/coach`,

    clientMessage: (clientName: string) =>
        `New message from ${clientName}. Log in to reply: ${APP_URL}/coach`,
};
