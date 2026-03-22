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
${appUrl}/coach/leads${FOOTER}`;

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

export function requestDeclinedEmail(prospectName: string, coachName: string) {
    const subject = `Update on Your Coaching Request — Steadfast`;
    const text = `Hi ${prospectName},

Thanks for your interest in working with ${coachName}. Unfortunately, they're unable to take on new clients at this time.

This doesn't reflect on you — coaches have limited availability and may not be the right fit for every request.

Browse other available coaches:
${appUrl}/coaches

We're confident you'll find the right coach for your goals.${FOOTER}`;

    return { subject, text };
}

export function newTestimonialEmail(coachName: string, clientName: string) {
    const subject = `New Review from ${clientName}`;
    const text = `Hi ${coachName},

${clientName} just left you a verified review on your Steadfast coaching profile.

View your testimonials:
${appUrl}/coach/marketplace/profile

Verified reviews help build trust with potential clients. Thank your client for sharing their experience!${FOOTER}`;

    return { subject, text };
}

export function formsForSignatureEmail(prospectName: string, coachName: string, signLink: string) {
    const subject = `${coachName} has sent you forms to review and sign`;
    const text = `Hi ${prospectName},

${coachName} has prepared your coaching intake forms and they're ready for you to review.

All you need to do is:
1. Click the link below
2. Review your information
3. Add your signature

Review and sign here:
${signLink}

This link expires in 7 days. If it expires before you get to it, just ask ${coachName} to resend.

If you have any questions about the forms, reach out to ${coachName} directly.${FOOTER}`;

    return { subject, text };
}

export function formsSignedNotificationEmail(coachName: string, prospectName: string, leadUrl: string) {
    const subject = `${prospectName} has signed their forms — ready to activate`;
    const text = `Hi ${coachName},

${prospectName} has reviewed and signed their intake forms.

You can now activate them as a client:
${leadUrl}${FOOTER}`;

    return { subject, text };
}

export function clientActivatedWelcomeEmail(name: string, coachName: string, dashboardUrl: string) {
    const subject = `You're officially coaching with ${coachName} on Steadfast`;
    const text = `Hi ${name},

Welcome! ${coachName} has activated your coaching profile on Steadfast.

You can now access your plans, submit check-ins, and message your coach directly.

Go to your dashboard:
${dashboardUrl}${FOOTER}`;

    return { subject, text };
}

export function clientActivatedInviteEmail(name: string, coachName: string, inviteUrl: string) {
    const subject = `You're all set — here's how to access your coaching on Steadfast`;
    const text = `Hi ${name},

Welcome! ${coachName} has set up your coaching profile on Steadfast.

To access your plans and check in with your coach, you'll need to create your Steadfast account. This only takes a minute — your intake information is already saved.

Create your account:
${inviteUrl}${FOOTER}`;

    return { subject, text };
}

export function intakePacketSentEmail(prospectName: string, coachName: string, intakeUrl: string, docCount: number) {
    const subject = `${coachName} has sent you forms to complete`;
    const docsLine = docCount > 0 ? `, plus ${docCount} document${docCount > 1 ? "s" : ""} to review and sign` : "";
    const text = `Hi ${prospectName},

${coachName} has sent you some forms to fill out before your coaching begins.

This includes a short questionnaire about your goals and health${docsLine}.

Open my forms:
${intakeUrl}

This takes about 5-10 minutes. Your link is valid for 14 days.${FOOTER}`;

    return { subject, text };
}

export function intakeSubmittedNotificationEmail(prospectName: string, reviewUrl: string) {
    const subject = `${prospectName} has completed their intake forms`;
    const text = `${prospectName} filled out their intake packet.

Review their answers:
${reviewUrl}

Submitted: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${FOOTER}`;

    return { subject, text };
}
