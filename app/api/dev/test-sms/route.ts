import { NextResponse } from "next/server";
import { sendSms } from "@/lib/sms/sendSms";
import { getCurrentDbUser } from "@/lib/auth/roles";

export async function POST() {
    // Guard: Protect from production usage
    if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
        const client = await getCurrentDbUser();

        if (!client) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!client || !client.phoneNumber) {
            return NextResponse.json({ error: "No phone number configured" }, { status: 400 });
        }

        if (!client.smsOptIn) {
            return NextResponse.json({ error: "User has not opted into SMS" }, { status: 400 });
        }

        const { success, messageId, error } = await sendSms(
            client.phoneNumber,
            `Hello from Steadfast! This is a test SMS message sent at ${new Date().toLocaleTimeString()}.`
        );

        if (!success) {
            return NextResponse.json({ error: "Failed to send SMS", details: error }, { status: 500 });
        }

        return NextResponse.json({ success: true, messageId });
    } catch (error) {
        console.error("[dev/test-sms] Internal error:", error);
        return NextResponse.json(
            {
                error: "Failed to send SMS",
            },
            { status: 500 }
        );
    }
}
