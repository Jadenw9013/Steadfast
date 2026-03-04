import { NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(req: Request) {
    // DEV ONLY: must return 404 in production.
    if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const devKey = process.env.DEV_SMS_KEY;
    const { searchParams } = new URL(req.url);
    const providedKey = searchParams.get("key") || req.headers.get("x-dev-key");

    if (devKey && providedKey !== devKey) {
        return NextResponse.json({ error: "Unauthorized - Invalid dev key" }, { status: 401 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    const missing = [];
    if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!authToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!messagingServiceSid) missing.push("TWILIO_MESSAGING_SERVICE_SID");

    if (missing.length > 0) {
        return NextResponse.json({
            ok: false,
            error: "Missing required environment variables",
            missing
        }, { status: 500 });
    }

    try {
        const client = twilio(accountSid, authToken);
        const message = await client.messages.create({
            body: `Steadfast Twilio smoke test: ${new Date().toISOString()}`,
            messagingServiceSid: messagingServiceSid,
            to: "+14253629948"
        });

        return NextResponse.json({
            ok: true,
            sid: message.sid,
            status: message.status
        });
    } catch (error: any) {
        return NextResponse.json({
            ok: false,
            error: error.message || "Unknown error",
            code: error.code,
            moreInfo: error.moreInfo
        }, { status: 500 });
    }
}
