import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;

    const checkIn = await db.checkIn.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        weekOf: true,
        status: true,
        weight: true,
        bodyFatPct: true,
        dietCompliance: true,
        energyLevel: true,
        notes: true,
        periodStartDate: true,
        periodEndDate: true,
        timezone: true,
        templateSnapshot: true,
        customResponses: true,
        deletedAt: true,
        photos: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, storagePath: true },
        },
      },
    });

    if (!checkIn || checkIn.deletedAt) {
      return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    }
    if (checkIn.clientId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      checkIn: {
        id: checkIn.id,
        weekOf: checkIn.weekOf.toISOString(),
        status: checkIn.status,
        weight: checkIn.weight,
        bodyFatPct: checkIn.bodyFatPct,
        dietCompliance: checkIn.dietCompliance,
        energyLevel: checkIn.energyLevel,
        notes: checkIn.notes,
        periodStartDate: checkIn.periodStartDate,
        periodEndDate: checkIn.periodEndDate,
        timezone: checkIn.timezone,
        templateSnapshot: checkIn.templateSnapshot,
        customResponses: checkIn.customResponses,
        photos: checkIn.photos.map((p) => ({ id: p.id, path: p.storagePath })),
      },
    });
  } catch (err) {
    console.error("[GET /api/client/checkins/[id]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
