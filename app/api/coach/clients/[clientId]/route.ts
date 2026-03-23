import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getClientProfile } from "@/lib/queries/client-profile";

// ── GET — full client snapshot ────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
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
    const { clientId } = await params;

    // Verify assignment
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const profile = await getClientProfile(user.id, clientId);
    if (!profile) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({
      client: {
        id: profile.client.id,
        firstName: profile.client.firstName,
        lastName: profile.client.lastName,
        email: profile.client.email,
        timezone: profile.client.timezone,
        coachNotes: profile.coachNotes,
        currentWeekStatus: profile.currentWeekStatus,
        currentWeekOf: profile.currentWeekOf.toISOString(),
        lastMessageAt: profile.lastMessageAt?.toISOString() ?? null,
        weightDelta: profile.weightDelta,
        cadenceStatus: profile.cadenceStatus,
        cadencePreview: profile.cadencePreview,
        latestCheckIn: profile.latestCheckIn
          ? {
              id: profile.latestCheckIn.id,
              weekOf: profile.latestCheckIn.weekOf.toISOString(),
              weight: profile.latestCheckIn.weight,
              dietCompliance: profile.latestCheckIn.dietCompliance,
              energyLevel: profile.latestCheckIn.energyLevel,
              status: profile.latestCheckIn.status,
              submittedAt: profile.latestCheckIn.submittedAt.toISOString(),
              photoCount: profile.latestCheckIn._count.photos,
            }
          : null,
        checkIns: profile.checkIns.map((c) => ({
          id: c.id,
          weekOf: c.weekOf.toISOString(),
          weight: c.weight,
          dietCompliance: c.dietCompliance,
          energyLevel: c.energyLevel,
          status: c.status,
          submittedAt: c.submittedAt.toISOString(),
          photoCount: c._count.photos,
        })),
      },
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
