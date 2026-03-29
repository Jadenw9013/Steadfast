import { getCoachProfileBySlug } from "@/lib/queries/marketplace";
import { getPortfolioMediaUrl } from "@/lib/supabase/portfolio-storage";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { getTestimonialImageUrl } from "@/lib/supabase/testimonial-storage";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { RatingSummary } from "@/components/public/rating-summary";
import { SaveCoachButton } from "@/components/public/save-coach-button";
import { TestimonialCard } from "@/components/public/testimonial-card";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { TeamBadge } from "@/components/ui/TeamBadge";

interface PageProps {
    params: Promise<{
        slug: string;
    }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const profile = await getCoachProfileBySlug(slug);

    if (!profile) return { title: "Coach Not Found" };

    return {
        title: `Coach ${profile.user.firstName} ${profile.user.lastName} | Steadfast`,
        description: profile.bio?.substring(0, 160) || `Professional Steadfast Coach`,
    };
}

function formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks === 1) return "1 week ago";
    if (diffWeeks < 4) return `${diffWeeks} weeks ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return "1 month ago";
    return `${diffMonths} months ago`;
}

export default async function CoachProfilePage({ params }: PageProps) {
    const { slug } = await params;
    const profile = await getCoachProfileBySlug(slug);

    if (!profile) {
        notFound();
    }

    // Resolve portfolio media URLs
    const portfolioMediaItems = await Promise.all(
        profile.portfolioItems.map(async (item) => {
            let mediaUrl: string | null = null;
            if (item.mediaPath) {
                try {
                    mediaUrl = await getPortfolioMediaUrl(item.mediaPath);
                } catch {
                    // Gracefully degrade
                }
            }
            return { ...item, mediaUrl };
        })
    );

    // Check if the logged-in user is already a client of this coach
    let isExistingClient = false;
    const { userId: clerkId } = await auth();
    if (clerkId) {
        const viewer = await db.user.findUnique({
            where: { clerkId },
            select: { id: true },
        });
        if (viewer) {
            const existing = await db.coachClient.findFirst({
                where: {
                    clientId: viewer.id,
                    coach: { coachProfile: { slug } },
                },
            });
            isExistingClient = !!existing;
        }
    }

    // Resolve coach photos
    let bannerUrl: string | null = null;
    if (profile.bannerPhotoPath) {
        try { bannerUrl = await getProfilePhotoUrl(profile.bannerPhotoPath); } catch { /* */ }
    }
    let avatarUrl: string | null = null;
    if (profile.user.profilePhotoPath) {
        try { avatarUrl = await getProfilePhotoUrl(profile.user.profilePhotoPath); } catch { /* */ }
    }
    const initials = `${profile.user.firstName?.[0] ?? ""}${profile.user.lastName?.[0] ?? ""}`.toUpperCase() || "?";

    return (
        <div className="min-h-screen bg-black">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 border-b border-white/[0.04] bg-black/80 backdrop-blur-xl">
                <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-5 sm:px-8">
                    <Link
                        href="/coaches"
                        className="text-sm font-medium text-zinc-400 transition-colors hover:text-white"
                    >
                        ← Directory
                    </Link>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/"
                            className="group flex items-center gap-2.5"
                            aria-label="Steadfast home"
                        >
                            <div className="relative h-7 w-7 transition-transform duration-200 group-hover:scale-110 sm:h-8 sm:w-8">
                                <Image
                                    src="/brand/Steadfast_logo_pictoral.png"
                                    alt=""
                                    fill
                                    priority
                                    className="object-contain brightness-0 invert"
                                />
                            </div>
                            <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-zinc-100 sm:inline">Steadfast</span>
                        </Link>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-4xl px-5 pb-24 pt-8 sm:px-8 lg:pb-8" id="main-content">
                {/* ── Banner + Avatar ── */}
                <div className="relative mb-20">
                    {/* Banner */}
                    <div className="h-40 w-full overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 sm:h-52">
                        {bannerUrl && (
                            <Image
                                src={bannerUrl}
                                alt=""
                                width={1200}
                                height={400}
                                className="h-full w-full object-cover"
                                priority
                            />
                        )}
                    </div>
                    {/* Avatar — anchored to bottom-left of banner */}
                    <div className="absolute -bottom-14 left-6 sm:left-8">
                        <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-[#0d1526] bg-[#111c30] shadow-lg">
                            {avatarUrl ? (
                                <Image
                                    src={avatarUrl}
                                    alt={`${profile.user.firstName} ${profile.user.lastName}`}
                                    width={112}
                                    height={112}
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-600">
                                    {initials}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid gap-12 lg:grid-cols-[1fr_300px]">
                    {/* Main Content */}
                    <div>
                        <div>
                            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                                {profile.user.firstName} {profile.user.lastName}
                            </h1>
                            {profile.headline && (
                                <p className="mt-1.5 text-lg font-medium text-zinc-600">
                                    {profile.headline}
                                </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${profile.acceptingClients
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-amber-500/10 text-amber-600"
                                    }`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${profile.acceptingClients ? "bg-emerald-500" : "bg-amber-500"
                                        }`} />
                                    {profile.acceptingClients ? "Accepting New Clients" : "Currently Full"}
                                </span>
                                {profile.coachingType && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600">
                                        {profile.coachingType.charAt(0).toUpperCase() + profile.coachingType.slice(1)} Coaching
                                    </span>
                                )}
                                {profile.location && (
                                    <span className="text-xs text-zinc-500">
                                        📍 {profile.location}
                                    </span>
                                )}
                            </div>
                            {profile.ratingSummary.totalReviews > 0 && (
                                <div className="mt-3">
                                    <RatingSummary
                                        averageRating={profile.ratingSummary.averageRating}
                                        totalReviews={profile.ratingSummary.totalReviews}
                                        />
                                </div>
                            )}
                        </div>

                        {profile.specialties.length > 0 && (
                            <div className="mt-8">
                                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Specialties</p>
                                <div className="flex flex-wrap gap-2">
                                    {profile.specialties.map((spec, i) => (
                                        <span key={i} className="inline-flex rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700">
                                            {spec}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-12 prose prose-zinc max-w-none">
                            <h2 className="text-xl font-semibold">About Me</h2>
                            <div className="mt-4 whitespace-pre-wrap leading-relaxed text-zinc-600">
                                {profile.bio || "Bio coming soon."}
                            </div>
                        </div>

                        {/* ── Team Section ── */}
                        {profile.user.team && (
                            <div className="mt-10">
                                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Team</p>
                                <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                                    <TeamBadge
                                        teamName={profile.user.team.name}
                                        logoPath={profile.user.team.logoPath}
                                        role={profile.user.teamRole}
                                        showRole={true}
                                        size="md"
                                    />
                                </div>
                            </div>
                        )}

                        {/* ── Experience & Certifications ── */}
                        {(profile.experience || profile.certifications) && (
                            <div className="mt-12">
                                <h2 className="text-xl font-semibold text-zinc-900">Experience & Credentials</h2>
                                <div className="mt-4 space-y-4">
                                    {profile.experience && (
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">Experience</p>
                                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">{profile.experience}</p>
                                        </div>
                                    )}
                                    {profile.certifications && (
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">Certifications</p>
                                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">{profile.certifications}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── Services & Goals ── */}
                        {(profile.services.length > 0 || profile.clientGoals.length > 0) && (
                            <div className="mt-12">
                                <h2 className="text-xl font-semibold text-zinc-900">Services & Goals</h2>
                                {profile.services.length > 0 && (
                                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                        {profile.services.map((service, i) => (
                                            <div key={i} className="flex items-center gap-2 text-sm text-zinc-600">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0"><path d="M20 6 9 17l-5-5" /></svg>
                                                {service}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {profile.clientGoals.length > 0 && (
                                    <div className={`${profile.services.length > 0 ? "mt-5" : "mt-4"} flex flex-wrap gap-2`}>
                                        {profile.clientGoals.map((goal, i) => (
                                            <span key={i} className="inline-flex rounded-md bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700">{goal}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Testimonials ── */}
                        {profile.testimonials.length > 0 && (
                            <div className="mt-12">
                                <h2 className="text-xl font-semibold text-zinc-900">Client Testimonials</h2>
                                <div className="mt-5 space-y-4">
                                    {await Promise.all(profile.testimonials.map(async (testimonial) => {
                                        const imageUrls: string[] = [];
                                        for (const imgPath of testimonial.images ?? []) {
                                            try {
                                                const url = await getTestimonialImageUrl(imgPath);
                                                imageUrls.push(url);
                                            } catch { /* gracefully skip */ }
                                        }
                                        return (
                                            <TestimonialCard
                                                key={testimonial.id}
                                                rating={testimonial.rating}
                                                reviewText={testimonial.reviewText}
                                                clientFirstName={testimonial.client.firstName}
                                                clientLastName={testimonial.client.lastName}
                                                createdAt={testimonial.createdAt}
                                                imageUrls={imageUrls}
                                                anonymous={(testimonial as { anonymous?: boolean }).anonymous ?? false}
                                            />
                                        );
                                    }))}
                                </div>
                            </div>
                        )}

                        {/* ── Posts ── */}
                        {profile.portfolioItems.length > 0 && (
                            <div className="mt-12">
                                <h2 className="text-xl font-semibold text-zinc-900">Posts</h2>
                                <div className="mt-6 space-y-5">
                                    {portfolioMediaItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white transition-all hover:border-zinc-300 hover:shadow-sm"
                                        >
                                            {item.mediaUrl && (
                                                <div className="relative w-full" style={{ maxHeight: "320px" }}>
                                                    {item.mediaType === "video" ? (
                                                        <video
                                                            src={item.mediaUrl}
                                                            controls
                                                            className="w-full"
                                                            style={{ maxHeight: "320px" }}
                                                        />
                                                    ) : (
                                                        <Image
                                                            src={item.mediaUrl}
                                                            alt={item.title}
                                                            width={700}
                                                            height={400}
                                                            className="w-full object-cover"
                                                            style={{ maxHeight: "320px" }}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                            <div className="p-5">
                                                <div className="flex items-start justify-between gap-2">
                                                    <h3 className="text-sm font-semibold text-zinc-900">
                                                        {item.title}
                                                    </h3>
                                                    {item.category && (
                                                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                                                            {item.category}
                                                        </span>
                                                    )}
                                                </div>
                                                {item.description && (
                                                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <p className="mt-3 text-[11px] text-zinc-400">
                                                    {formatTimeAgo(item.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar / CTA */}
                    <div>
                        {/* ── Quick-Scan Facts ── */}
                        <div className="mb-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
                            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">At a Glance</h3>
                            <dl className="space-y-2.5 text-sm">
                                {profile.coachingType && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Type</dt>
                                        <dd className="font-medium text-zinc-800">{profile.coachingType.charAt(0).toUpperCase() + profile.coachingType.slice(1)}</dd>
                                    </div>
                                )}
                                {profile.yearsCoaching && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Experience</dt>
                                        <dd className="font-medium text-zinc-800">{profile.yearsCoaching}+ years</dd>
                                    </div>
                                )}
                                {profile.location && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Location</dt>
                                        <dd className="font-medium text-zinc-800">{profile.location}</dd>
                                    </div>
                                )}
                                {profile.gymName && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Gym</dt>
                                        <dd className="font-medium text-zinc-800">{profile.gymName}</dd>
                                    </div>
                                )}
                                {profile.phoneNumber && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Phone</dt>
                                        <dd className="font-medium text-zinc-800">
                                            <a
                                                href={`tel:${profile.phoneNumber.replace(/\s/g, "")}`}
                                                className="transition-colors hover:text-blue-600"
                                            >
                                                {profile.phoneNumber}
                                            </a>
                                        </dd>
                                    </div>
                                )}
                                {profile.certifications && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Certified</dt>
                                        <dd className="truncate max-w-[140px] font-medium text-zinc-800" title={profile.certifications}>{profile.certifications}</dd>
                                    </div>
                                )}
                                {(profile.services?.length ?? 0) > 0 && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Services</dt>
                                        <dd className="font-medium text-zinc-800">{profile.services!.length} offered</dd>
                                    </div>
                                )}
                                {profile.ratingSummary.totalReviews > 0 && (
                                    <div className="flex items-center justify-between">
                                        <dt className="text-zinc-500">Reviews</dt>
                                        <dd className="flex items-center gap-1 font-medium text-zinc-800">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                            {profile.ratingSummary.averageRating.toFixed(1)} ({profile.ratingSummary.totalReviews})
                                        </dd>
                                    </div>
                                )}
                            </dl>
                        </div>

                        {/* ── CTA Card ── */}
                        <div className="sticky top-32 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-zinc-900">
                                {profile.acceptingClients ? "Start Coaching" : "Currently Full"}
                            </h3>

                            {profile.pricing && (
                                <p className="mt-2 text-sm text-zinc-500">
                                    {profile.pricing}
                                </p>
                            )}

                            {isExistingClient ? (
                                <>
                                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M20 6 9 17l-5-5" /></svg>
                                        <span className="text-sm font-semibold text-emerald-600">Your Coach</span>
                                    </div>
                                    <Link
                                        href="/client"
                                        className="mt-3 flex w-full items-center justify-center rounded-xl border-2 border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-600 transition-all hover:border-zinc-300 hover:bg-zinc-50"
                                    >
                                        Go to Dashboard
                                    </Link>
                                </>
                            ) : profile.acceptingClients ? (
                                <>
                                    <Link
                                        href={`/coaches/${profile.slug}/request`}
                                        className="mt-6 flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-zinc-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
                                    >
                                        Request Coaching
                                    </Link>
                                    <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
                                        Free to request. Your coach will review your intake and respond within a few days.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Link
                                        href={`/coaches/${profile.slug}/request`}
                                        className="mt-6 flex w-full items-center justify-center rounded-xl border-2 border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-700 transition-all hover:border-zinc-400 hover:bg-zinc-50"
                                    >
                                        Join Waitlist
                                    </Link>
                                    <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
                                        This coach is currently full. Join the waitlist to be notified when a spot opens.
                                    </p>
                                </>
                            )}

                            {/* Trust messaging */}
                            {profile.ratingSummary.totalReviews > 0 && (
                                <div className="mt-4 flex items-center justify-center gap-1.5 border-t border-zinc-100 pt-4">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M9 12 11 14 15 10" /><circle cx="12" cy="12" r="10" /></svg>
                                    <span className="text-[11px] text-zinc-500">
                                        {profile.ratingSummary.totalReviews} verified {profile.ratingSummary.totalReviews === 1 ? "review" : "reviews"} from coached clients
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* ── Mobile Sticky CTA ── */}
            {!isExistingClient && (
                <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/[0.08] bg-black/95 px-5 py-3 backdrop-blur-sm lg:hidden">
                    <div className="flex items-center gap-3">
                        <Link
                            href={`/coaches/${profile.slug}/request`}
                            className="flex flex-1 items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-zinc-700"
                        >
                            {profile.acceptingClients ? "Request Coaching" : "Join Waitlist"}
                        </Link>
                        {await (async () => {
                            try {
                                const { getCurrentDbUser } = await import("@/lib/auth/roles");
                                const user = await getCurrentDbUser();
                                const { getSavedCoachIds } = await import("@/lib/queries/saved-coaches");
                                const savedIds = await getSavedCoachIds(user.id);
                                return <SaveCoachButton coachProfileId={profile.id} initialSaved={savedIds.has(profile.id)} size="md" />;
                            } catch { return null; }
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
}
