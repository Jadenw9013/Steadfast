import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";

export interface CoachFilters {
    goal?: string;
    type?: string;         // "online" | "in-person" | "hybrid"
    accepting?: boolean;
    service?: string;      // free-text service tag
    serviceTier?: string;  // "training-only" | "nutrition-only" | "full-coaching"
    clientType?: string;
    minRating?: number;
    sort?: string;         // "rating" | "newest" | "" (default = best match)
    q?: string;            // keyword search by name/headline/bio
    city?: string;         // city name for in-person location matching
    state?: string;        // state/province for in-person location matching
}

// Labels shown on coach cards when filters are active
function computeMatchReasons(
    profile: {
        coachingType: string | null;
        city: string | null;
        state: string | null;
        serviceTier: string | null;
        acceptingClients: boolean;
        clientGoals: string[];
    },
    filters: CoachFilters
): string[] {
    const reasons: string[] = [];

    if (filters.goal && profile.clientGoals.includes(filters.goal)) {
        reasons.push(`Coaches ${filters.goal.toLowerCase()}`);
    }
    if (filters.type && profile.coachingType === filters.type) {
        const modeLabel = filters.type === "in-person" ? "In-Person" : filters.type.charAt(0).toUpperCase() + filters.type.slice(1);
        const loc = [profile.city, profile.state].filter(Boolean).join(", ");
        reasons.push(loc ? `${modeLabel} · ${loc}` : modeLabel);
    } else if (filters.type === "in-person" && profile.coachingType === "hybrid") {
        const loc = [profile.city, profile.state].filter(Boolean).join(", ");
        reasons.push(loc ? `Hybrid · ${loc}` : "Hybrid (in-person available)");
    }
    if (filters.city && profile.city?.toLowerCase().includes(filters.city.toLowerCase())) {
        // Already captured in mode reason above if mode was also filtered
        if (!filters.type) {
            reasons.push(`Based in ${profile.city}`);
        }
    }
    if (filters.serviceTier && profile.serviceTier === filters.serviceTier) {
        const tierLabel: Record<string, string> = {
            "training-only": "Training plans",
            "nutrition-only": "Nutrition plans",
            "full-coaching": "Full coaching",
        };
        if (tierLabel[filters.serviceTier]) reasons.push(tierLabel[filters.serviceTier]);
    }
    if (profile.acceptingClients) {
        reasons.push("Accepting new clients");
    }

    return reasons.slice(0, 2); // cap at 2 for card space
}

