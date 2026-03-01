import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";

export async function GET() {
    try {
        const user = await getCurrentDbUser();
        return NextResponse.json({
            id: user.id,
            clerkId: user.clerkId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            activeRole: user.activeRole,
            isCoach: user.isCoach,
            isClient: user.isClient,
            coachCode: user.coachCode,
            timezone: user.timezone,
        });
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}
