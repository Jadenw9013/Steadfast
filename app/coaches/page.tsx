import { getPublishedCoaches } from "@/lib/queries/marketplace";
import { getCachedProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Footer } from "@/components/footer";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { CoachFilters } from "@/components/public/coach-filters";
import { SaveCoachButton } from "@/components/public/save-coach-button";
import { getSavedCoachIds } from "@/lib/queries/saved-coaches";
import { Suspense } from "react";

export const metadata: Metadata = {
    title: "Find a Coach | Steadfast",
    description: "Browse our directory of professional Steadfast coaches and find the right fit for your goals.",
};

interface PageProps {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}

// Color palettes cycled per card index for visual distinction
const TAG_PALETTES = [
    "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20",
    "bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20",
    "bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20",
    "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
    "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
    "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20",
];

const BANNER_GRADIENTS = [
    "from-[#0f2042] via-[#1a3a7a] to-[#0d1829]",
    "from-[#1a0a3d] via-[#2d1466] to-[#0d0d1f]",
    "from-[#052e2e] via-[#0a4a5a] to-[#061420]",
    "from-[#1f0d08] via-[#3d1a10] to-[#0d0a06]",
    "from-[#0d2200] via-[#1a3d00] to-[#081408]",
];

function VerifiedBadge() {
    return (
        <span
            title="Verified Coach"
            className="ml-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 ring-1 ring-blue-400/30"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
            </svg>
        </span>
    );
}

