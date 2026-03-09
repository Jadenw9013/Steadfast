import { getPublishedCoaches } from "@/lib/queries/marketplace";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Footer } from "@/components/footer";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export const metadata: Metadata = {
    title: "Find a Coach | Steadfast",
    description: "Browse our directory of professional Steadfast coaches and find the right fit for your goals.",
};

export default async function CoachesDirectoryPage() {
    const coaches = await getPublishedCoaches();

    // Resolve profile photos
    const coachesWithPhotos = await Promise.all(
        coaches.map(async (profile) => {
            let avatarUrl: string | null = null;
            if (profile.user.profilePhotoPath) {
                try { avatarUrl = await getProfilePhotoUrl(profile.user.profilePhotoPath); } catch { /* */ }
            }
            return { ...profile, avatarUrl };
        })
    );

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b]">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 bg-zinc-50 dark:bg-[#09090b]">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-8">
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
                                className="object-contain brightness-0 dark:brightness-100"
                            />
                        </div>
                        <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-gray-900 dark:text-gray-100 sm:inline">Steadfast</span>
                    </Link>
                    <nav className="flex items-center gap-3">
                        <ThemeToggle />
                        <Link
                            href="/sign-in"
                            className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                        >
                            Sign In
                        </Link>
                        <Link
                            href="/sign-up"
                            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-sm active:scale-[0.97] dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                        >
                            Get Started
                        </Link>
                    </nav>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-gray-700/40" />
            </header>

            <main className="mx-auto max-w-5xl px-5 py-16 sm:px-8" id="main-content">
                <div className="mb-12">
                    <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl text-zinc-900 dark:text-zinc-100">
                            Find your coach
                        </h1>
                        <span className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                            Beta
                        </span>
                    </div>
                    <p className="mt-3 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
                        Professional coaches using Steadfast to deliver structured, results-driven coaching.
                    </p>
                </div>

                {coaches.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-200 border-dashed bg-white p-12 text-center dark:border-zinc-800 dark:bg-[#121215]">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                        </div>
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            No coaches are listed yet
                        </p>
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                            Our first coaches are setting up their profiles. Check back soon or create an account to be ready when they launch.
                        </p>
                        <Link
                            href="/sign-up"
                            className="mt-6 inline-block rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        >
                            Create Free Account
                        </Link>
                    </div>
                ) : (
                    <div className="stagger-children grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {coachesWithPhotos.map((profile) => (
                            <Link
                                key={profile.id}
                                href={`/coaches/${profile.slug}`}
                                className="group flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-6 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-4">
                                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            {profile.avatarUrl ? (
                                                <Image
                                                    src={profile.avatarUrl}
                                                    alt={`${profile.user.firstName} ${profile.user.lastName}`}
                                                    width={48}
                                                    height={48}
                                                    className="h-full w-full object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-zinc-600 dark:text-zinc-300">
                                                    {profile.user.firstName?.[0]}{profile.user.lastName?.[0]}
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <h2 className="text-lg font-semibold text-zinc-900 group-hover:text-zinc-600 transition-colors dark:text-zinc-100 dark:group-hover:text-zinc-300 truncate">
                                                {profile.user.firstName} {profile.user.lastName}
                                            </h2>
                                            {profile.headline && (
                                                <p className="mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 truncate">
                                                    {profile.headline}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Availability badge */}
                                    <div className="mt-3">
                                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${profile.acceptingClients
                                            ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                                            : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                                            }`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${profile.acceptingClients ? "bg-emerald-500" : "bg-amber-500"
                                                }`} />
                                            {profile.acceptingClients ? "Accepting Clients" : "Currently Full"}
                                        </span>
                                    </div>

                                    {profile.specialties.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            {profile.specialties.slice(0, 3).map((spec, i) => (
                                                <span key={i} className="inline-flex rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                                    {spec}
                                                </span>
                                            ))}
                                            {profile.specialties.length > 3 && (
                                                <span className="inline-flex rounded px-1 py-0.5 text-xs text-zinc-400">
                                                    +{profile.specialties.length - 3}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {profile.bio && (
                                        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                                            {profile.bio}
                                        </p>
                                    )}
                                </div>

                                <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                                    {profile.pricing && (
                                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                            {profile.pricing}
                                        </p>
                                    )}
                                    <span className="ml-auto text-sm font-medium text-zinc-500 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100 transition-colors">
                                        View Profile &rarr;
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
}
