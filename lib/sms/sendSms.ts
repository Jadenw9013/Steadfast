import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

let client: twilio.Twilio | null = null;

if (accountSid && authToken) {
    client = twilio(accountSid, authToken);
} else {
    console.warn(
        "[Twilio] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set. SMS messages will not be sent."
    );
}

export async function sendSms(to: string, body: string) {
    if (!client || !messagingServiceSid) {
        console.warn("[Twilio] SMS disabled or missing messaging service SID. Would have sent:", {
            to,
            body,
        });
        return { success: false, error: "Twilio not configured" };
    }

    try {
        const message = await client.messages.create({
            body,
            messagingServiceSid,
            to,
        });

        return { success: true, messageId: message.sid };
    } catch (error) {
        console.error("[Twilio/sendSms] Failed to send SMS:", error);
        // Don't throw, let application logic proceed even if SMS fails
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}