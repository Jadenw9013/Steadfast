import { getMyCoachProfile } from "@/lib/queries/marketplace";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { getPortfolioMediaUrl } from "@/lib/supabase/portfolio-storage";
import { ProfileForm } from "@/components/coach/marketplace/profile-form";
import { PortfolioManager } from "@/components/coach/marketplace/portfolio-manager";
import { ProfilePhotoUpload } from "@/components/profile/profile-photo-upload";
import { BannerPhotoUpload } from "@/components/profile/banner-photo-upload";
import { ShareProfileButton } from "@/components/coach/marketplace/share-profile-button";
import { getMarketplaceStats } from "@/lib/queries/marketplace-stats";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Coaching Profile | Steadfast",
};

export default async function CoachMarketplaceProfilePage() {
    const [user, marketplaceData] = await Promise.all([
        getCurrentDbUser(),
        getMyCoachProfile(),
    ]);

    const { profile, testimonialCount } = marketplaceData;

    const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?";
    const displayName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Coach";

    // Get signed photo URLs
    let photoUrl: string | null = null;
    if (user.profilePhotoPath) {
        try {
            photoUrl = await getProfilePhotoUrl(user.profilePhotoPath);
        } catch {
            // Gracefully degrade to initials
        }
    }

    let bannerUrl: string | null = null;
    if (profile?.bannerPhotoPath) {
        try {
            bannerUrl = await getProfilePhotoUrl(profile.bannerPhotoPath);
        } catch {
            // Gracefully degrade to gradient
        }
    }

    // Resolve portfolio media URLs
    const portfolioItems = profile?.portfolioItems ?? [];
    const itemsWithMedia = await Promise.all(
        portfolioItems.map(async (item) => {
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

    // Fetch stats for inline display
    const stats = profile?.isPublished
        ? await getMarketplaceStats(profile.id)
        : null;

    return (
        <div className="mx-auto max-w-2xl pb-12">

            {/* ═══════════════════════════════════════════════
                SECTION 1 — PROFILE HERO
            ═══════════════════════════════════════════════ */}

            {/* Banner + Avatar */}
            <div className="animate-fade-in sm:relative sm:mb-24">
                <BannerPhotoUpload currentBannerUrl={bannerUrl} />
                <div className="flex justify-center mt-4 sm:absolute sm:mt-0 sm:-bottom-12 sm:left-8">
                    <div className="shadow-lg">
                        <ProfilePhotoUpload
                            currentPhotoUrl={photoUrl}
                            initials={initials}
                            size="lg"
                        />
                    </div>
                </div>
            </div>

            {/* Name + Headline */}
            <div className="animate-fade-in flex flex-col items-center text-center sm:items-start sm:text-left" style={{ animationDelay: "100ms" }}>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
                    {displayName}
                </h1>
                {profile?.headline && (
                    <p className="mt-1 text-base text-zinc-500 dark:text-zinc-400">
                        {profile.headline}
                    </p>
                )}

                {/* Inline trust signals */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400 sm:justify-start">
                    {/* Status badges */}
                    {profile?.isPublished ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Live
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-400 dark:text-zinc-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                            Draft
                        </span>
                    )}
                    {profile?.isPublished && (
                        <span className={`inline-flex items-center gap-1.5 font-medium ${profile.acceptingClients
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-amber-600 dark:text-amber-400"
                            }`}>
                            {profile.acceptingClients ? "Accepting Clients" : "Currently Full"}
                        </span>
                    )}

                    {/* Rating */}
                    {stats && stats.reviews.count > 0 && (
                        <span className="inline-flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{stats.reviews.averageRating.toFixed(1)}</span>
                            <span>({stats.reviews.count})</span>
                        </span>
                    )}

                    {/* Clients coached */}
                    {stats && stats.requests.approved > 0 && (
                        <span>{stats.requests.approved} client{stats.requests.approved !== 1 ? "s" : ""} coached</span>
                    )}

                    {/* Coaching type / location */}
                    {profile?.coachingType && (
                        <span className="capitalize">{profile.coachingType}</span>
                    )}
                    {profile?.location && (
                        <span className="inline-flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                            {profile.location}
                        </span>
                    )}
                </div>
            </div>

            {/* Action buttons */}
            <div className="animate-fade-in mt-5 space-y-2" style={{ animationDelay: "150ms" }}>
                <ProfileForm
                    initialData={profile}
                    userName={displayName}
                    userInitials={initials}
                />
                {profile?.isPublished && profile?.slug && (
                    <div className="flex justify-center sm:justify-start">
                        <ShareProfileButton slug={profile.slug} />
                    </div>
                )}
            </div>


            {/* ═══════════════════════════════════════════════
                SECTION 2 — ABOUT
            ═══════════════════════════════════════════════ */}
            {(profile?.bio || profile?.experience || profile?.certifications) && (
                <div className="animate-fade-in mt-10" style={{ animationDelay: "200ms" }}>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">About</h2>

                    {profile.bio && (
                        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                            {profile.bio}
                        </p>
                    )}

                    {profile.experience && (
                        <div className="mt-5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Experience</p>
                            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                                {profile.experience}
                            </p>
                        </div>
                    )}

                    {profile.certifications && (
                        <div className="mt-5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Certifications</p>
                            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                                {profile.certifications}
                            </p>
                        </div>
                    )}
                </div>
            )}


            {/* ═══════════════════════════════════════════════
                SECTION 3 — SERVICES
            ═══════════════════════════════════════════════ */}
            {(profile?.services?.length ?? 0) > 0 && (
                <div className="animate-fade-in mt-10" style={{ animationDelay: "250ms" }}>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Services</h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {profile!.services!.map((s, i) => (
                            <span key={i} className="inline-flex rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                {s}
                            </span>
                        ))}
                    </div>
                </div>
            )}


            {/* ═══════════════════════════════════════════════
                SECTION 4 — POSTS
            ═══════════════════════════════════════════════ */}
            <div className="animate-fade-in mt-10" style={{ animationDelay: "300ms" }}>
                <PortfolioManager items={itemsWithMedia} />
            </div>
        </div>
    );
}
