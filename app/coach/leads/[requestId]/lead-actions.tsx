"use client";

import { useState, useTransition } from "react";
import { markContacted, scheduleConsultation, acceptClient, declineRequest } from "@/app/actions/coaching-requests";
import { useRouter } from "next/navigation";

type LeadActionsProps = {
    requestId: string;
    status: string;
    existingMeeting?: { meetingLink: string | null; scheduledTime: Date | null; notes: string | null } | null;
};

export function LeadActions({ requestId, status, existingMeeting }: LeadActionsProps) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [showSchedule, setShowSchedule] = useState(false);
    const [meetingLink, setMeetingLink] = useState(existingMeeting?.meetingLink ?? "");
    const [scheduledTime, setScheduledTime] = useState(
        existingMeeting?.scheduledTime
            ? new Date(existingMeeting.scheduledTime).toISOString().slice(0, 16)
            : ""
    );
    const [notes, setNotes] = useState(existingMeeting?.notes ?? "");
    const router = useRouter();

    function run(action: () => Promise<unknown>) {
        setError(null);
        startTransition(async () => {
            try {
                await action();
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong");
            }
        });
    }

    const isTerminal = status === "ACCEPTED" || status === "APPROVED" || status === "DECLINED" || status === "REJECTED";

    return (
        <div className="space-y-3">
            {error && (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>
            )}

            {!isTerminal && (
                <div className="flex flex-wrap gap-2">
                    {status === "PENDING" && (
                        <button
                            disabled={pending}
                            onClick={() => run(() => markContacted(requestId))}
                            className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-300 transition-all hover:bg-violet-500/20 disabled:opacity-50"
                        >
                            Mark Contacted
                        </button>
                    )}

                    {(status === "PENDING" || status === "CONTACTED") && (
                        <button
                            disabled={pending}
                            onClick={() => setShowSchedule((v) => !v)}
                            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                        >
                            {showSchedule ? "Hide" : "Schedule Consultation"}
                        </button>
                    )}

                    <button
                        disabled={pending}
                        onClick={() => run(() => acceptClient(requestId))}
                        className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-50"
                    >
                        Accept Client
                    </button>

                    <button
                        disabled={pending}
                        onClick={() => run(() => declineRequest(requestId))}
                        className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-400 transition-all hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
                    >
                        Decline
                    </button>
                </div>
            )}

            {/* Schedule consultation form */}
            {showSchedule && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        run(() =>
                            scheduleConsultation({ requestId, meetingLink, scheduledTime: scheduledTime || undefined, notes })
                        );
                        setShowSchedule(false);
                    }}
                    className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 p-5 space-y-4"
                >
                    <p className="text-sm font-semibold text-zinc-200">Schedule Consultation</p>
                    <div className="space-y-3">
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Meeting Link</label>
                            <input
                                type="url"
                                placeholder="https://cal.com/..."
                                value={meetingLink}
                                onChange={(e) => setMeetingLink(e.target.value)}
                                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500/50 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Date &amp; Time</label>
                            <input
                                type="datetime-local"
                                value={scheduledTime}
                                onChange={(e) => setScheduledTime(e.target.value)}
                                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 focus:border-amber-500/50 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Notes (optional)</label>
                            <textarea
                                rows={2}
                                placeholder="Topics to cover, etc."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500/50 focus:outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            disabled={pending}
                            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-amber-400 disabled:opacity-50"
                        >
                            Save & Mark Scheduled
                        </button>
                        <button type="button" onClick={() => setShowSchedule(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300">
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {isTerminal && (
                <p className="text-sm text-zinc-600">
                    This lead is {status === "ACCEPTED" || status === "APPROVED" ? "accepted — client is on your roster" : "closed"}.
                </p>
            )}
        </div>
    );
}
