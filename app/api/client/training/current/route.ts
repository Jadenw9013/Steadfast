import { getClientProvider, isClientProviderCurrent } from "@/lib/queries/client-provider";
import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
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
    const provider = await getClientProvider(user.id);
    if (provider.resolutionRequired || provider.origin === "AI") return NextResponse.json({ error: provider.resolutionRequired ? "Your coaching provider needs resolution." : "Update Steadfast to use the AI Coach workspace." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    if (provider.origin === "NONE") return NextResponse.json({ trainingProgram: null }, { headers: { "Cache-Control": "private, no-store" } });
    // ── Most recent published program — explicit select (no select *) ─────
    const program = await db.trainingProgram.findFirst({
      where: { clientId: user.id, status: "PUBLISHED", publishedAt: { gte: provider.relationshipStartedAt! } },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        weekOf: true,
        status: true,
        clientNotes: true,
        days: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            dayName: true,
            sortOrder: true,
            // TrainingProgramBlock: type/title/content (used by web UI)
            blocks: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                type: true,
                title: true,
                content: true,
                sortOrder: true,
              },
            },
            // TrainingExercise: structured sets/reps/intensity
            // Matched to EXERCISE blocks by sortOrder to populate those fields
            exercises: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                name: true,
                sets: true,
                reps: true,
                intensityText: true,
                notes: true,
                sortOrder: true,
              },
            },
          },
        },
      },
    });

    if (!await isClientProviderCurrent(user.id, provider)) return NextResponse.json({ error: "Your provider changed. Refresh to continue." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });

    if (!program) {
      return NextResponse.json({ trainingProgram: null });
    }

    return NextResponse.json({
      trainingProgram: {
        id: program.id,
        weekOf: program.weekOf.toISOString(),
        status: program.status,
        clientNotes: program.clientNotes,
        // __CARDIO__ sentinel day is intentionally preserved — not stripped
        days: program.days.map((day) => {
          // Build exercise lookup by sortOrder to augment EXERCISE-type blocks
          const exerciseByOrder = new Map(
            day.exercises.map((e) => [e.sortOrder, e])
          );

          return {
            id: day.id,
            dayName: day.dayName,
            sortOrder: day.sortOrder,
            blocks: day.blocks.map((block) => {
              // For EXERCISE blocks: try to find a matching TrainingExercise
              // at the same sortOrder to get structured sets/reps/intensity
              const exercise =
                block.type === "EXERCISE"
                  ? (exerciseByOrder.get(block.sortOrder) ?? null)
                  : null;

              return {
                id: block.id,
                blockType: block.type,
                exerciseName: block.title || null,
                sets: exercise ? String(exercise.sets) : null,
                reps: exercise?.reps || null,
                intensity: exercise?.intensityText || null,
                notes: block.content || null,
                sortOrder: block.sortOrder,
              };
            }),
          };
        }),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[GET /api/client/training/current]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
