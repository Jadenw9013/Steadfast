import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// GET  /api/coach/templates — list all templates for this coach
// POST /api/coach/templates — create a new (empty) training template

export async function GET() {
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
    const [snippets, templates, checkInTemplates] = await Promise.all([
      db.planSnippet.findMany({
        where: { coachId: user.id },
        select: { id: true, name: true, payload: true },
        orderBy: { name: "asc" },
      }),
      db.trainingTemplate.findMany({
        where: { coachId: user.id },
        select: { id: true, name: true, _count: { select: { days: true } } },
        orderBy: { name: "asc" },
      }),
      db.checkInTemplate.findMany({
        where: { coachId: user.id },
        select: { id: true, name: true, isDefault: true, questions: true },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      }),
    ]);

    return NextResponse.json({
      mealSnippets: snippets.map((s) => ({
        id: s.id,
        name: s.name,
        itemCount: Array.isArray(s.payload) ? (s.payload as unknown[]).length : 0,
      })),
      trainingTemplates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        dayCount: t._count.days,
      })),
      checkInTemplates: checkInTemplates.map((c) => ({
        id: c.id,
        name: c.name,
        questionCount: Array.isArray(c.questions)
          ? (c.questions as unknown[]).length
          : 0,
        isDefault: c.isDefault,
      })),
    });
  } catch (err) {
    console.error("[GET /api/coach/templates]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
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
  const name = (body?.name as string)?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const template = await db.trainingTemplate.create({
      data: {
        coachId: user.id,
        name,
        description: (body?.description as string)?.trim() || null,
      },
      select: { id: true, name: true },
    });

    return NextResponse.json({ template });
  } catch (err) {
    console.error("[POST /api/coach/templates]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
