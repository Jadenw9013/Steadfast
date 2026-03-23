import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      profilePhotoPath: user.profilePhotoPath,
      timezone: user.timezone,
      bio: user.clientBio,
      fitnessGoal: user.fitnessGoal,
    },
  });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().max(50).nullable().optional(),
  bio: z.string().max(300).nullable().optional(),
  fitnessGoal: z.string().max(100).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
});

export async function PUT(req: NextRequest) {
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
    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { firstName, lastName, bio, fitnessGoal, timezone } = parsed.data;

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName: lastName ?? null }),
        ...(bio !== undefined && { clientBio: bio ?? null }),
        ...(fitnessGoal !== undefined && { fitnessGoal: fitnessGoal ?? null }),
        ...(timezone !== undefined && { timezone }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profilePhotoPath: true,
        timezone: true,
        clientBio: true,
        fitnessGoal: true,
      },
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        profilePhotoPath: updated.profilePhotoPath,
        timezone: updated.timezone,
        bio: updated.clientBio,
        fitnessGoal: updated.fitnessGoal,
      },
    });
  } catch (err) {
    console.error("[PUT /api/client/profile]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
