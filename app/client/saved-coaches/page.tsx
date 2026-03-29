import { getCurrentDbUser } from "@/lib/auth/roles";
import { getSavedCoaches } from "@/lib/queries/saved-coaches";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { SaveCoachButton } from "@/components/public/save-coach-button";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
    title: "Saved Coaches | Steadfast",
};

export default async function SavedCoachesPage() {
    const user = await getCurrentDbUser();
    const savedCoaches = await getSavedCoaches(user.id);

    // Resolve profile photos
    const coachesWithPhotos = await Promise.all(
        savedCoaches.map(async (sc) => {
            const photoUrl = sc.coachProfile.user.profilePhotoPath
                ? await getProfilePhotoUrl(sc.coachProfile.user.profilePhotoPath)
                : null;
            return { ...sc, photoUrl };
        })
    );

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-8">
                <h1 className="text-2xl font-black tracking-tight text-white">
                    Saved Coaches
                </h1>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    Coaches you&apos;ve bookmarked for later.
                </p>
            </div>

            {coachesWithPhotos.length === 0 ? (
                <div className="sf-surface-card p-12 text-center" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.06)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                        </svg>
                    </div>
                    <p className="mt-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                        No saved coaches yet
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                        Browse the marketplace and save coaches you&apos;re interested in.
                    </p>
                    <Link
                        href="/coaches"
                        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
                    >
                        Browse Coaches
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    {coachesWithPhotos.map((sc) => {
                        const name = `${sc.coachProfile.user.firstName ?? ""} ${sc.coachProfile.user.lastName ?? ""}`.trim() || "Coach";
                        return (
                            <div key={sc.id} className="sf-glass-card p-5">
                                <div className="flex items-start gap-4">
                                    <Link href={`/coaches/${sc.coachProfile.slug}`} className="shrink-0">
                                        {sc.photoUrl ? (
                                            <Image
                                                src={sc.photoUrl}
                                                alt={name}
                                                width={48}
                                                height={48}
                                                className="rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-lg font-semibold text-zinc-500 dark:bg-zinc-800">
                                                {(sc.coachProfile.user.firstName?.[0] ?? "C").toUpperCase()}
                                            </div>
                                        )}
                                    </Link>
                                    <div className="min-w-0 flex-1">
                                        <Link href={`/coaches/${sc.coachProfile.slug}`} className="text-base font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
                                            {name}
                                        </Link>
                                        {sc.coachProfile.headline && (
                                            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">
                                                {sc.coachProfile.headline}
                                            </p>
                                        )}
                                        <div className="mt-2 flex items-center gap-3">
                                            {sc.coachProfile.acceptingClients ? (
                                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                    Accepting clients
                                                </span>
                                            ) : (
                                                <span className="text-xs text-zinc-400">Not accepting clients</span>
                                            )}
                                            {sc.coachProfile.pricing && (
                                                <span className="text-xs text-zinc-500 dark:text-zinc-400">{sc.coachProfile.pricing}</span>
                                            )}
                                        </div>
                                    </div>
                                    <SaveCoachButton coachProfileId={sc.coachProfileId} initialSaved={true} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
