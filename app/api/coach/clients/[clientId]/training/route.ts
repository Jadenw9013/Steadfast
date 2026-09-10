import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate, getCurrentWeekMonday } from "@/lib/utils/date";

type Params = { params: Promise<{ clientId: string }> };

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

async function verifyAssignment(coachId: string, clientId: string) {
  return db.coachClient.findUnique({
    where: { coachId_clientId: { coachId, clientId } },
    select: { id: true },
  });
}

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

    if (!(await verifyAssignment(user.id, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const weekOfParam = searchParams.get("weekOf");

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
      // Server-computed "current week" — clients should prefer this over
      // any on-device date math when seeding a brand-new program's weekOf.
      currentWeekOf: getCurrentWeekMonday().toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST — create a new draft training program ────────────────────────────────

const createTrainingDraftSchema = z.object({
  weekOf: z.string().min(1),
  copyFromPublished: z.boolean().default(false),
  weeklyFrequency: z.number().int().min(1).max(7).optional(),
  clientNotes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
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

    if (!(await verifyAssignment(user.id, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createTrainingDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { weekOf: weekOfParam, copyFromPublished, weeklyFrequency, clientNotes } = parsed.data;
    let weekOf: Date;
    try {
      weekOf = parseWeekStartDate(weekOfParam);
    } catch {
      return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
    }

    // Seed days from published if requested
    type BlockSeed = { type: string; title: string | null; content: string | null; sortOrder: number };
    type DaySeed = { dayName: string | null; sortOrder: number; blocks: BlockSeed[] };
    let daysToCreate: DaySeed[] = [];

    if (copyFromPublished) {
      const published = await db.trainingProgram.findFirst({
        where: { clientId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: {
          days: {
            orderBy: { sortOrder: "asc" },
            select: {
              dayName: true,
              sortOrder: true,
              blocks: {
                orderBy: { sortOrder: "asc" },
                select: { type: true, title: true, content: true, sortOrder: true },
              },
            },
          },
        },
      });
      if (published) {
        daysToCreate = published.days.map(d => ({ ...d, dayName: d.dayName ?? "" }));
      }
    }

    const program = await db.trainingProgram.create({
      data: {
        clientId,
        weekOf,
        status: "DRAFT",
        weeklyFrequency: weeklyFrequency ?? null,
        clientNotes: clientNotes ?? null,
        days: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: daysToCreate.map((d) => ({
            dayName: d.dayName || undefined,
            sortOrder: d.sortOrder,
            blocks: { create: d.blocks },
          })) as any,
        },
      },
      select: { id: true, weekOf: true, status: true },
    });

    return NextResponse.json({ program }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── PUT — replace all days + blocks in a draft program ───────────────────────

const blockSchema = z.object({
  type: z.enum(["TEXT", "EXERCISE"]),
  title: z.string().max(200).nullable().optional(),
  content: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0),
});

const daySchema = z.object({
  dayName: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().min(0),
  blocks: z.array(blockSchema).max(30),
});

const saveTrainingDraftSchema = z.object({
  programId: z.string().min(1),
  days: z.array(daySchema).max(14),
  weeklyFrequency: z.number().int().min(1).max(7).optional().nullable(),
  clientNotes: z.string().max(2000).optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: Params) {
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

    if (!(await verifyAssignment(user.id, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = saveTrainingDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { programId, days, weeklyFrequency, clientNotes } = parsed.data;

    const program = await db.trainingProgram.findUnique({
      where: { id: programId },
      select: { clientId: true, status: true },
    });
    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    if (program.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Atomic replace: delete all days (cascades to blocks), recreate
    await db.$transaction(async (tx) => {
      await tx.trainingDay.deleteMany({ where: { programId } });

      for (const day of days) {
        await tx.trainingDay.create({
          data: {
            programId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dayName: (day.dayName || undefined) as any,
            sortOrder: day.sortOrder,
            blocks: {
              create: day.blocks.map((b) => ({
                type: b.type,
                title: b.title ?? null,
                content: b.content ?? null,
                sortOrder: b.sortOrder,
              })),
            },
          },
        });
      }

      await tx.trainingProgram.update({
        where: { id: programId },
        data: {
          weeklyFrequency: weeklyFrequency ?? null,
          clientNotes: clientNotes ?? null,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
