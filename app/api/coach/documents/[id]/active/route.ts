import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// PATCH /api/coach/documents/[id]/active — toggle isActive

type Params = { params: Promise<{ id: string }> };

export async function PATCH(_req: Request, { params }: Params) {
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
    const existing = await db.coachDocument.findFirst({
      where: { id, coachId: user.id },
      select: { id: true, isActive: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await db.coachDocument.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { isActive: true },
    });

    return NextResponse.json({ isActive: updated.isActive });
  } catch (err) {
    console.error("[PATCH /api/coach/documents/[id]/active]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
