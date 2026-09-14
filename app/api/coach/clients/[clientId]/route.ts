import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getClientProfile } from "@/lib/queries/client-profile";
import { reconcileCoachingContextForClient } from "@/lib/activation";

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
        profilePhotoUrl: profile.profilePhotoUrl ?? null,
        coachNotes: profile.coachNotes,
        currentWeekStatus: profile.currentWeekStatus,
        currentWeekOf: profile.currentWeekOf.toISOString(),
        lastMessageAt: profile.lastMessageAt?.toISOString() ?? null,
        weightDelta: profile.weightDelta,
        // cadenceStatus is { status, nextDue, label } from getClientCadenceStatus()
        // Flatten to primitives so mobile can decode without a nested struct:
        cadenceStatus: profile.cadenceStatus.status,   // "due"|"overdue"|"upcoming"|"submitted"|"reviewed"
        cadenceLabel: profile.cadenceStatus.label,     // human-readable string
        cadencePreview: profile.cadencePreview,        // "Every Monday at 9:00 AM" etc
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

// ── DELETE — remove client from roster ───────────────────────────────────────

export async function DELETE(
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

    // Verify assignment exists
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Client not found on roster" }, { status: 404 });
    }

    // Delete the coach-client link (preserves the client's account + data).
    // The delete and the ClientCoachingContext reconciliation (A01/CB06)
    // commit atomically.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
      await tx.coachClient.delete({ where: { id: assignment.id } });
      await reconcileCoachingContextForClient(tx, clientId);
    });

    // Best-effort: set any associated lead back to CONTACTED so coach can re-add later
    try {
      const coachProfile = await db.coachProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (coachProfile) {
        const clientEmail = (
          await db.user.findUnique({ where: { id: clientId }, select: { email: true } })
        )?.email;
        if (clientEmail) {
          await db.coachingRequest.updateMany({
            where: {
              coachProfileId: coachProfile.id,
              prospectEmail: clientEmail,
              consultationStage: "ACTIVE",
            },
            data: { consultationStage: "CONSULTATION_DONE" },
          });
        }
      }
    } catch {
      // Non-fatal: lead update is best-effort
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/coach/clients/[clientId]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
