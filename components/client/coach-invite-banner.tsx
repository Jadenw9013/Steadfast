"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { redeemInvite } from "@/app/actions/client-invites";

type PendingInvite = {
    id: string;
    inviteToken: string;
    coach: {
        firstName: string | null;
        lastName: string | null;
        coachProfile: { headline: string | null; slug: string | null } | null;
    };
};

/**
 * Explicit accept step for a coach-issued invitation (CB01). A coach
 * entering this client's email never creates a relationship by itself —
 * this banner, and its "Accept" action, is the only thing that does.
 */
export function CoachInviteBanner({ invites }: { invites: PendingInvite[] }) {
    const router = useRouter();
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const visible = invites.filter((i) => !dismissed.has(i.id));
    if (visible.length === 0) return null;

    async function handleAccept(invite: PendingInvite) {
        setPendingId(invite.id);
        setError(null);
        try {
            const result = await redeemInvite(invite.inviteToken);
            if ("error" in result && result.error) {
                setError(result.error);
                return;
            }
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
        } finally {
            setPendingId(null);
        }
    }

    return (
        <div className="space-y-3">
            {visible.map((invite) => {
                const coachName = [invite.coach.firstName, invite.coach.lastName].filter(Boolean).join(" ") || "A coach";
                return (
                    <div
                        key={invite.id}
                        className="rounded-2xl border border-blue-500/20 bg-blue-950/30 px-6 py-5"
                    >
                        <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                            Coach invitation
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-blue-100">
                            {coachName} wants to connect with you on Steadfast
                        </p>
                        {invite.coach.coachProfile?.headline && (
                            <p className="mt-0.5 text-xs text-blue-400/70">{invite.coach.coachProfile.headline}</p>
                        )}
                        <p className="mt-2 text-xs text-blue-400/60">
                            Nothing is shared with {coachName} until you accept.
                        </p>
                        {error && pendingId === null && (
                            <p className="mt-2 text-xs text-red-400">{error}</p>
                        )}
                        <div className="mt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={() => handleAccept(invite)}
                                disabled={pendingId === invite.id}
                                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-60"
                                style={{ minHeight: "48px" }}
                            >
                                {pendingId === invite.id ? "Connecting…" : "Accept"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDismissed((prev) => new Set(prev).add(invite.id))}
                                disabled={pendingId === invite.id}
                                className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-400 transition-all hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-60"
                                style={{ minHeight: "48px" }}
                            >
                                Not now
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
