import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getSignedDownloadUrls } from "@/lib/supabase/storage";

type Params = { params: Promise<{ clientId: string; checkInId: string }> };

// ── GET — check-in detail with signed photo URLs ──────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
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
    const { clientId, checkInId } = await params;

    // Verify assignment
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const checkIn = await db.checkIn.findUnique({
      where: { id: checkInId },
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
        submittedAt: true,
        localDate: true,
        deletedAt: true,
        photos: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, storagePath: true, sortOrder: true },
        },
      },
    });

    if (!checkIn || checkIn.deletedAt) {
      return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    }
    if (checkIn.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Generate signed download URLs
    const storagePaths = checkIn.photos.map((p) => p.storagePath);
    const signedUrls = await getSignedDownloadUrls(storagePaths);
    const urlMap = new Map(signedUrls.map((u) => [u.path, u.signedUrl]));

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
        submittedAt: checkIn.submittedAt.toISOString(),
        localDate: checkIn.localDate,
        photos: checkIn.photos.map((p) => ({
          id: p.id,
          path: p.storagePath,
          url: urlMap.get(p.storagePath) ?? "",
          sortOrder: p.sortOrder,
        })),
      },
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]/checkins/[checkInId]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── PUT — mark check-in as reviewed ──────────────────────────────────────────

export async function PUT(_req: NextRequest, { params }: Params) {
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
    const { clientId, checkInId } = await params;

    // Verify assignment
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const checkIn = await db.checkIn.findUnique({
      where: { id: checkInId },
      select: { clientId: true, status: true, deletedAt: true },
    });

    if (!checkIn || checkIn.deletedAt) {
      return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    }
    if (checkIn.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (checkIn.status === "REVIEWED") {
      return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
    }

    const updated = await db.checkIn.update({
      where: { id: checkInId },
      data: { status: "REVIEWED" },
      select: { id: true, status: true },
    });

    return NextResponse.json({ checkIn: updated });
  } catch (err) {
    console.error("[PUT /api/coach/clients/[clientId]/checkins/[checkInId]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
