import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// GET /api/coach/templates/intake-form  — fetch the coach's IntakeFormTemplate
// PUT /api/coach/templates/intake-form  — upsert sections JSON

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
    const form = await db.intakeFormTemplate.findUnique({
      where: { coachId: user.id },
      select: { sections: true },
    });

    if (!form) {
      return NextResponse.json({ template: null });
    }

    return NextResponse.json({ template: { sections: form.sections } });
  } catch (err) {
    console.error("[GET /api/coach/templates/intake-form]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
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
  if (!body || !Array.isArray(body.sections)) {
    return NextResponse.json({ error: "sections array required" }, { status: 400 });
  }

  try {
    await db.intakeFormTemplate.upsert({
      where: { coachId: user.id },
      create: { coachId: user.id, sections: body.sections },
      update: { sections: body.sections },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/coach/templates/intake-form]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
