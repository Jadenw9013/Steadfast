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
        <div className="min-h-screen bg-black">
            {/* ── Nav ── */}
            <header className="sticky top-0 z-30 border-b border-white/[0.04] bg-black/80 backdrop-blur-xl">
                <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5 sm:px-8">
                    <Link
                        href={`/coaches/${profile.slug}`}
                        className="text-sm font-medium text-zinc-400 transition-colors hover:text-white"
                    >
                        ← Back to Profile
                    </Link>
                    <Link
                        href="/"
                        className="group flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    >
                        <div className="relative h-7 w-7 transition-transform duration-200 group-hover:scale-110">
                            <Image
                                src="/brand/Steadfast_logo_pictoral.png"
                                alt=""
                                fill
                                className="object-contain brightness-0 invert"
                            />
                        </div>
                        <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-zinc-100 sm:inline">Steadfast</span>
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-2xl px-5 py-12 sm:px-8" id="main-content">
                <div className="mb-8">
                    <h1 className="text-3xl font-semibold tracking-tight text-white">
                        {isAccepting ? "Request Coaching" : "Join Waitlist"}
                    </h1>
                    <p className="mt-2 text-zinc-400">
                        {isAccepting
                            ? `Submit your intake to coach ${profile.user.firstName} ${profile.user.lastName}.`
                            : `${profile.user.firstName} is currently full, but you can join the waitlist to be notified when a spot opens.`
                        }
                    </p>
                </div>

                <div className="sf-glass-card p-6 sm:p-8">
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
