import { db } from "@/lib/db";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { RequestForm } from "@/components/coaches/request-form";
import { WaitlistForm } from "@/components/coaches/waitlist-form";
import { Footer } from "@/components/footer";

interface PageProps {
    params: Promise<{
        slug: string;
    }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const profile = await db.coachProfile.findUnique({
        where: { slug, isPublished: true },
        include: { user: { select: { firstName: true, lastName: true } } },
    });

    if (!profile) return { title: "Coach Not Found" };

    return { title: `Request Coaching from ${profile.user.firstName} | Steadfast` };
}

export default async function CoachingRequestPage({ params }: PageProps) {
    const { slug } = await params;
    const profile = await db.coachProfile.findUnique({
        where: { slug, isPublished: true },
        include: {
            user: {
                select: { firstName: true, lastName: true },
            },
        },
    });

    if (!profile) {
        notFound();
    }

    const isAccepting = profile.acceptingClients;

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b]">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/90 backdrop-blur-md dark:border-zinc-800/60 dark:bg-[#09090b]/90">
                <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5 sm:px-8">
                    <Link
                        href={`/coaches/${profile.slug}`}
                        className="flex items-center gap-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                        ← Back to Profile
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

            <main className="mx-auto max-w-2xl px-5 py-12 sm:px-8" id="main-content">
                <div className="mb-8">
                    <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                        {isAccepting ? "Request Coaching" : "Join Waitlist"}
                    </h1>
                    <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                        {isAccepting
                            ? `Submit your intake to coach ${profile.user.firstName} ${profile.user.lastName}.`
                            : `${profile.user.firstName} is currently full, but you can join the waitlist to be notified when a spot opens.`
                        }
                    </p>
                </div>

                <div className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800/80 dark:bg-[#121215]">
                    {isAccepting ? (
                        <RequestForm coachProfileId={profile.id} />
                    ) : (
                        <WaitlistForm coachProfileId={profile.id} />
                    )}
                </div>
            </main>
            <Footer />
        </div>
    );
}
