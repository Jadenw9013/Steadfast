import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday, getLocalDate } from "@/lib/utils/date";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const weekOfParam = searchParams.get("weekOf");

    const weekOf = weekOfParam
      ? normalizeToMonday(new Date(weekOfParam))
      : normalizeToMonday(new Date());

    const results = await db.exerciseResult.findMany({
      where: { clientId: user.id, weekOf },
      select: {
        id: true,
        exerciseName: true,
        programDay: true,
        setNumber: true,
        weight: true,
        reps: true,
        weekOf: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      results: results.map((r) => ({
        id: r.id,
        exerciseName: r.exerciseName,
        programDay: r.programDay,
        setNumber: r.setNumber,
        weight: r.weight,
        reps: r.reps,
        weekOf: r.weekOf.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[GET /api/client/training/results]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

const saveResultSchema = z.object({
  exerciseName: z.string().min(1).max(200),
  programDay: z.string().min(1).max(200),
  setNumber: z.number().int().positive().default(1),
  weekOf: z.string().optional(),
  weight: z.number().min(0).max(9999).optional(),
  reps: z.number().int().min(0).max(999).optional(),
});

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = saveResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { exerciseName, programDay, setNumber, weight, reps } = parsed.data;

    // Verify client has a coach assignment (mirrors server action)
    const assignment = await db.coachClient.findFirst({
      where: { clientId: user.id },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "No coach assignment" }, { status: 403 });
    }

    // CB08: uniqueness is keyed on the actual calendar day this session
    // happened, not the week — a program day repeated more than once in the
    // same week must not collide with and silently overwrite an earlier
    // session. When the caller logs for "now" (no explicit weekOf), that's
    // the client's local today; when backfilling an explicit past weekOf
    // with no finer-grained day available, that week's Monday is the most
    // honest date we can derive.
    const effectiveDate = parsed.data.weekOf ? new Date(parsed.data.weekOf) : new Date();
    const weekOf = normalizeToMonday(effectiveDate);
    const sessionDate = parsed.data.weekOf
      ? getLocalDate(weekOf, user.timezone || "America/Los_Angeles")
      : getLocalDate(effectiveDate, user.timezone || "America/Los_Angeles");

    const result = await db.exerciseResult.upsert({
      where: {
        clientId_exerciseName_programDay_setNumber_sessionDate: {
          clientId: user.id,
          exerciseName,
          programDay,
          setNumber,
          sessionDate,
        },
      },
      create: {
        clientId: user.id,
        exerciseName,
        programDay,
        setNumber,
        weekOf,
        sessionDate,
        weight: weight ?? 0,
        reps: reps ?? 0,
      },
      update: {
        ...(weight !== undefined && { weight }),
        ...(reps !== undefined && { reps }),
      },
      select: {
        id: true,
        exerciseName: true,
        programDay: true,
        setNumber: true,
        weight: true,
        reps: true,
        weekOf: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      id: result.id,
      exerciseName: result.exerciseName,
      programDay: result.programDay,
      setNumber: result.setNumber,
      weight: result.weight,
      reps: result.reps,
      weekOf: result.weekOf.toISOString(),
      createdAt: result.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[POST /api/client/training/results]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

const deleteResultSchema = z.object({
  id: z.string().min(1).optional(),
  exerciseName: z.string().min(1).optional(),
  clearAll: z.boolean().optional(),
});

export async function DELETE(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = deleteResultSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed" },
        { status: 422 }
      );
    }

    const weekOf = normalizeToMonday(new Date());

    if (parsed.data.clearAll && parsed.data.exerciseName) {
      // Clear all history for a specific exercise this week
      const deleted = await db.exerciseResult.deleteMany({
        where: {
          clientId: user.id,
          exerciseName: parsed.data.exerciseName,
          weekOf,
        },
      });
      return NextResponse.json({ deleted: deleted.count });
    } else if (parsed.data.id) {
      // Delete a single result (verify ownership)
      const existing = await db.exerciseResult.findUnique({
        where: { id: parsed.data.id },
        select: { clientId: true },
      });
      if (!existing || existing.clientId !== user.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await db.exerciseResult.delete({ where: { id: parsed.data.id } });
      return NextResponse.json({ deleted: 1 });
    }

    return NextResponse.json({ error: "Must provide id or (exerciseName + clearAll)" }, { status: 422 });
  } catch (err) {
    console.error("[DELETE /api/client/training/results]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
