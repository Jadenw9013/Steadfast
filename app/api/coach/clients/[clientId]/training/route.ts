import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate, getCurrentWeekMonday } from "@/lib/utils/date";
import {
  clientNotesSchema,
  createTrainingProgramDraft,
  getTrainingSaveTarget,
  saveTrainingProgramContent,
  trainingDaysSchema,
  weeklyFrequencySchema,
  type TrainingDayInput,
} from "@/lib/training-programs/drafts";
import { ROUTE_FAILED } from "@/lib/observability/events";
import { reportServerError } from "@/lib/observability/report";

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
    reportServerError(ROUTE_FAILED.evt, err, {
      route: "/api/coach/clients/[id]/training",
      method: "GET",
      statusCode: 500,
      context: { handler: "GET training" },
      allow: ROUTE_FAILED.allow,
    });
    console.error("[GET /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST — create a new draft training program ────────────────────────────────

// `weeklyFrequency`/`clientNotes` are the shared schemas, identical to PUT's —
// POST used to declare its own copies, so `{"weeklyFrequency": "3"}` 422ed here
// while the same value succeeded on PUT (only the shared schema coerces, and the
// web editor's `<select>` sends a string). One predicate, both methods (T-622).
const createTrainingDraftSchema = z.object({
  weekOf: z.string().min(1),
  copyFromPublished: z.boolean().default(false),
  weeklyFrequency: weeklyFrequencySchema.optional().nullable(),
  clientNotes: clientNotesSchema.optional().nullable(),
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

    // Seed days from published if requested. The rows come straight out of the
    // DB, so they already satisfy TrainingDayInput (dayName/title/content are
    // NOT NULL columns and type is a real BlockType) — no cast, and no
    // `dayName || undefined`, which used to turn a published day named "" into
    // a 500 on a required column.
    let daysToCreate: TrainingDayInput[] = [];

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
        daysToCreate = published.days;
      }
    }

    const { programId } = await createTrainingProgramDraft({
      clientId,
      weekOf,
      days: daysToCreate,
      metadata: {
        weeklyFrequency: weeklyFrequency ?? null,
        clientNotes: clientNotes ?? null,
      },
    });

    return NextResponse.json(
      { program: { id: programId, weekOf, status: "DRAFT" } },
      { status: 201 }
    );
  } catch (err) {
    reportServerError(ROUTE_FAILED.evt, err, {
      route: "/api/coach/clients/[id]/training",
      method: "POST",
      statusCode: 500,
      context: { handler: "POST training" },
      allow: ROUTE_FAILED.allow,
    });
    console.error("[POST /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── PUT — replace all days + blocks in a draft program ───────────────────────

// The day/block schemas come from lib/training-programs/drafts.ts, the single
// writer of training-program content, shared verbatim with the
// `saveTrainingProgram` Server Action. This route used to declare its own copy
// accepting only `["TEXT", "EXERCISE"]` — `"TEXT"` is not a member of
// `enum BlockType` (it could only ever 500 at the DB) and the four legitimate
// non-exercise types were rejected with 422 while the action accepted them
// (T-622). Do not redeclare them here.
const saveTrainingDraftSchema = z.object({
  programId: z.string().min(1),
  days: trainingDaysSchema,
  weeklyFrequency: weeklyFrequencySchema.optional().nullable(),
  clientNotes: clientNotesSchema.optional().nullable(),
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

    const target = await getTrainingSaveTarget(programId);
    if (!target) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    if (target.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // CB05 (never demote or mutate a PUBLISHED/SUPERSEDED program in place —
    // fork a new draft carrying the submitted content instead) lives in the
    // shared service, so this route and the Server Action can never disagree.
    // `injuries`/`equipment`/`templateSourceId` are deliberately absent from
    // the metadata: this surface does not carry them, so they must be left
    // alone (and inherited by a fork) rather than cleared.
    const { forkedNewProgramId } = await saveTrainingProgramContent(target, {
      days,
      metadata: {
        weeklyFrequency: weeklyFrequency ?? null,
        clientNotes: clientNotes ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      programId,
      ...(forkedNewProgramId && { forkedNewProgramId }),
    });
  } catch (err) {
    reportServerError(ROUTE_FAILED.evt, err, {
      route: "/api/coach/clients/[id]/training",
      method: "PUT",
      statusCode: 500,
      context: { handler: "PUT training" },
      allow: ROUTE_FAILED.allow,
    });
    console.error("[PUT /api/coach/clients/[clientId]/training]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