export async function getPublishedCoaches(filters?: CoachFilters) {
    // ── Build Prisma where clause ──────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { isPublished: true };

    // Coaching mode — for in-person requests, include hybrid coaches (ranked lower)
    if (filters?.type) {
        if (filters.type === "in-person") {
            where.coachingType = { in: ["in-person", "hybrid"] };
        } else {
            where.coachingType = filters.type;
        }
    }
    if (filters?.accepting) {
        where.acceptingClients = true;
    }
    if (filters?.goal) {
        where.clientGoals = { has: filters.goal };
    }
    if (filters?.service) {
        where.services = { has: filters.service };
    }
    if (filters?.clientType) {
        where.clientTypes = { has: filters.clientType };
    }
    // Service tier: exclude coaches who have declared a *different* tier.
    // null means "unspecified" — still eligible.
    if (filters?.serviceTier) {
        where.OR = [
            { serviceTier: filters.serviceTier },
            { serviceTier: null },
        ];
    }
    // City filter (case-insensitive contains) — only meaningful for in-person/hybrid
    if (filters?.city) {
        where.city = { contains: filters.city.trim(), mode: "insensitive" };
    }
    if (filters?.state) {
        where.state = { contains: filters.state.trim(), mode: "insensitive" };
    }
    // Text search
    if (filters?.q) {
        const term = filters.q.trim();
        where.OR = [
            { headline: { contains: term, mode: "insensitive" } },
            { bio: { contains: term, mode: "insensitive" } },
            { user: { firstName: { contains: term, mode: "insensitive" } } },
            { user: { lastName: { contains: term, mode: "insensitive" } } },
        ];
    }

    const profiles = await db.coachProfile.findMany({
        where,
        include: {
            user: {
                select: { id: true, firstName: true, lastName: true, profilePhotoPath: true },
            },
        },
    });

    // ── Fetch rating aggregates + client counts in parallel ────────────────
    const coachIds = profiles.map((p) => p.user.id);
    const [ratingData, clientCounts] = await Promise.all([
        db.testimonial.groupBy({
            by: ["coachId"],
            where: { coachId: { in: coachIds }, status: "published" },
            _avg: { rating: true },
            _count: { rating: true },
        }),
        db.coachClient.groupBy({
            by: ["coachId"],
            where: { coachId: { in: coachIds } },
            _count: true,
        }),
    ]);

    const ratingMap = new Map(
        ratingData.map((r) => [r.coachId, { avg: r._avg.rating ?? 0, count: r._count.rating }])
    );
    const clientCountMap = new Map(
        clientCounts.map((c) => [c.coachId, c._count])
    );

    // ── Score + sort ───────────────────────────────────────────────────────
    // Weights are intentionally visible and easy to adjust.
    const W = {
        ratingAvg: 0.40,     // normalized 0–1
        ratingCount: 0.15,   // capped at 10 reviews = 1.0
        completeness: 0.15,  // profile fill signals
        availability: 0.05,  // accepting clients bonus
        goalMatch: 0.10,     // requested goal ∈ clientGoals
        modeExactMatch: 0.08, // coachingType exactly matches requested mode
        modePartialMatch: 0.03, // in-person requested but coach is hybrid
        serviceTierMatch: 0.05, // serviceTier matches or coach is unspecified
        locationMatch: 0.04,  // city matches when in-person/hybrid
    } as const;

    const hasFilters = !!(filters?.goal || filters?.type || filters?.serviceTier || filters?.city || filters?.state);

    const ranked = profiles
        .map((profile) => {
            const rating = ratingMap.get(profile.user.id) ?? { avg: 0, count: 0 };
            const clientCount = clientCountMap.get(profile.user.id) ?? 0;

            // Profile completeness (0–1)
            const completenessChecks = [
                !!profile.headline,
                !!profile.bio,
                !!profile.experience,
                !!profile.pricing,
                (profile.services?.length ?? 0) > 0,
                (profile.clientGoals?.length ?? 0) > 0,
                !!profile.user.profilePhotoPath,
                !!profile.bannerPhotoPath,
                !!profile.certifications,
                !!profile.coachingType,
            ];
            const completeness = completenessChecks.filter(Boolean).length / completenessChecks.length;

            // Base trust score
            const normalizedRating = rating.avg / 5;
            const normalizedCount = Math.min(rating.count / 10, 1);
            const availabilityBoost = profile.acceptingClients ? 1 : 0;

            let score =
                normalizedRating * W.ratingAvg +
                normalizedCount * W.ratingCount +
                completeness * W.completeness +
                availabilityBoost * W.availability;

            // ── Intent-match bonuses (only when filters are present) ──────
            if (hasFilters) {
                // Goal match
                if (filters?.goal && profile.clientGoals.includes(filters.goal)) {
                    score += W.goalMatch;
                }
                // Coaching mode match
                if (filters?.type) {
                    if (profile.coachingType === filters.type) {
                        score += W.modeExactMatch;
                    } else if (filters.type === "in-person" && profile.coachingType === "hybrid") {
                        score += W.modePartialMatch;
                    }
                }
                // Service tier match — exact match gets bonus; null (unspecified) is neutral
                if (filters?.serviceTier) {
                    if (profile.serviceTier === filters.serviceTier) {
                        score += W.serviceTierMatch;
                    }
                    // null stays at 0 bonus — included in results but not boosted
                }
                // Location match bonus for in-person/hybrid
                if (filters?.city && profile.city) {
                    if (profile.city.toLowerCase().includes(filters.city.toLowerCase())) {
                        score += W.locationMatch;
                    }
                }
            }

            const matchReasons = hasFilters ? computeMatchReasons(profile, filters ?? {}) : [];

            return {
                ...profile,
                ratingSummary: { averageRating: rating.avg, totalReviews: rating.count },
                clientCount,
                rankScore: score,
                matchReasons,
            };
        })
        // Apply minRating filter post-aggregation
        .filter((p) => {
            if (filters?.minRating && filters.minRating > 0) {
                return p.ratingSummary.averageRating >= filters.minRating;
            }
            return true;
        });

    // ── Sort ──────────────────────────────────────────────────────────────
    if (filters?.sort === "rating") {
        ranked.sort((a, b) =>
            b.ratingSummary.averageRating - a.ratingSummary.averageRating ||
            b.ratingSummary.totalReviews - a.ratingSummary.totalReviews
        );
    } else if (filters?.sort === "newest") {
        ranked.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else {
        // Default: Best Match — intent-boosted trust score, recency as tiebreak
        ranked.sort((a, b) => b.rankScore - a.rankScore || b.createdAt.getTime() - a.createdAt.getTime());
    }

    return ranked;
}

export async function getCoachProfileBySlug(slug: string) {
    const profile = await db.coachProfile.findUnique({
        where: { slug, isPublished: true },
        include: {
            user: {
                select: { id: true, firstName: true, lastName: true, profilePhotoPath: true },
            },
            portfolioItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!profile) return null;

    const [testimonials, ratingAgg] = await Promise.all([
        db.testimonial.findMany({
            where: { coachId: profile.user.id, status: "published" },
            include: {
                client: {
                    select: { firstName: true, lastName: true },
                },
            },
            orderBy: { createdAt: "desc" },
        }),
        db.testimonial.aggregate({
            where: { coachId: profile.user.id, status: "published" },
            _avg: { rating: true },
            _count: { rating: true },
        }),
    ]);

    return {
        ...profile,
        testimonials,
        ratingSummary: {
            averageRating: ratingAgg._avg.rating ?? 0,
            totalReviews: ratingAgg._count.rating,
        },
    };
}

export async function getMyCoachProfile() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const [profile, testimonialCount] = await Promise.all([
        db.coachProfile.findUnique({
            where: { userId: user.id },
            include: {
                portfolioItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        }),
        db.testimonial.count({
            where: { coachId: user.id, status: "published" },
        }),
    ]);

    return { profile, testimonialCount };
}

export async function getMyCoachingRequests(coachProfileId: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    // Additional check to verify ownership of the profile
    const profile = await db.coachProfile.findUnique({
        where: { id: coachProfileId }
    });

    if (!profile || profile.userId !== user.id) {
        throw new Error("Unauthorized");
    }

    return db.coachingRequest.findMany({
        where: { coachProfileId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            prospectName: true,
            prospectEmail: true,
            status: true,
            intakeAnswers: true,
            createdAt: true,
            prospectId: true,
            inviteLastSentAt: true,
            inviteSendCount: true,
        },
    });
}
