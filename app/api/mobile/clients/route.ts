import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachClientsWithWeekStatus } from "@/lib/queries/check-ins";

export async function GET() {
    try {
        const user = await getCurrentDbUser();
        if (user.activeRole !== "COACH") {
            return NextResponse.json({ error: "Not a coach" }, { status: 403 });
        }
        const clients = await getCoachClientsWithWeekStatus(user.id);
        return NextResponse.json({ clients });
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}
