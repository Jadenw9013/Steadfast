const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

const FOOTER = "\n\n—\nThis is an automated message from Steadfast. Replies are not monitored.";

export function requestReceivedEmail(prospectName: string, coachName: string) {
    const subject = `Request Received — Steadfast`;
    const text = `Hi ${prospectName},

Thanks for reaching out! Your coaching request has been submitted to ${coachName}.

What happens next:
• ${coachName} will review your request
• You'll receive an email once they've made a decision
• This usually takes a few business days

No action needed from you right now — just sit tight.${FOOTER}`;

    return { subject, text };
}

export function newRequestNotificationEmail(coachName: string, prospectName: string, prospectEmail: string) {
    const subject = `New Coaching Request — ${prospectName}`;
    const text = `Hi ${coachName},

You have a new coaching request from ${prospectName} (${prospectEmail}).

Review and respond in your inbox:
${appUrl}/coach/marketplace/requests${FOOTER}`;

    return { subject, text };
}

export function requestApprovedEmail(prospectName: string, coachName: string) {
    const signUpUrl = `${appUrl}/sign-up`;
    const subject = `You're In — ${coachName} Accepted Your Request`;
    const text = `Hi ${prospectName},

Great news — ${coachName} has accepted your coaching request!

Next step: Create your Steadfast account to get started.

Sign up here:
${signUpUrl}

Use the same email address you submitted your request with so we can connect you automatically.

Welcome aboard!${FOOTER}`;

    return { subject, text };
}

export function waitlistConfirmationEmail(prospectName: string, coachName: string) {
    const subject = `You're on the Waitlist — Steadfast`;
    const text = `Hi ${prospectName},

You've been added to ${coachName}'s waitlist. They'll reach out when a spot opens up.

In the meantime, you can browse other available coaches:
${appUrl}/coaches${FOOTER}`;

    return { subject, text };
}

// ── Transactional Notifications ──────────────────────────────────────────────

export function coachConnectedEmail(clientName: string, coachName: string) {
    const subject = `You're connected to ${coachName}`;
    const text = `Hi ${clientName},

You've been connected to ${coachName} on Steadfast. Your coach can now assign meal plans, training programs, and communicate with you directly.

Get started:
${appUrl}/client${FOOTER}`;

    return { subject, text };
}

export function checkinReminderEmail(clientName: string) {
    const subject = `Check-in reminder`;
    const text = `Hi ${clientName},

Your check-in is due. Submit it now so your coach can review your progress.

Submit check-in:
${appUrl}/client/check-in${FOOTER}`;

    return { subject, text };
}

export function clientCheckinSubmittedEmail(coachName: string, clientName: string) {
    const subject = `${clientName} submitted a check-in`;
    const text = `Hi ${coachName},

${clientName} has submitted their check-in and it's ready for your review.

Review now:
${appUrl}/coach/dashboard${FOOTER}`;

    return { subject, text };
}

export function checkinReviewedEmail(clientName: string) {
    const subject = `Your check-in has been reviewed`;
    const text = `Hi ${clientName},

Your coach has reviewed your latest check-in. Log in to see their feedback.

View feedback:
${appUrl}/client${FOOTER}`;

    return { subject, text };
}

export function mealPlanUpdatedEmail(clientName: string, coachName: string) {
    const subject = `Your meal plan has been updated`;
    const text = `Hi ${clientName},

${coachName} has published an updated meal plan for you.

View your plan:
${appUrl}/client/meal-plan${FOOTER}`;

    return { subject, text };
}

export function newMessageEmail(recipientName: string, senderName: string, ctaUrl: string) {
    const subject = `New message from ${senderName}`;
    const text = `Hi ${recipientName},

${senderName} sent you a message on Steadfast.

View message:
${appUrl}${ctaUrl}${FOOTER}`;

    return { subject, text };
}

export function welcomeEmail(name: string) {
    const subject = `Welcome to Steadfast`;
    const text = `Hi ${name},

Your Steadfast account is ready. Your coach can now share meal plans, training programs, and check in with you directly.

Get started:
${appUrl}/client${FOOTER}`;

    return { subject, text };
}
