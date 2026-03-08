"use client";

import { useState } from "react";
import { approveCoachingRequest, rejectCoachingRequest } from "@/app/actions/coaching-requests";
import dayjs from "dayjs";

type CoachingRequest = {
    id: string;
    prospectName: string;
    prospectEmail: string;
    status: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    intakeAnswers: any;
    createdAt: Date;
};

export function RequestList({
    requests,
    readOnly = false,
    variant = "request",
}: {
    requests: CoachingRequest[];
    readOnly?: boolean;
    variant?: "request" | "waitlist";
}) {
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    if (requests.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-[#121215]">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    {variant === "waitlist"
                        ? "No waitlist entries yet."
                        : readOnly
                            ? "No history yet."
                            : "No pending requests. New requests will appear here when prospects reach out from your public profile."}
                </p>
            </div>
        );
    }

    async function handleApprove(id: string) {
        setProcessingId(id);
        setErrorMsg(null);
        setConfirmRejectId(null);
        try {
            await approveCoachingRequest(id);
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : "Failed to approve request.");
        } finally {
            setProcessingId(null);
        }
    }

    async function handleReject(id: string) {
        if (confirmRejectId !== id) {
            setConfirmRejectId(id);
            return;
        }

        setProcessingId(id);
        setErrorMsg(null);
        try {
            await rejectCoachingRequest(id);
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : "Failed to decline.");
        } finally {
            setProcessingId(null);
            setConfirmRejectId(null);
        }
    }

    const statusBadge = (status: string) => {
        switch (status) {
            case "APPROVED":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Approved
                    </span>
                );
            case "REJECTED":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 dark:bg-red-500/20 dark:text-red-400">
                        Declined
                    </span>
                );
            case "WAITLISTED":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        Waitlisted
                    </span>
                );
            default:
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Pending
                    </span>
                );
        }
    };

    return (
        <div className="space-y-4">
            {errorMsg && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {errorMsg}
                </div>
            )}

            {requests.map((req) => (
                <div
                    key={req.id}
                    className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm dark:border-zinc-800/80 dark:bg-[#121215]"
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                {req.prospectName}
                            </h3>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                {req.prospectEmail} &middot; {dayjs(req.createdAt).format("MMM D, YYYY")}
                            </p>
                        </div>
                        {readOnly ? (
                            statusBadge(req.status)
                        ) : variant === "waitlist" ? (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handleReject(req.id)}
                                    disabled={processingId !== null && processingId !== req.id}
                                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${confirmRejectId === req.id
                                        ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                        }`}
                                >
                                    {processingId === req.id && confirmRejectId === req.id
                                        ? "Removing..."
                                        : confirmRejectId === req.id
                                            ? "Confirm Remove"
                                            : "Remove"}
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handleReject(req.id)}
                                    disabled={processingId !== null && processingId !== req.id}
                                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${confirmRejectId === req.id
                                        ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                        }`}
                                >
                                    {processingId === req.id && confirmRejectId === req.id
                                        ? "Decline..."
                                        : confirmRejectId === req.id
                                            ? "Confirm Decline"
                                            : "Decline"}
                                </button>
                                {confirmRejectId !== req.id && (
                                    <button
                                        onClick={() => handleApprove(req.id)}
                                        disabled={processingId !== null}
                                        className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                                    >
                                        {processingId === req.id ? "Processing..." : "Approve & Convert"}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 space-y-4 border-t border-zinc-100 pt-6 dark:border-zinc-800">
                        {variant === "waitlist" ? (
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Note</p>
                                <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                                    {req.intakeAnswers?.note || "No note provided."}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Goals</p>
                                    <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                                        {req.intakeAnswers?.goals || "N/A"}
                                    </p>
                                </div>

                                {(req.intakeAnswers?.experience || req.intakeAnswers?.injuries) && (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {req.intakeAnswers?.experience && (
                                            <div>
                                                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Experience</p>
                                                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                                                    {req.intakeAnswers.experience}
                                                </p>
                                            </div>
                                        )}
                                        {req.intakeAnswers?.injuries && (
                                            <div>
                                                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Injuries</p>
                                                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                                                    {req.intakeAnswers.injuries}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
