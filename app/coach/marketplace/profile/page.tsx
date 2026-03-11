import { getMyCoachProfile } from "@/lib/queries/marketplace";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { getPortfolioMediaUrl } from "@/lib/supabase/portfolio-storage";
import { ProfileForm } from "@/components/coach/marketplace/profile-form";
import { ShareLinkCard } from "@/components/coach/marketplace/share-link-card";
import { PortfolioManager } from "@/components/coach/marketplace/portfolio-manager";
import { ProfilePhotoUpload } from "@/components/profile/profile-photo-upload";
import { BannerPhotoUpload } from "@/components/profile/banner-photo-upload";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Coaching Profile | Steadfast",
};

export default async function CoachMarketplaceProfilePage() {
    const [user, profile] = await Promise.all([
        getCurrentDbUser(),
        getMyCoachProfile(),
    ]);

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

    return (
        <div className="mx-auto max-w-2xl pb-12">
            {/* ── Banner + Avatar Header ── */}
            <div className="animate-fade-in sm:relative sm:mb-24">
                {/* Uploadable Banner */}
                <BannerPhotoUpload currentBannerUrl={bannerUrl} />

                {/* Avatar — below banner on mobile, overlapping on desktop */}
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

            {/* ── Name + Headline + Badges ── */}
            <div className="animate-fade-in flex flex-col items-center text-center sm:items-start sm:text-left" style={{ animationDelay: "100ms" }}>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
                    {displayName}
                </h1>
                {profile?.headline && (
                    <p className="mt-1 text-base text-zinc-500 dark:text-zinc-400">
                        {profile.headline}
                    </p>
                )}

                {/* Status badges */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    {profile?.isPublished ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Coaching Page Live
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                            Draft
                        </span>
                    )}
                    {profile?.isPublished && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${profile.acceptingClients
                            ? "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
                            : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                            }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${profile.acceptingClients ? "bg-blue-500" : "bg-amber-500"}`} />
                            {profile.acceptingClients ? "Accepting Clients" : "Currently Full"}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Action Row + Profile Sections ── */}
            <div className="animate-fade-in mt-6" style={{ animationDelay: "200ms" }}>
                <ProfileForm
                    initialData={profile}
                    userName={displayName}
                    userInitials={initials}
                />
            </div>

            {/* ── Public Coaching Page Link ── */}
            {profile?.isPublished && profile.slug && (
                <div className="animate-fade-in mt-6" style={{ animationDelay: "300ms" }}>
                    <ShareLinkCard slug={profile.slug} />
                </div>
            )}

            {/* ── Posts ── */}
            <div className="animate-fade-in mt-6" style={{ animationDelay: "400ms" }}>
                <PortfolioManager items={itemsWithMedia} />
            </div>
        </div>
    );
}
