import { getCoachProfileBySlug } from "@/lib/queries/marketplace";
import { getPortfolioMediaUrl } from "@/lib/supabase/portfolio-storage";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Footer } from "@/components/footer";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

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
        <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b]">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 bg-zinc-50 dark:bg-[#09090b]">
                <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-5 sm:px-8">
                    <Link
                        href="/coaches"
                        className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                        ← Directory
                    </Link>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
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
                    </div>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-gray-700/40" />
            </header>

            <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8" id="main-content">
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
                        <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-zinc-50 bg-zinc-100 shadow-lg dark:border-[#09090b] dark:bg-zinc-800">
                            {avatarUrl ? (
                                <Image
                                    src={avatarUrl}
                                    alt={`${profile.user.firstName} ${profile.user.lastName}`}
                                    width={112}
                                    height={112}
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-600 dark:text-zinc-300">
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
                            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
                                {profile.user.firstName} {profile.user.lastName}
                            </h1>
                            {profile.headline && (
                                <p className="mt-1.5 text-lg font-medium text-zinc-600 dark:text-zinc-400">
                                    {profile.headline}
                                </p>
                            )}
                            <div className="mt-2">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${profile.acceptingClients
                                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                                    : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                                    }`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${profile.acceptingClients ? "bg-emerald-500" : "bg-amber-500"
                                        }`} />
                                    {profile.acceptingClients ? "Accepting New Clients" : "Currently Full"}
                                </span>
                            </div>
                        </div>

                        {profile.specialties.length > 0 && (
                            <div className="mt-8">
                                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Specialties</p>
                                <div className="flex flex-wrap gap-2">
                                    {profile.specialties.map((spec, i) => (
                                        <span key={i} className="inline-flex rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300">
                                            {spec}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-12 prose prose-zinc dark:prose-invert max-w-none">
                            <h2 className="text-xl font-semibold">About Me</h2>
                            <div className="mt-4 whitespace-pre-wrap leading-relaxed text-zinc-600 dark:text-zinc-400">
                                {profile.bio || "Bio coming soon."}
                            </div>
                        </div>

                        {/* ── Posts ── */}
                        {profile.portfolioItems.length > 0 && (
                            <div className="mt-12">
                                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Posts</h2>
                                <div className="mt-6 space-y-5">
                                    {portfolioMediaItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700"
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
                                                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {item.title}
                                                    </h3>
                                                    {item.category && (
                                                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                                            {item.category}
                                                        </span>
                                                    )}
                                                </div>
                                                {item.description && (
                                                    <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
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
                        <div className="sticky top-32 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm dark:border-zinc-800/80 dark:bg-[#121215]">
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                {profile.acceptingClients ? "Start Coaching" : "Currently Full"}
                            </h3>

                            {profile.pricing && (
                                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                                    {profile.pricing}
                                </p>
                            )}

                            {isExistingClient ? (
                                <>
                                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M20 6 9 17l-5-5" /></svg>
                                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Your Coach</span>
                                    </div>
                                    <Link
                                        href="/client"
                                        className="mt-3 flex w-full items-center justify-center rounded-xl border-2 border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-600 transition-all hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50"
                                    >
                                        Go to Dashboard
                                    </Link>
                                </>
                            ) : profile.acceptingClients ? (
                                <>
                                    <Link
                                        href={`/coaches/${profile.slug}/request`}
                                        className="mt-6 flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-zinc-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                                    >
                                        Request Coaching
                                    </Link>
                                    <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                                        Free to request. Your coach will review your intake and respond within a few days.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Link
                                        href={`/coaches/${profile.slug}/request`}
                                        className="mt-6 flex w-full items-center justify-center rounded-xl border-2 border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-700 transition-all hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800/50"
                                    >
                                        Join Waitlist
                                    </Link>
                                    <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                                        This coach is currently full. Join the waitlist to be notified when a spot opens.
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
