import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate, formatDateUTC } from "@/lib/utils/date";

type Params = { params: Promise<{ clientId: string }> };

// ── GET — message thread for a client ────────────────────────────────────────
// Query params: weekOf (optional — returns all weeks if omitted)

export async function GET(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { clientId } = await params;

    // Verify assignment
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const weekOfParam = searchParams.get("weekOf");

    if (weekOfParam) {
      // Return messages for a specific week
      let weekOf: Date;
      try {
        weekOf = parseWeekStartDate(weekOfParam);
      } catch {
        return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
      }

      const messages = await db.message.findMany({
        where: { clientId, weekOf },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          senderId: true,
          weekOf: true,
          createdAt: true,
        },
      });

      return NextResponse.json({
        messages: messages.map((m) => ({
          id: m.id,
          content: m.body,
          senderId: m.senderId,
          weekOf: m.weekOf.toISOString(),
          createdAt: m.createdAt.toISOString(),
          isDraft: false,
        })),
      });
    }

    // Return distinct weeks
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
    console.error("[GET /api/coach/clients/[clientId]/messages]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
