import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "profile-photos";
const TTL = 60 * 60; // 1 hour — matches /api/coach/profile-photo

// ── GET — return signed URL for the current client's assigned coach photo ──────
//
// Used by iOS CoachIdentityService to display the coach's Supabase-hosted photo
// in client-facing screens (Home top-right, Messages header).
// Mirrors the pattern in /api/coach/profile-photo but resolves the ASSIGNED coach,
// not the current authenticated user.

export async function GET() {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.activeRole !== "CLIENT" && !user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // 1. Find this client's assigned coach (same query pattern as /api/client/home)
    const assignment = await db.coachClient.findFirst({
      where: { clientId: user.id },
      select: {
        coach: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePhotoPath: true,
          },
        },
      },
    });

    if (!assignment?.coach) {
      console.log("[ClientCoachPhoto] no active coach assignment userId=%s", user.id);
      return NextResponse.json({ photoUrl: null, coachName: null });
    }

    const coach = assignment.coach;
    const storagePath = coach.profilePhotoPath ?? null;

    if (!storagePath) {
      console.log(
        "[ClientCoachPhoto] coach has no photo coachId=%s userId=%s",
        coach.id,
        user.id
      );
      return NextResponse.json({
        photoUrl: null,
        coachName: [coach.firstName, coach.lastName].filter(Boolean).join(" ") || null,
      });
    }

    // 2. Generate signed URL using service client (same method as /api/coach/profile-photo)
    const supabase = createServiceClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, TTL);

    if (error || !data?.signedUrl) {
      console.error(
        "[ClientCoachPhoto] sign error coachId=%s path=%s",
        coach.id,
        storagePath,
        error?.message
      );
      return NextResponse.json({
        photoUrl: null,
        coachName: [coach.firstName, coach.lastName].filter(Boolean).join(" ") || null,
      });
    }

    console.log("[ClientCoachPhoto] source=supabase coachId=%s userId=%s", coach.id, user.id);
    return NextResponse.json(
      {
        photoUrl: data.signedUrl,
        coachName: [coach.firstName, coach.lastName].filter(Boolean).join(" ") || null,
      },
      { headers: { "Cache-Control": "private, max-age=3000" } }
    );
  } catch (err) {
    console.error("[GET /api/client/coach-photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
