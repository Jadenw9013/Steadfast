import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { formatDateUTC } from "@/lib/utils/date";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId query param is required" },
        { status: 400 }
      );
    }

    // Authorization
    if (user.activeRole === "CLIENT" || user.isClient) {
      if (user.id !== clientId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (user.isCoach) {
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: user.id, clientId } },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Distinct weekOf values, most recent first
    const rows = await db.message.findMany({
      where: { clientId },
      distinct: ["weekOf"],
      orderBy: { weekOf: "desc" },
      select: { weekOf: true },
    });

    return NextResponse.json({
      weeks: rows.map((r) => formatDateUTC(r.weekOf)),
    });
  } catch (err) {
    console.error("[GET /api/messages/weeks]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
