import { getInviteDetails, redeemInvite } from "@/app/actions/client-invites";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Accept Invite | Steadfast" };

export default async function InviteRedemptionPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const { userId } = await auth();

    const invite = await getInviteDetails(token);

    if (!invite) notFound();

    const isExpired = invite.status === "EXPIRED" || new Date(invite.expiresAt) < new Date();
    const isAlreadyUsed = invite.status === "ACCEPTED";

    const coachName = [invite.coach.firstName, invite.coach.lastName].filter(Boolean).join(" ") || "Your coach";

    // If signed in, attempt redemption server-side
    if (userId && !isExpired && !isAlreadyUsed) {
        let result: { success?: boolean; error?: string; coachName?: string } = {};
        try {
            result = await redeemInvite(token) as typeof result;
        } catch (e) {
            result = { error: e instanceof Error ? e.message : "Something went wrong" };
        }

        if (result.success) {
            redirect("/client?welcomed=1");
        }

        // If there was an error (wrong email, etc.) — show it
        return (
            <div className="flex min-h-screen items-center justify-center bg-black px-5">
                <div className="w-full max-w-md sf-glass-card !border-red-500/20 p-8 text-center space-y-4">
                    <p className="text-lg font-semibold text-zinc-100">Invite Error</p>
                    <p className="text-sm text-red-400">{result.error}</p>
                    <Link href="/client" className="inline-block text-sm text-zinc-500 hover:text-zinc-300">
                        Go to your dashboard →
                    </Link>
                </div>
            </div>
        );
    }

    // Not signed in — show landing page with sign-up CTA
    const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(`/invite/${token}`)}`;
    const signUpUrl = `/sign-up?redirect_url=${encodeURIComponent(`/invite/${token}`)}`;

    return (
        <div className="flex min-h-screen items-center justify-center bg-black px-5">
            <div className="w-full max-w-md space-y-6">
                {/* Card */}
                <div className="sf-glass-card p-8 text-center space-y-5">
                    {/* Icon */}
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                    </div>

                    {isExpired ? (
                        <>
                            <h1 className="text-xl font-bold text-zinc-100">This invite has expired</h1>
                            <p className="text-sm text-zinc-500">Ask <span className="text-zinc-300">{coachName}</span> to send you a new invite link.</p>
                        </>
                    ) : isAlreadyUsed ? (
                        <>
                            <h1 className="text-xl font-bold text-zinc-100">Invite already used</h1>
                            <p className="text-sm text-zinc-500">This invite link has already been redeemed. <Link href="/sign-in" className="text-blue-400 hover:underline">Sign in</Link> to access your account.</p>
                        </>
                    ) : (
                        <>
                            <h1 className="text-xl font-bold text-zinc-100">
                                {coachName} invited you to Steadfast
                            </h1>
                            {invite.coach.coachProfile?.headline && (
                                <p className="text-sm text-zinc-500">{invite.coach.coachProfile.headline}</p>
                            )}
                            <p className="text-sm text-zinc-400">
                                Create your account to get started with structured coaching — training, nutrition, and weekly check-ins all in one place.
                            </p>

                            <div className="space-y-3 pt-2">
                                <Link
                                    href={signUpUrl}
                                    className="block w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500"
                                >
                                    Create Account
                                </Link>
                                <Link
                                    href={signInUrl}
                                    className="block w-full rounded-xl border border-zinc-700 py-3 text-sm font-medium text-zinc-400 transition-all hover:border-zinc-600 hover:text-zinc-200"
                                >
                                    Already have an account? Sign in
                                </Link>
                            </div>
                        </>
                    )}
                </div>

                {/* Brand */}
                <p className="text-center text-xs text-zinc-700">Powered by Steadfast</p>
            </div>
        </div>
    );
}
