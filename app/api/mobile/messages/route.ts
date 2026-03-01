import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getMessages } from "@/lib/queries/messages";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";

export async function GET(req: NextRequest) {
    try {
        const user = await getCurrentDbUser();
        const { searchParams } = new URL(req.url);
        const clientId = searchParams.get("clientId") || user.id;
        const weekStartDate = searchParams.get("weekStartDate");

        if (!weekStartDate) {
            return NextResponse.json(
                { error: "weekStartDate is required" },
                { status: 400 }
            );
        }

        const weekOf = parseWeekStartDate(weekStartDate);
        const messages = await getMessages(clientId, weekOf);
        return NextResponse.json({ messages });
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentDbUser();
        const { clientId, weekStartDate, body } = await req.json();

        if (!clientId || !weekStartDate || !body) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400 });
        }

        const weekOf = parseWeekStartDate(weekStartDate);

        // Authorization
        if (user.activeRole === "CLIENT" && user.id !== clientId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (user.activeRole === "COACH") {
            const assignment = await db.coachClient.findUnique({
                where: { coachId_clientId: { coachId: user.id, clientId } },
            });
            if (!assignment) {
                return NextResponse.json({ error: "Not assigned" }, { status: 403 });
            }
        }

        const message = await db.message.create({
            data: { clientId, weekOf, senderId: user.id, body },
        });

        return NextResponse.json({ messageId: message.id }, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}
