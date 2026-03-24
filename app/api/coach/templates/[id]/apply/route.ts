import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// POST /api/coach/templates/[id]/apply
// Applies a training template to a specified client:
//   - Creates a new TrainingProgram in DRAFT state for the current week
//   - Copies template days → TrainingDay → TrainingProgramBlock

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const clientId = body?.clientId as string | undefined;
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    // Verify template ownership
    const template = await db.trainingTemplate.findFirst({
      where: { id, coachId: user.id },
      include: {
        days: {
          orderBy: { sortOrder: "asc" },
          include: { blocks: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Verify client is assigned to this coach
    const coachClient = await db.coachClient.findFirst({
      where: { coachId: user.id, clientId },
      select: { id: true },
    });
    if (!coachClient) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Compute start of current ISO week (Monday)
    const today = new Date();
    const dow = today.getDay(); // 0=Sun … 6=Sat
    const daysToMon = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMon);
    monday.setHours(0, 0, 0, 0);

    await db.$transaction(async (tx) => {
      const program = await tx.trainingProgram.create({
        data: {
          clientId,
          weekOf: monday,
          status: "DRAFT",
          weeklyFrequency: template.days.length,
          templateSourceId: template.id,
        },
      });

      for (let di = 0; di < template.days.length; di++) {
        const tDay = template.days[di];
        const pDay = await tx.trainingDay.create({
          data: {
            programId: program.id,
            dayName: tDay.dayName,
            sortOrder: di,
          },
        });
        for (const block of tDay.blocks) {
          await tx.trainingProgramBlock.create({
            data: {
              dayId: pDay.id,
              type: block.type as any,
              title: block.title,
              content: block.content,
              sortOrder: block.sortOrder,
            },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/coach/templates/[id]/apply]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
