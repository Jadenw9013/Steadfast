import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday } from "@/lib/utils/date";

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
      },
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

    const weekOf = parsed.data.weekOf
      ? normalizeToMonday(new Date(parsed.data.weekOf))
      : normalizeToMonday(new Date());

    const result = await db.exerciseResult.upsert({
      where: {
        clientId_exerciseName_programDay_setNumber_weekOf: {
          clientId: user.id,
          exerciseName,
          programDay,
          setNumber,
          weekOf,
        },
      },
      create: {
        clientId: user.id,
        exerciseName,
        programDay,
        setNumber,
        weekOf,
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
    });
  } catch (err) {
    console.error("[POST /api/client/training/results]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
