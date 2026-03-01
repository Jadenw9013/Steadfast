import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getClientProfile } from "@/lib/queries/client-profile";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    try {
        const user = await getCurrentDbUser();
        if (user.activeRole !== "COACH") {
            return NextResponse.json({ error: "Not a coach" }, { status: 403 });
        }
        const { clientId } = await params;
        const profile = await getClientProfile(user.id, clientId);
        if (!profile) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json(profile);
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}