const COACHING_MODE_LABELS: Record<string, { label: string; color: string }> = {
    "online": { label: "Online", color: "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20" },
    "in-person": { label: "In-Person", color: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" },
    "hybrid": { label: "Hybrid", color: "bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20" },
};

const SERVICE_TIER_LABELS: Record<string, string> = {
    "training-only": "Training",
    "nutrition-only": "Nutrition",
    "full-coaching": "Full coaching",
};

function EmptyState({ params, hasFilters }: { params: { [key: string]: string | undefined }; hasFilters: boolean }) {
    if (!hasFilters) {
        return (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
                <p className="text-sm font-medium text-zinc-300">No coaches are listed yet</p>
                <p className="mt-2 text-sm text-zinc-500">Our first coaches are setting up their profiles. Check back soon.</p>
            </div>
        );
    }

    // Build contextual suggestion links
    const suggestions: { label: string; href: string }[] = [];

    // If location caused the miss — suggest dropping city
    if (params.city) {
        const noCity = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "city" && v) as [string, string][]);
        suggestions.push({ label: "Broaden search — remove city filter", href: `/coaches?${noCity.toString()}` });
    }
    // If in-person — suggest hybrid
    if (params.type === "in-person") {
        const hybrid = new URLSearchParams({ ...params, type: "hybrid" } as Record<string, string>);
        suggestions.push({ label: "Also show Hybrid coaches", href: `/coaches?${hybrid.toString()}` });
        const online = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "type" && k !== "city" && v) as [string, string][]);
        online.set("type", "online");
        suggestions.push({ label: "Switch to Online coaching", href: `/coaches?${online.toString()}` });
    }
    // If serviceTier is specific — suggest dropping it
    if (params.serviceTier) {
        const noTier = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "serviceTier" && v) as [string, string][]);
        suggestions.push({ label: "Show all service types", href: `/coaches?${noTier.toString()}` });
    }
    // Always offer clear all
    suggestions.push({ label: "View all available coaches", href: "/coaches" });

    return (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-10">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            </div>
            <p className="text-center text-sm font-semibold text-zinc-200">No coaches match your filters</p>
            <p className="mt-1.5 text-center text-xs text-zinc-500">Try one of these to find more options:</p>
            <ul className="mt-5 space-y-2">
                {suggestions.slice(0, 4).map((s) => (
                    <li key={s.href}>
                        <Link
                            href={s.href}
                            className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-white"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                            {s.label}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default async function CoachesDirectoryPage({ searchParams }: PageProps) {
    const params = await searchParams;
    const coaches = await getPublishedCoaches({
        goal: params.goal,
        type: params.type,
        accepting: params.accepting === "1",
        service: params.service,
        serviceTier: params.serviceTier,
        clientType: params.clientType,
        minRating: params.minRating ? Number(params.minRating) : undefined,
        sort: params.sort,
        q: params.q,
        city: params.city,
    });

    // Resolve profile photos
    const coachesWithPhotos = await Promise.all(
        coaches.map(async (profile) => {
            let avatarUrl: string | null = null;
            if (profile.user.profilePhotoPath) {
                try { avatarUrl = await getCachedProfilePhotoUrl(profile.user.profilePhotoPath); } catch { /* */ }
            }
            return { ...profile, avatarUrl };
        })
    );

    // Resolve saved coach IDs (auth-aware — public page)
    let savedIds: Set<string> | null = null;
    try {
        const { getCurrentDbUser } = await import("@/lib/auth/roles");
        const user = await getCurrentDbUser();
        savedIds = await getSavedCoachIds(user.id);
    } catch { /* not logged in — no save buttons */ }

    // Collect active filters for chips display
    const activeFilters: { key: string; label: string; paramKey: string }[] = [];
    if (params.goal) activeFilters.push({ key: "goal", label: params.goal, paramKey: "goal" });
    if (params.type) activeFilters.push({ key: "type", label: params.type === "in-person" ? "In-Person" : params.type.charAt(0).toUpperCase() + params.type.slice(1), paramKey: "type" });
    if (params.serviceTier) activeFilters.push({ key: "serviceTier", label: params.serviceTier === "training-only" ? "Training only" : params.serviceTier === "nutrition-only" ? "Nutrition only" : "Full coaching", paramKey: "serviceTier" });
    if (params.city) activeFilters.push({ key: "city", label: `Near ${params.city}`, paramKey: "city" });
    if (params.service) activeFilters.push({ key: "service", label: params.service, paramKey: "service" });
    if (params.clientType) activeFilters.push({ key: "clientType", label: params.clientType, paramKey: "clientType" });
    if (params.minRating) activeFilters.push({ key: "minRating", label: `${params.minRating}+ stars`, paramKey: "minRating" });
    if (params.accepting === "1") activeFilters.push({ key: "accepting", label: "Accepting clients", paramKey: "accepting" });
    if (params.q) activeFilters.push({ key: "q", label: `"${params.q}"`, paramKey: "q" });

    const hasFilters = activeFilters.length > 0;

    // Platform-level trust stats
    const totalCoaches = coachesWithPhotos.length;
    const acceptingCount = coachesWithPhotos.filter(c => c.acceptingClients).length;
    const allRatings = coachesWithPhotos.filter(c => c.ratingSummary.averageRating > 0);
    const platformAvg = allRatings.length > 0
        ? (allRatings.reduce((s, c) => s + c.ratingSummary.averageRating, 0) / allRatings.length).toFixed(1)
        : null;

    return (
        <div className="min-h-screen bg-[#080d1a] text-zinc-100">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#080d1a]/95 backdrop-blur-sm">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-8">
                    <Link href="/" className="group flex items-center gap-2.5" aria-label="Steadfast home">
                        <div className="relative h-7 w-7 transition-transform duration-200 group-hover:scale-110 sm:h-8 sm:w-8">
                            <Image src="/brand/Steadfast_logo_pictoral.png" alt="" fill priority className="object-contain" />
                        </div>
                        <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-zinc-100 sm:inline">Steadfast</span>
                    </Link>
                    <nav className="flex items-center gap-3">
                        <ThemeToggle />
                        <Link href="/sign-in" className="text-sm font-medium text-zinc-400 transition-colors hover:text-white">Sign In</Link>
                        <Link
                            href="/sign-up"
                            className="rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:brightness-110 active:scale-[0.97]"
                        >
                            Get Started
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8" id="main-content">
                {/* ── Hero ── */}
                <div className="mb-8">
                    <div className="flex items-center gap-3">
                        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                            Find your coach
                        </h1>
                        <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                            Beta
                        </span>
                    </div>
                    <p className="mt-3 max-w-2xl text-base text-zinc-400">
                        Browse verified coaches and find the right fit for your goals.
                    </p>

                    {/* Search */}
                    <form action="/coaches" method="GET" className="mt-6 max-w-md">
                        {Object.entries(params).filter(([k, v]) => k !== "q" && v).map(([k, v]) => (
                            <input key={k} type="hidden" name={k} value={v} />
                        ))}
                        <div className="relative">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500">
                                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                            </svg>
                            <input
                                type="text"
                                name="q"
                                defaultValue={params.q || ""}
                                placeholder="Search by name, specialty, or keyword..."
                                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-500 transition-all focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                        </div>
                    </form>
                </div>

                {/* ── Trust Stats Bar ── */}
                <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-5 py-3.5">
                    <div className="flex items-baseline gap-1.5">
                        <span className="font-display text-xl font-bold text-white">{totalCoaches}</span>
                        <span className="text-xs text-zinc-500 uppercase tracking-wider">coaches available</span>
                    </div>
                    <div className="h-3 w-px bg-white/10 hidden sm:block" />
                    <div className="flex items-baseline gap-1.5">
                        <span className="font-display text-xl font-bold text-white">100%</span>
                        <span className="text-xs text-zinc-500 uppercase tracking-wider">verified</span>
                    </div>
                    {platformAvg && (
                        <>
                            <div className="h-3 w-px bg-white/10 hidden sm:block" />
                            <div className="flex items-center gap-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                <span className="font-display text-xl font-bold text-white">{platformAvg}</span>
                                <span className="text-xs text-zinc-500 uppercase tracking-wider">avg rating</span>
                            </div>
                        </>
                    )}
                    <div className="h-3 w-px bg-white/10 hidden sm:block" />
                    <div className="flex items-baseline gap-1.5">
                        <span className="font-display text-xl font-bold text-emerald-400">{acceptingCount}</span>
                        <span className="text-xs text-zinc-500 uppercase tracking-wider">accepting now</span>
                    </div>
                </div>

                {/* ── Mobile Filters ── */}
                <div className="lg:hidden mb-4">
                    <Suspense>
                        <CoachFilters />
                    </Suspense>
                </div>

                <div className="flex gap-8">
                    {/* ── Desktop Filter Sidebar ── */}
                    <div className="hidden lg:block w-64 shrink-0">
                        <div className="sticky top-24 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
                            <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Filters</h3>
                            <Suspense>
                                <CoachFilters />
                            </Suspense>
                        </div>
                    </div>

                    {/* ── Coach Grid ── */}
                    <div className="flex-1 min-w-0">
                        {/* Result count + active chips */}
                        <div className="mb-5">
                            <p className="text-sm text-zinc-500">
                                {coachesWithPhotos.length} {coachesWithPhotos.length === 1 ? "coach" : "coaches"}{hasFilters ? " matching filters" : " available"}
                            </p>
                            {activeFilters.length > 0 && (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {activeFilters.map((f) => (
                                        <Link
                                            key={f.key}
                                            href={`/coaches?${new URLSearchParams(
                                                Object.entries(params).filter(([k, v]) => k !== f.paramKey && v !== undefined) as [string, string][]
                                            ).toString()}`}
                                            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10"
                                        >
                                            {f.label}
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                        </Link>
                                    ))}
                                    <Link href="/coaches" className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300">
                                        Clear all
                                    </Link>
                                </div>
                            )}
                        </div>

                        {coaches.length === 0 ? (
                            <EmptyState params={params} hasFilters={hasFilters} />
                        ) : (
                            <div className="grid gap-5 sm:grid-cols-2">
                                {coachesWithPhotos.map((profile, idx) => {
                                    const tagPalette = TAG_PALETTES[idx % TAG_PALETTES.length];
                                    const bannerGradient = BANNER_GRADIENTS[idx % BANNER_GRADIENTS.length];
                                    const hasRating = profile.ratingSummary.totalReviews > 0;

                                    return (
                                        <Link
                                            key={profile.id}
                                            href={`/coaches/${profile.slug}`}
                                            className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1428] transition-all duration-200 ease-out hover:-translate-y-[3px] hover:border-blue-500/30 hover:shadow-xl hover:shadow-blue-500/10"
                                            style={{ "--tw-shadow-color": "rgba(59,124,244,0.15)" } as React.CSSProperties}
                                        >
                                            {/* Top accent line */}
                                            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-blue-600 to-blue-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                                            {/* Save button */}
                                            {savedIds !== null && (
                                                <div className="absolute top-3 right-3 z-10">
                                                    <SaveCoachButton coachProfileId={profile.id} initialSaved={savedIds.has(profile.id)} />
                                                </div>
                                            )}

                                            {/* ── Banner + Avatar ── */}
                                            <div className="relative">
                                                <div className={`h-20 bg-gradient-to-br ${bannerGradient}`} />
                                                <div className="absolute -bottom-8 left-5">
                                                    <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-[#0d1428] bg-[#1a2540] ring-2 ring-white/10 shadow-lg shadow-black/40">
                                                        {profile.avatarUrl ? (
                                                            <Image
                                                                src={profile.avatarUrl}
                                                                alt={`${profile.user.firstName} ${profile.user.lastName}`}
                                                                width={64}
                                                                height={64}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center text-xl font-bold text-zinc-400">
                                                                {profile.user.firstName?.[0]}{profile.user.lastName?.[0]}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ── Card body ── */}
                                            <div className="flex flex-1 flex-col px-5 pb-5 pt-11">
                                                {/* Name + verified + availability */}
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center">
                                                            <h2 className="truncate text-base font-bold text-white">
                                                                {profile.user.firstName} {profile.user.lastName}
                                                            </h2>
                                                            <VerifiedBadge />
                                                        </div>
                                                        {profile.headline && (
                                                            <p className="mt-0.5 truncate text-[13px] text-zinc-400">{profile.headline}</p>
                                                        )}
                                                    </div>
                                                    {/* Availability pill */}
                                                    {profile.acceptingClients ? (
                                                        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                                                            <span className="relative flex h-1.5 w-1.5">
                                                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                                                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                                            </span>
                                                            Available
                                                        </span>
                                                    ) : (
                                                        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400 ring-1 ring-amber-500/20">
                                                            Full
                                                        </span>
                                                    )}
                                                </div>

                                                {/* ── Mode + Location + Service Tier row ── */}
                                                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                                    {profile.coachingType && COACHING_MODE_LABELS[profile.coachingType] && (
                                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${COACHING_MODE_LABELS[profile.coachingType].color}`}>
                                                            {COACHING_MODE_LABELS[profile.coachingType].label}
                                                        </span>
                                                    )}
                                                    {profile.serviceTier && SERVICE_TIER_LABELS[profile.serviceTier] && (
                                                        <span className="inline-flex items-center rounded-full bg-zinc-700/60 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                                                            {SERVICE_TIER_LABELS[profile.serviceTier]}
                                                        </span>
                                                    )}
                                                    {(profile.coachingType === "in-person" || profile.coachingType === "hybrid") && (profile.city || profile.location) && (
                                                        <span className="text-[10px] text-zinc-500">
                                                            {[profile.city, profile.state].filter(Boolean).join(", ") || profile.location}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Match reasons — only shown when filters are active */}
                                                {hasFilters && profile.matchReasons.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1">
                                                        {profile.matchReasons.map((reason) => (
                                                            <span key={reason} className="inline-flex items-center gap-1 rounded-md bg-blue-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-blue-400 ring-1 ring-blue-500/20">
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                                                                {reason}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* ── Stats row ── */}
                                                <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.03]">
                                                    <div className="flex flex-col items-center py-2.5 px-1">
                                                        <span className="font-display text-lg font-bold leading-none text-white">
                                                            {hasRating ? profile.ratingSummary.averageRating.toFixed(1) : "—"}
                                                        </span>
                                                        <span className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500">Rating</span>
                                                    </div>
                                                    <div className="flex flex-col items-center py-2.5 px-1">
                                                        <span className="font-display text-lg font-bold leading-none text-white">
                                                            {profile.clientCount > 0 ? profile.clientCount : "—"}
                                                        </span>
                                                        <span className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500">Clients</span>
                                                    </div>
                                                    <div className="flex flex-col items-center py-2.5 px-1">
                                                        <span className="font-display text-lg font-bold leading-none text-white">
                                                            {profile.ratingSummary.totalReviews > 0 ? profile.ratingSummary.totalReviews : "—"}
                                                        </span>
                                                        <span className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500">Reviews</span>
                                                    </div>
                                                </div>

                                                {/* Bio excerpt */}
                                                {profile.bio && (
                                                    <p className="mt-4 text-[13px] leading-relaxed text-zinc-400 line-clamp-2">
                                                        {profile.bio}
                                                    </p>
                                                )}

                                                {/* Goal tags */}
                                                {profile.clientGoals.length > 0 && (
                                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                                        {profile.clientGoals.slice(0, 3).map((goal, i) => (
                                                            <span key={i} className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tagPalette}`}>
                                                                {goal}
                                                            </span>
                                                        ))}
                                                        {profile.clientGoals.length > 3 && (
                                                            <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] text-zinc-500">
                                                                +{profile.clientGoals.length - 3}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Footer — Pricing + View */}
                                                <div className="mt-auto flex items-center justify-between pt-4">
                                                    {profile.pricing ? (
                                                        <span className="text-sm font-semibold text-white">
                                                            {profile.pricing}
                                                        </span>
                                                    ) : (
                                                        <span />
                                                    )}
                                                    <span className="inline-flex items-center gap-1 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-400 transition-all duration-200 group-hover:border-blue-500/40 group-hover:bg-blue-500/20 group-hover:text-blue-300">
                                                        View Profile
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                                                    </span>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
