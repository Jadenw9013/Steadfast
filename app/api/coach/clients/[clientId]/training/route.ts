import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";

type Params = { params: Promise<{ clientId: string }> };

// ── GET — training program for a week (draft > published) ─────────────────────

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

    const programSelect = {
      id: true,
      weekOf: true,
      status: true,
      weeklyFrequency: true,
      clientNotes: true,
      injuries: true,
      equipment: true,
      publishedAt: true,
      days: {
        orderBy: { sortOrder: "asc" as const },
        select: {
          id: true,
          dayName: true,
          sortOrder: true,
          blocks: {
            orderBy: { sortOrder: "asc" as const },
            select: {
              id: true,
              type: true,
              title: true,
              content: true,
              sortOrder: true,
            },
          },
        },
      },
    };

    let program = null;
    let source = "empty";

    if (weekOfParam) {
      let weekOf: Date;
      try {
        weekOf = parseWeekStartDate(weekOfParam);
      } catch {
        return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
      }

      const draft = await db.trainingProgram.findFirst({
        where: { clientId, weekOf, status: "DRAFT" },
        select: programSelect,
      });
      if (draft) {
        program = draft;
        source = "draft";
      } else {
        const published = await db.trainingProgram.findFirst({
          where: { clientId, weekOf, status: "PUBLISHED" },
          select: programSelect,
        });
        if (published) {
          program = published;
          source = "published";
        }
      }
    } else {
      // No weekOf — return most recent PUBLISHED program
      const published = await db.trainingProgram.findFirst({
        where: { clientId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: programSelect,
      });
      if (published) {
        program = published;
        source = "published";
      }
    }

    return NextResponse.json({
      source,
      program: program
        ? {
            id: program.id,
            weekOf: program.weekOf.toISOString(),
            status: program.status,
            weeklyFrequency: program.weeklyFrequency,
            clientNotes: program.clientNotes,
            injuries: program.injuries,
            equipment: program.equipment,
            publishedAt: program.publishedAt?.toISOString() ?? null,
            days: program.days,
          }
        : null,
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
