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

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const coachProfile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        slug: true,
        headline: true,
        bio: true,
        specialties: true,
        pricing: true,
        acceptingClients: true,
        isPublished: true,
        welcomeMessage: true,
        bannerPhotoPath: true,
        experience: true,
        certifications: true,
        coachingType: true,
        location: true,
        city: true,
        state: true,
        serviceTier: true,
        gymName: true,
        yearsCoaching: true,
        phoneNumber: true,
        services: true,
        clientGoals: true,
        clientTypes: true,
      },
    });

    return NextResponse.json({
      profile: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profilePhotoPath: user.profilePhotoPath,
        timezone: user.timezone,
        coachProfile: coachProfile ?? null,
      },
    });
  } catch (err) {
    console.error("[GET /api/coach/profile]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().max(50).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
  // CoachProfile fields
  headline: z.string().max(300).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
  pricing: z.string().max(500).nullable().optional(),
  acceptingClients: z.boolean().optional(),
  welcomeMessage: z.string().max(2000).nullable().optional(),
  experience: z.string().max(2000).nullable().optional(),
  certifications: z.string().max(1000).nullable().optional(),
  coachingType: z.string().max(50).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  serviceTier: z.string().max(50).nullable().optional(),
  gymName: z.string().max(200).nullable().optional(),
  yearsCoaching: z.number().int().min(0).max(99).nullable().optional(),
  specialties: z.array(z.string().max(100)).max(20).optional(),
  services: z.array(z.string().max(100)).max(20).optional(),
  clientGoals: z.array(z.string().max(100)).max(20).optional(),
  clientTypes: z.array(z.string().max(100)).max(20).optional(),
});

export async function PUT(req: NextRequest) {
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
    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const {
      firstName,
      lastName,
      timezone,
      headline,
      bio,
      pricing,
      acceptingClients,
      welcomeMessage,
      experience,
      certifications,
      coachingType,
      location,
      city,
      state,
      serviceTier,
      gymName,
      yearsCoaching,
      specialties,
      services,
      clientGoals,
      clientTypes,
    } = parsed.data;

    // Update User fields
    const userUpdate: Record<string, unknown> = {};
    if (firstName !== undefined) userUpdate.firstName = firstName;
    if (lastName !== undefined) userUpdate.lastName = lastName ?? null;
    if (timezone !== undefined) userUpdate.timezone = timezone;

    if (Object.keys(userUpdate).length > 0) {
      await db.user.update({
        where: { id: user.id },
        data: userUpdate,
      });
    }

    // Update CoachProfile fields
    const coachUpdate: Record<string, unknown> = {};
    if (headline !== undefined) coachUpdate.headline = headline ?? null;
    if (bio !== undefined) coachUpdate.bio = bio ?? null;
    if (pricing !== undefined) coachUpdate.pricing = pricing ?? null;
    if (acceptingClients !== undefined) coachUpdate.acceptingClients = acceptingClients;
    if (welcomeMessage !== undefined) coachUpdate.welcomeMessage = welcomeMessage ?? null;
    if (experience !== undefined) coachUpdate.experience = experience ?? null;
    if (certifications !== undefined) coachUpdate.certifications = certifications ?? null;
    if (coachingType !== undefined) coachUpdate.coachingType = coachingType ?? null;
    if (location !== undefined) coachUpdate.location = location ?? null;
    if (city !== undefined) coachUpdate.city = city ?? null;
    if (state !== undefined) coachUpdate.state = state ?? null;
    if (serviceTier !== undefined) coachUpdate.serviceTier = serviceTier ?? null;
    if (gymName !== undefined) coachUpdate.gymName = gymName ?? null;
    if (yearsCoaching !== undefined) coachUpdate.yearsCoaching = yearsCoaching ?? null;
    if (specialties !== undefined) coachUpdate.specialties = specialties;
    if (services !== undefined) coachUpdate.services = services;
    if (clientGoals !== undefined) coachUpdate.clientGoals = clientGoals;
    if (clientTypes !== undefined) coachUpdate.clientTypes = clientTypes;

    if (Object.keys(coachUpdate).length > 0) {
      await db.coachProfile.upsert({
        where: { userId: user.id },
        update: coachUpdate,
        create: {
          userId: user.id,
          slug: user.id, // temporary slug — coach should update
          ...coachUpdate,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/coach/profile]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
