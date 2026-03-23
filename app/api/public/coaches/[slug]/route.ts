import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// ── GET — public coach profile by slug (no auth) ─────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const profile = await db.coachProfile.findUnique({
      where: { slug, isPublished: true },
      select: {
        id: true,
        slug: true,
        bio: true,
        specialties: true,
        pricing: true,
        acceptingClients: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePhotoPath: true,
          },
        },
        portfolioItems: {
          select: {
            id: true,
            mediaPath: true,
            title: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!profile) {
      return NextResponse.json({ error: "Coach not found" }, { status: 404 });
    }

    // Fetch testimonials with reviewText (non-null only)
    const testimonials = await db.testimonial.findMany({
      where: {
        coachId: profile.user.id,
        status: "published",
        reviewText: { not: null },
      },
      select: {
        id: true,
        rating: true,
        reviewText: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      profile: {
        id: profile.id,
        slug: profile.slug,
        firstName: profile.user.firstName,
        lastName: profile.user.lastName,
        profilePhotoPath: profile.user.profilePhotoPath,
        bio: profile.bio,
        specialties: profile.specialties,
        pricing: profile.pricing,
        isAcceptingClients: profile.acceptingClients,
        testimonials: testimonials.map((t) => ({
          id: t.id,
          rating: t.rating,
          reviewText: t.reviewText,
          createdAt: t.createdAt.toISOString(),
        })),
        portfolioItems: profile.portfolioItems.map((p) => ({
          id: p.id,
          path: p.mediaPath ?? "",
          caption: p.title,
        })),
      },
    });
  } catch (err) {
    console.error("[GET /api/public/coaches/[slug]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
