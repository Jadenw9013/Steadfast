"use client";

import { useState } from "react";
import { approveCoachingRequest, rejectCoachingRequest, resendInvite } from "@/app/actions/coaching-requests";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

type CoachingRequest = {
    id: string;
    prospectName: string;
    prospectEmail: string;
    status: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    intakeAnswers: any;
    createdAt: Date;
    prospectId: string | null;
    inviteLastSentAt: Date | null;
    inviteSendCount: number;
};

type ApprovalFeedback = {
    requestId: string;
    prospectName: string;
    immediateLink: boolean;
};

type ResendFeedback = {
    requestId: string;
    success: boolean;
    message: string;
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
    const [approvalFeedback, setApprovalFeedback] = useState<ApprovalFeedback | null>(null);
    const [resendFeedback, setResendFeedback] = useState<ResendFeedback | null>(null);
    const [resendingId, setResendingId] = useState<string | null>(null);

    if (requests.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-[#0a1224]">
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
        setApprovalFeedback(null);
        const req = requests.find((r) => r.id === id);
        try {
            const result = await approveCoachingRequest(id);
            setApprovalFeedback({
                requestId: id,
                prospectName: req?.prospectName || "Client",
                immediateLink: result.immediateLink,
            });
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

    async function handleResend(id: string) {
        if (resendingId) return; // duplicate-click guard
        setResendingId(id);
        setResendFeedback(null);
        setErrorMsg(null);
        try {
            const result = await resendInvite(id);
            setResendFeedback({ requestId: id, success: result.success, message: result.message });
        } catch (err: unknown) {
            setResendFeedback({
                requestId: id,
                success: false,
                message: err instanceof Error ? err.message : "Failed to resend invite.",
            });
        } finally {
            setResendingId(null);
        }
    }

    const statusBadge = (status: string) => {
        switch (status) {
            case "APPROVED":
                return null; // Handled inline with handoff context
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
            {approvalFeedback && (
                <div className={`rounded-lg border p-4 text-sm ${approvalFeedback.immediateLink
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                    }`}>
                    {approvalFeedback.immediateLink ? (
                        <p>✅ <strong>{approvalFeedback.prospectName}</strong> is now your client. They already had an account and have been linked automatically.</p>
                    ) : (
                        <p>✅ Approved. <strong>{approvalFeedback.prospectName}</strong> will receive an email with sign-up instructions. They&apos;ll be linked to you automatically when they create their account.</p>
                    )}
                </div>
            )}

            {resendFeedback && (
                <div className={`rounded-lg border p-4 text-sm ${resendFeedback.success
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                    }`}>
                    <p>{resendFeedback.message}</p>
                </div>
            )}

            {errorMsg && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {errorMsg}
                </div>
            )}

            {requests.map((req) => (
                <div
                    key={req.id}
                    className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm dark:border-zinc-800/80 dark:bg-[#0a1224]"
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
                        {readOnly && req.status === "APPROVED" ? (
                            req.prospectId ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    Client Connected
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                                    Awaiting Sign-up
                                </span>
                            )
                        ) : readOnly ? (
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
                                        className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
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

                    {/* Handoff guidance + resend for approved awaiting requests */}
                    {readOnly && req.status === "APPROVED" && !req.prospectId && (
                        <div className="mt-4 rounded-lg border border-dashed border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-900/10">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                        Invite sent to {req.prospectEmail}. They&apos;ll be linked automatically when they sign up.
                                    </p>
                                    {req.inviteLastSentAt && (
                                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                            Last sent {dayjs(req.inviteLastSentAt).fromNow()}
                                            {req.inviteSendCount > 1 && ` · sent ${req.inviteSendCount} times`}
                                        </p>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleResend(req.id)}
                                    disabled={resendingId !== null}
                                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:bg-zinc-900 dark:text-amber-400 dark:hover:bg-zinc-800"
                                >
                                    {resendingId === req.id ? "Sending..." : "Resend Invite"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
