import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";

const PHOTO_BUCKET = "profile-photos";
const PORTFOLIO_MEDIA_BUCKET = "portfolio-media";
const TTL = 60 * 60; // 1 hour

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

    // Sign Supabase URLs for profile photo and portfolio items
    const supabase = createServiceClient();

    let signedPhotoUrl: string | null = null;
    if (profile.user.profilePhotoPath) {
      const { data } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(profile.user.profilePhotoPath, TTL);
      signedPhotoUrl = data?.signedUrl ?? null;
    }

    const signedPortfolioItems = await Promise.all(
      profile.portfolioItems.map(async (p) => {
        let signedUrl = "";
        if (p.mediaPath) {
          const { data, error: signErr } = await supabase.storage
            .from(PORTFOLIO_MEDIA_BUCKET)
            .createSignedUrl(p.mediaPath, TTL);
          if (signErr) {
            console.warn(`[portfolio] sign failed for "${p.mediaPath}":`, signErr.message);
          }
          signedUrl = data?.signedUrl ?? p.mediaPath;
        }
        return {
          id: p.id,
          path: signedUrl,
          caption: p.title,
        };
      })
    );

    return NextResponse.json({
      profile: {
        id: profile.id,
        slug: profile.slug,
        firstName: profile.user.firstName,
        lastName: profile.user.lastName,
        profilePhotoPath: signedPhotoUrl,
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
        portfolioItems: signedPortfolioItems,
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

