const appUrl = process.env.APP_URL || "http://localhost:3000";

export function requestReceivedEmail(prospectName: string, coachName: string) {
    const subject = `Request Received — Steadfast`;
    const text = `Hi ${prospectName},

Thanks for reaching out! Your coaching request has been submitted to ${coachName}.

What happens next:
• ${coachName} will review your request
• You'll receive an email once they've made a decision
• This usually takes a few business days

No action needed from you right now — just sit tight.

— Steadfast`;

    return { subject, text };
}

export function newRequestNotificationEmail(coachName: string, prospectName: string, prospectEmail: string) {
    const subject = `New Coaching Request — ${prospectName}`;
    const text = `Hi ${coachName},

You have a new coaching request from ${prospectName} (${prospectEmail}).

Review and respond in your inbox:
${appUrl}/coach/marketplace/requests

— Steadfast`;

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

Welcome aboard!

— Steadfast`;

    return { subject, text };
}

export function waitlistConfirmationEmail(prospectName: string, coachName: string) {
    const subject = `You're on the Waitlist — Steadfast`;
    const text = `Hi ${prospectName},

You've been added to ${coachName}'s waitlist. They'll reach out when a spot opens up.

In the meantime, you can browse other available coaches:
${appUrl}/coaches

— Steadfast`;

    return { subject, text };
}
