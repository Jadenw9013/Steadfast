import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate, getCurrentWeekMonday } from "@/lib/utils/date";
import {
  getTrainingProgramForReview,
  getLatestPublishedTrainingProgramForCoach,
} from "@/lib/queries/training-programs";

type Params = { params: Promise<{ clientId: string }> };

// T-880 finding 3: thrown when the guarded updateMany inside the day-rewrite
// transaction matches zero rows because a concurrent publish (another
// transport, e.g. iOS) flipped the target out of DRAFT between the status
// read above and this write. Distinguished from other transaction failures
// so the outer catch can report 409 instead of 500.
class ProgramPublishedDuringSaveError extends Error {}

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
    let carriedOverFromWeekOf: string | null = null;

    if (weekOfParam) {
      let weekOf: Date;
      try {
        weekOf = parseWeekStartDate(weekOfParam);
      } catch {
        return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
      }

      const result = await getTrainingProgramForReview(clientId, weekOf);
      program = result.program;
      source = result.source;
      carriedOverFromWeekOf = result.carriedOverFrom ? result.carriedOverFrom.toISOString() : null;
    } else {
      const published = await getLatestPublishedTrainingProgramForCoach(clientId);
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
      carriedOverFromWeekOf,
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
      select: {
        id: true,
        clientId: true,
        weekOf: true,
        status: true,
        injuries: true,
        equipment: true,
        templateSourceId: true,
        weeklyFrequency: true,
        clientNotes: true,
      },
    });
    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    if (program.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isForking = program.status !== "DRAFT";
    // Finding 5: a fork must be a faithful copy plus the caller's overrides —
    // an omitted (`undefined`) field inherits the target's value, matching
    // the `!== undefined` rule used by team/sprint-1's saveTrainingProgramContent
    // merge. A genuine DRAFT-direct edit keeps its pre-existing "omitted clears
    // the field" behaviour untouched (byte-identical to before this fix).
    const finalWeeklyFrequency = isForking
      ? weeklyFrequency === undefined
        ? program.weeklyFrequency
        : weeklyFrequency
      : weeklyFrequency ?? null;
    const finalClientNotes = isForking
      ? clientNotes === undefined
        ? program.clientNotes
        : clientNotes
      : clientNotes ?? null;

    let targetProgramId = programId;
    let forkedNewProgramId: string | null = null;

    // Atomic replace: delete all days (cascades to blocks), recreate.
    // T-880 finding 3: the fork create is now INSIDE this transaction (round 2
    // finding H). Previously it ran before $transaction opened, so a failure
    // partway through the day rewrite left a bare, empty DRAFT row behind —
    // and both coach reads prefer a DRAFT over a PUBLISHED row for the same
    // week, so the coach's next load showed a blank editor for a week that
    // still has published content. Now a failed save rolls back the fork
    // itself; the coach reloads into the unchanged PUBLISHED program instead
    // (release-safety: degrade, never disappear).
    // The guarded updateMany runs before any destructive write. On the fork
    // branch it targets a row created earlier in this same transaction
    // (status DRAFT, so this is a no-op safety net, not reachable code for
    // the 409). On the non-fork branch it targets the row read as DRAFT
    // above, which a concurrent publish (another transport) could have
    // flipped since that read. A zero-row result means exactly that: refuse
    // the write and report, instead of silently rewriting a PUBLISHED row.
    await db.$transaction(async (tx) => {
      if (isForking) {
        // CB04 / T-880: the client may be reading this row right now. Fork instead of
        // rewriting it; the request body cannot express injuries/equipment/templateSourceId,
        // so those are inherited from the row being forked.
        const forked = await tx.trainingProgram.create({
          data: {
            clientId,
            weekOf: program.weekOf,
            status: "DRAFT",
            weeklyFrequency: finalWeeklyFrequency,
            clientNotes: finalClientNotes,
            injuries: program.injuries,
            equipment: program.equipment,
            templateSourceId: program.templateSourceId,
          },
          select: { id: true },
        });
        targetProgramId = forked.id;
        forkedNewProgramId = forked.id;
      }

      const guarded = await tx.trainingProgram.updateMany({
        where: { id: targetProgramId, status: "DRAFT" },
        data: {
          weeklyFrequency: finalWeeklyFrequency,
          clientNotes: finalClientNotes,
        },
      });
      if (guarded.count === 0) {
        throw new ProgramPublishedDuringSaveError();
      }

      await tx.trainingDay.deleteMany({ where: { programId: targetProgramId } });

      for (const day of days) {
        await tx.trainingDay.create({
          data: {
            programId: targetProgramId,
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
    },
      // T-880 review r3 finding 4: this transaction is strictly LARGER than the
      // Server Action's (it can carry the fork create as well) and it is the
      // path the iOS app uses, so it gets the same explicit headroom rather
      // than relying on Prisma's 5000ms default. Same reasoning as
      // app/actions/training-programs.ts: the measured shape is ~28ms locally
      // and the day count is capped at 14 by both schemas, so 15000ms is
      // headroom against a slow Neon window, not a response to a tight budget.
      { timeout: 15000 },
    );

    return NextResponse.json({
      success: true,
      ...(forkedNewProgramId !== null ? { forkedNewProgramId } : {}),
    });
  } catch (err) {
    if (err instanceof ProgramPublishedDuringSaveError) {
      return NextResponse.json({ error: "PROGRAM_PUBLISHED_DURING_SAVE" }, { status: 409 });
    }
    console.error("[PUT /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
