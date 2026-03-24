import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// GET /api/coach/documents     — list all coach documents
// POST /api/coach/documents    — create a new TEXT document

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
    const docs = await db.coachDocument.findMany({
      where: { coachId: user.id },
      select: {
        id: true,
        title: true,
        type: true,
        content: true,
        fileName: true,
        fileType: true,
        isActive: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        content: d.content ?? null,
        fileName: d.fileName ?? null,
        fileType: d.fileType ?? null,
        isActive: d.isActive,
        sortOrder: d.sortOrder,
      })),
    });
  } catch (err) {
    console.error("[GET /api/coach/documents]", err);
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
  if (!body?.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const type = (body.type as string) ?? "TEXT";
  if (!["TEXT", "FILE"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  try {
    // Compute next sort order
    const lastDoc = await db.coachDocument.findFirst({
      where: { coachId: user.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const sortOrder = (lastDoc?.sortOrder ?? -1) + 1;

    const doc = await db.coachDocument.create({
      data: {
        coachId: user.id,
        title: body.title.trim(),
        type: type as any,
        content: type === "TEXT" ? (body.content as string) ?? null : null,
        isActive: true,
        sortOrder,
      },
    });

    return NextResponse.json({
      document: {
        id: doc.id,
        title: doc.title,
        type: doc.type,
        content: doc.content ?? null,
        fileName: null,
        fileType: null,
        isActive: doc.isActive,
        sortOrder: doc.sortOrder,
      },
    });
  } catch (err) {
    console.error("[POST /api/coach/documents]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
