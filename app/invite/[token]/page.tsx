import { getInviteDetails, redeemInvite } from "@/app/actions/client-invites";
import { acceptAnywayRedirectTarget, confirmErrorMessageForCode } from "@/lib/activation";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Accept Invite | Steadfast" };

export default async function InviteRedemptionPage({
    params,
    searchParams,
}: {
    params: Promise<{ token: string }>;
    searchParams: Promise<{ confirmError?: string }>;
}) {
    const { token } = await params;
    const { confirmError } = await searchParams;

    // T-1012: confirmation path for an invite addressed to something other than a
    // verified address on this account (Apple relay, an alias, or a mistyped address).
    //
    // T-987 review: this MUST branch on the result. Between the confirm card
    // rendering and this submission, another holder of the token may have
    // redeemed it, the invite may have expired, or the client may have
    // enrolled in AI coaching / joined another coach in another tab — every
    // one of those is a real, service-level refusal that writes nothing.
    // Redirecting to the welcome dashboard regardless would be the exact
    // lie fixed in lib/activation.ts, one layer up (release-safety §4).
    async function acceptAnyway() {
        "use server";
        let target: string;
        try {
            const result = await redeemInvite(token, { confirmDifferentEmail: true });
            target = acceptAnywayRedirectTarget(
                token,
                "success" in result && result.success
                    ? { success: true }
                    : { success: false, error: "error" in result ? result.error : "Something went wrong. Please try again." }
            );
        } catch {
            // T-987 review round 2, code review finding B: redeemInvite calls
            // getCurrentDbUser(), which throws when the Clerk session has
            // lapsed between the confirm card rendering and this submission
            // (the ordinary case for a form left open on a public page) or
            // the account is pending deletion. Uncaught, that reaches the
            // user as Next's blank default error screen — no error.tsx
            // exists here. Route through the same table as every other
            // refusal, with a code that matches nothing known, so the page
            // shows the generic sentence. Never put the thrown error's
            // message in the URL — it can carry internals.
            target = acceptAnywayRedirectTarget(token, { success: false, error: "__unexpected__" });
        }
        redirect(target);
    }
    const { userId } = await auth();

    const invite = await getInviteDetails(token);

    if (!invite) notFound();

    const isExpired = invite.status === "EXPIRED" || new Date(invite.expiresAt) < new Date();
    const isAlreadyUsed = invite.status === "ACCEPTED";

    const coachName = [invite.coach.firstName, invite.coach.lastName].filter(Boolean).join(" ") || "Your coach";

    // A confirm submission just refused: show the real reason, not a stale
    // "already used"/"expired" landing derived from the invite row alone,
    // and not another silent "welcomed" redirect.
    //
    // T-987 review round 2 (parity MINOR 2, code review finding C):
    // `confirmError` is a stable CODE from the URL, not free text — anyone
    // holding any valid token could otherwise craft this URL to render
    // arbitrary phishing copy on the product domain. The sentence always
    // comes from confirmErrorMessageForCode's fixed table; an unrecognised
    // code (including one a thrown error produces) renders the generic
    // fallback, never the raw query value.
    if (confirmError) {
        return (
            <div className="flex min-h-[100dvh] items-center justify-center bg-black px-5">
                <div className="w-full max-w-md sf-glass-card !border-red-500/20 p-8 text-center space-y-4">
                    <p className="text-lg font-semibold text-zinc-100">Invite Error</p>
                    <p className="text-sm text-red-400">{confirmErrorMessageForCode(confirmError)}</p>
                    <Link href="/client" className="inline-block text-sm text-zinc-500 hover:text-zinc-300">
                        Go to your dashboard →
                    </Link>
                </div>
            </div>
        );
    }

    // If signed in, attempt redemption server-side
    if (userId && !isExpired && !isAlreadyUsed) {
        let result: {
            success?: boolean;
            error?: string;
            coachName?: string | null;
            confirmationRequired?: boolean;
            invitedEmailHint?: string;
            signedInAs?: string;
        } = {};
        try {
            result = await redeemInvite(token) as typeof result;
        } catch (e) {
            result = { error: e instanceof Error ? e.message : "Something went wrong" };
        }

        if (result.success) {
            redirect("/client?welcomed=1");
        }

        // T-1012: the invited address is not one of the verified addresses on this
        // account. That is routine — Apple "Hide My Email" relays never match, and a
        // coach may simply have typed a different address for the same person. The
        // token already proves possession of the invite, so confirm rather than refuse.
        if (result.confirmationRequired) {
            return (
                <div className="flex min-h-[100dvh] items-center justify-center bg-black px-5">
                    <div className="w-full max-w-md sf-glass-card p-8 text-center space-y-5">
                        <h1 className="text-xl font-bold text-zinc-100">Confirm your invite</h1>
                        <p className="text-sm text-zinc-400">
                            {coachName} sent this invite to{" "}
                            <span className="text-zinc-200">{result.invitedEmailHint}</span>.
                            {result.signedInAs ? (
                                <>
                                    {" "}You&apos;re signed in as{" "}
                                    <span className="text-zinc-200">{result.signedInAs}</span>.
                                </>
                            ) : null}
                        </p>
                        <p className="text-sm text-zinc-500">
                            If that&apos;s you, go ahead. Using a different address is fine.
                        </p>
                        <form action={acceptAnyway}>
                            <button
                                type="submit"
                                className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 min-h-[48px]"
                            >
                                Join {coachName}
                            </button>
                        </form>
                        <Link href="/client" className="inline-block text-sm text-zinc-500 hover:text-zinc-300">
                            Not me, go to my dashboard →
                        </Link>
                    </div>
                </div>
            );
        }

        // If there was an error (wrong email, etc.) — show it
        return (
            <div className="flex min-h-[100dvh] items-center justify-center bg-black px-5">
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
        <div className="flex min-h-[100dvh] items-center justify-center bg-black px-5">
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

                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-left space-y-1">
                                <p className="text-xs font-semibold text-zinc-300">Medical Disclaimer &amp; Liability</p>
                                <p className="text-[11px] leading-relaxed text-zinc-400">
                                    Steadfast provides general fitness and wellness coaching only, not medical advice or treatment. Always consult your doctor before starting any exercise or diet program. Steadfast is not liable for health outcomes or injuries.
                                </p>
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
