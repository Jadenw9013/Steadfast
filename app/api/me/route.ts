import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";

async function signProfilePhoto(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.storage
      .from("profile-photos")
      .createSignedUrl(storagePath, 60 * 60);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  // ── Auth ────────────────────────────────────────────────────────────────
  let dbUser: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    dbUser = await getCurrentDbUser({ allowInactive: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Fetch with explicit select ────────────────────────────────────────
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id: dbUser.id },
      select: {
        id: true,
        clerkId: true,
        firstName: true,
        lastName: true,
        email: true,
        profilePhotoPath: true,
        activeRole: true,
        isCoach: true,
        isClient: true,
        timezone: true,
        isDeactivated: true,
        deletionRequest: { select: { status: true, scheduledPurgeAt: true } },
      },
    });

    // Sign the photo URL server-side so no client ever sees the raw storage path
    const photoUrl = await signProfilePhoto(user.profilePhotoPath);

    return NextResponse.json({ ...user, photoUrl });
  } catch (err) {
    console.error("[GET /api/me]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
