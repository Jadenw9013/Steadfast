import { getCoachProfileBySlug } from "@/lib/queries/marketplace";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Footer } from "@/components/footer";

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

export default async function CoachProfilePage({ params }: PageProps) {
    const { slug } = await params;
    const profile = await getCoachProfileBySlug(slug);

    if (!profile) {
        notFound();
    }

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b]">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/90 backdrop-blur-md dark:border-zinc-800/60 dark:bg-[#09090b]/90">
                <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5 sm:px-8">
                    <Link
                        href="/coaches"
                        className="flex items-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                        ← Back to Directory
                    </Link>
                    <Link
                        href="/"
                        className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
                    >
                        <div className="relative h-8 w-8">
                            <Image
                                src="/brand/Steadfast_logo_pictoral.png"
                                alt=""
                                fill
                                className="object-contain"
                            />
                        </div>
                        <span className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Steadfast</span>
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-4xl px-5 py-16 sm:px-8" id="main-content">
                <div className="grid gap-12 lg:grid-cols-[1fr_300px]">
                    {/* Main Content */}
                    <div>
                        <div className="flex items-center gap-6">
                            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-3xl font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                {profile.user.firstName?.[0]}{profile.user.lastName?.[0]}
                            </div>
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
                        </div>

                        {profile.specialties.length > 0 && (
                            <div className="mt-6 flex flex-wrap gap-2">
                                {profile.specialties.map((spec, i) => (
                                    <span key={i} className="inline-flex rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300">
                                        {spec}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="mt-12 prose prose-zinc dark:prose-invert max-w-none">
                            <h2 className="text-xl font-semibold">About Me</h2>
                            <div className="mt-4 whitespace-pre-wrap leading-relaxed text-zinc-600 dark:text-zinc-400">
                                {profile.bio || "Bio coming soon."}
                            </div>
                        </div>

                        {/* ── Portfolio / Results ── */}
                        {profile.portfolioItems.length > 0 && (
                            <div className="mt-12">
                                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Results &amp; Portfolio</h2>
                                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                    {profile.portfolioItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="rounded-xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-[#121215]"
                                        >
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
                                            {item.result && (
                                                <p className="mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                                                    {item.result}
                                                </p>
                                            )}
                                            {item.description && (
                                                <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                                                    {item.description}
                                                </p>
                                            )}
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

                            {profile.acceptingClients ? (
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
            <Footer />
        </div>
    );
}
