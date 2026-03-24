import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// GET /api/coach/templates/[id]  — full detail with days + blocks
// PUT /api/coach/templates/[id]  — atomic save (replace all days + blocks)
// DELETE /api/coach/templates/[id]

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
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

  try {
    const template = await db.trainingTemplate.findFirst({
      where: { id, coachId: user.id },
      include: {
        days: {
          orderBy: { sortOrder: "asc" },
          include: {
            blocks: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      template: {
        id: template.id,
        name: template.name,
        description: template.description ?? null,
        dayCount: template.days.length,
        updatedAt: template.updatedAt.toISOString(),
        days: template.days.map((d) => ({
          id: d.id,
          dayName: d.dayName,
          sortOrder: d.sortOrder,
          blocks: d.blocks.map((b) => ({
            id: b.id,
            type: b.type,
            title: b.title,
            content: b.content,
            sortOrder: b.sortOrder,
          })),
        })),
      },
    });
  } catch (err) {
    console.error("[GET /api/coach/templates/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { name, description, days } = body as {
    name: string;
    description?: string;
    days: Array<{
      dayName: string;
      blocks: Array<{ type: string; title: string; content: string; sortOrder: number }>;
    }>;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    // Verify ownership
    const existing = await db.trainingTemplate.findFirst({
      where: { id, coachId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Atomic replace: delete all existing days (cascade deletes blocks), then insert fresh
    await db.$transaction(async (tx) => {
      await tx.trainingTemplateDay.deleteMany({ where: { templateId: id } });

      await tx.trainingTemplate.update({
        where: { id },
        data: { name: name.trim(), description: description?.trim() || null },
      });

      for (let di = 0; di < (days ?? []).length; di++) {
        const day = days[di];
        const createdDay = await tx.trainingTemplateDay.create({
          data: {
            templateId: id,
            dayName: day.dayName,
            sortOrder: di,
          },
        });
        for (const block of day.blocks ?? []) {
          await tx.trainingTemplateBlock.create({
            data: {
              dayId: createdDay.id,
              type: (block.type as any) ?? "EXERCISE",
              title: block.title ?? "",
              content: block.content ?? "",
              sortOrder: block.sortOrder ?? 0,
            },
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/coach/templates/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
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
    const { id } = await params;
    const existing = await db.trainingTemplate.findFirst({
      where: { id, coachId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.trainingTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/coach/templates/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
