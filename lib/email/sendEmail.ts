import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || "Steadfast <noreply@steadfast.app>";

let resend: Resend | null = null;

if (resendApiKey) {
    resend = new Resend(resendApiKey);
} else {
    console.warn(
        "[Email] RESEND_API_KEY is not set. Emails will not be sent."
    );
}

export async function sendEmail({
    to,
    subject,
    text,
    html,
}: {
    to: string;
    subject: string;
    text: string;
    html?: string;
}) {
    if (!resend) {
        console.warn("[Email] Email disabled. Would have sent:", {
            to,
            subject,
        });
        return { success: false, error: "Resend not configured" };
    }

    try {
        const result = await resend.emails.send({
            from: emailFrom,
            to,
            subject,
            text,
            html: html || undefined,
        });

        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error("[Email/sendEmail] Failed to send email:", error);
        // Don't throw, let application logic proceed even if email fails
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
