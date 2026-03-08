import { getMyCoachProfile } from "@/lib/queries/marketplace";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
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

    return (
        <div className="mx-auto max-w-2xl pb-12">
            {/* ── Banner + Avatar Header ── */}
            <div className="sm:relative sm:mb-24">
                {/* Uploadable Banner */}
                <BannerPhotoUpload currentBannerUrl={bannerUrl} />

                {/* Avatar — below banner on mobile, overlapping on desktop */}
                <div className="flex justify-center mt-4 sm:absolute sm:mt-0 sm:-bottom-12 sm:left-8">
                    <div className="rounded-full border-4 border-[#09090b] shadow-lg">
                        <ProfilePhotoUpload
                            currentPhotoUrl={photoUrl}
                            initials={initials}
                            size="lg"
                        />
                    </div>
                </div>
            </div>

            {/* ── Name + Headline + Badges ── */}
            <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
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
            <div className="mt-6">
                <ProfileForm
                    initialData={profile}
                    userName={displayName}
                    userInitials={initials}
                />
            </div>

            {/* ── Public Coaching Page Link ── */}
            {profile?.isPublished && profile.slug && (
                <div className="mt-6">
                    <ShareLinkCard slug={profile.slug} />
                </div>
            )}

            {/* ── Portfolio ── */}
            <div className="mt-6">
                <PortfolioManager items={profile?.portfolioItems ?? []} />
            </div>
        </div>
    );
}
