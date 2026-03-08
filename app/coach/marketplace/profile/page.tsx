import { getMyCoachProfile } from "@/lib/queries/marketplace";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { ProfileForm } from "@/components/coach/marketplace/profile-form";
import { ShareLinkCard } from "@/components/coach/marketplace/share-link-card";
import { PortfolioManager } from "@/components/coach/marketplace/portfolio-manager";
import { ProfilePhotoUpload } from "@/components/profile/profile-photo-upload";
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

    // Get signed photo URL if user has a profile photo
    let photoUrl: string | null = null;
    if (user.profilePhotoPath) {
        try {
            photoUrl = await getProfilePhotoUrl(user.profilePhotoPath);
        } catch {
            // Gracefully degrade to initials
        }
    }

    return (
        <div className="mx-auto max-w-2xl pb-12">
            {/* ── Profile Header ── */}
            <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-6 py-8">
                {/* Avatar with upload */}
                <ProfilePhotoUpload
                    currentPhotoUrl={photoUrl}
                    initials={initials}
                    size="lg"
                />

                <div className="flex-1 min-w-0">
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
                                Live
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
            </div>

            {/* ── Action Row ── */}
            <ProfileForm
                initialData={profile}
                userName={displayName}
                userInitials={initials}
            />

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
