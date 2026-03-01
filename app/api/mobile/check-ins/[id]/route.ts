import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCheckInById, verifyCoachAccessToCheckIn } from "@/lib/queries/check-ins";
import { db } from "@/lib/db";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        await getCurrentDbUser();
        const { id } = await params;
        const checkIn = await getCheckInById(id);
        if (!checkIn) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json({ checkIn });
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}

export async function PATCH(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await verifyCoachAccessToCheckIn(id);

        await db.checkIn.update({
            where: { id },
            data: { status: "REVIEWED" },
        });

        return NextResponse.json({ success: true });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 403 });
    }
}
