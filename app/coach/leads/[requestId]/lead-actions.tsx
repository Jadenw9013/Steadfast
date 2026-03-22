"use client";

import { useState, useTransition } from "react";
import { markContacted, scheduleConsultation, acceptClient, declineRequest, resendInvite, updateConsultationStage, bypassPipelineAndActivate, activateClient } from "@/app/actions/coaching-requests";
import { sendIntakePacket, resendFormsLink } from "@/app/actions/intake";
import { useRouter } from "next/navigation";
import Link from "next/link";

type LeadActionsProps = {
    requestId: string;
    status: string;
    prospectId: string | null;
    prospectName: string;
    consultationStage: string;
    consultationDate: string | null;
    formsSignedAt: string | null;
    prospectEmailAddr: string | null;
    existingMeeting?: { meetingLink: string | null; scheduledTime: Date | null; notes: string | null } | null;
    activeDocuments?: { id: string; title: string; type: string }[];
    intakePacketSentAt?: string | null;
};

export function LeadActions({ requestId, status, prospectId, prospectName, consultationStage, consultationDate, formsSignedAt, prospectEmailAddr, existingMeeting, activeDocuments, intakePacketSentAt }: LeadActionsProps) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
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

    const isAccepted = status === "ACCEPTED" || status === "APPROVED";
    const isTerminal = isAccepted || status === "DECLINED" || status === "REJECTED";
    const isAwaitingSignup = isAccepted && !prospectId;

    // Consultation date picker state
    const [consultDate, setConsultDate] = useState(consultationDate ? new Date(consultationDate).toISOString().slice(0, 16) : "");
    const [confirmBypass, setConfirmBypass] = useState(false);

    const bypassEligible = ["PENDING", "CONSULTATION_SCHEDULED", "CONSULTATION_DONE", "FORMS_SENT"].includes(consultationStage);

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

            {/* Schedule consultation form (pre-accept only) */}
            {showSchedule && !isTerminal && (
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

            {isTerminal && !isAwaitingSignup && (
                <p className="text-sm text-zinc-600">
                    This lead is {isAccepted ? "accepted — client is on your roster" : "closed"}.
                </p>
            )}

            {/* ── Pipeline Stage Actions ── */}
            {isAccepted && (
                <div className="space-y-3 border-t border-white/[0.06] pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Pipeline</p>

                    {consultationStage === "PENDING" && (
                        <div className="flex flex-col gap-3">
                            <div>
                                <label htmlFor="consultDate" className="mb-1.5 block text-sm font-medium text-zinc-400">Consultation Date & Time</label>
                                <input
                                    id="consultDate"
                                    type="datetime-local"
                                    value={consultDate}
                                    onChange={(e) => setConsultDate(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 focus:border-blue-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                                />
                            </div>
                            <button
                                disabled={pending || !consultDate}
                                onClick={() => run(() => updateConsultationStage({ requestId, stage: "CONSULTATION_SCHEDULED", consultationDate: consultDate }))}
                                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                            >
                                Schedule Consultation
                            </button>
                        </div>
                    )}

                    {consultationStage === "CONSULTATION_SCHEDULED" && (
                        <div className="space-y-2">
                            {consultationDate && (
                                <p className="text-sm text-zinc-300">
                                    📅 Scheduled:{" "}
                                    {new Date(consultationDate).toLocaleString("en-US", {
                                        month: "short", day: "numeric", year: "numeric",
                                        hour: "numeric", minute: "2-digit",
                                    })}
                                </p>
                            )}
                            <button
                                disabled={pending}
                                onClick={() => run(() => updateConsultationStage({ requestId, stage: "CONSULTATION_DONE" }))}
                                className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-50"
                            >
                                ✓ Mark Consultation Complete
                            </button>
                        </div>
                    )}

                    {consultationStage === "CONSULTATION_DONE" && (
                        <SendIntakePacketSection
                            requestId={requestId}
                            activeDocuments={activeDocuments ?? []}
                        />
                    )}

                    {consultationStage === "INTAKE_SENT" && (
                        <div className="space-y-3">
                            <p className="flex items-center gap-2 text-sm text-cyan-400">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>
                                Intake packet sent{intakePacketSentAt ? ` ${daysAgoText(intakePacketSentAt)}` : ""}
                            </p>
                            {prospectEmailAddr && (
                                <p className="text-xs text-zinc-500">Sent to {prospectEmailAddr}</p>
                            )}
                            <p className="text-xs text-zinc-600">Waiting for prospect to fill out and submit.</p>
                            <button
                                disabled={pending}
                                onClick={() => run(() => sendIntakePacket({ requestId, documentIds: [] }))}
                                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all disabled:opacity-50"
                                style={{ minHeight: "48px" }}
                            >
                                {pending ? "Resending..." : "Resend Intake Packet"}
                            </button>
                        </div>
                    )}

                    {consultationStage === "INTAKE_SUBMITTED" && (
                        <div className="space-y-3">
                            <p className="flex items-center gap-2 text-sm text-emerald-400">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                {prospectName} completed their intake forms
                            </p>
                            <Link
                                href={`/coach/leads/${requestId}/review`}
                                className="block w-full rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                                style={{ minHeight: "48px" }}
                            >
                                Review Intake →
                            </Link>
                        </div>
                    )}

                    {consultationStage === "FORMS_SENT" && (
                        <div className="space-y-3">
                            <p className="text-sm text-zinc-500">
                                Forms sent — waiting for prospect to sign.
                            </p>
                            <button
                                disabled={pending}
                                onClick={() => run(() => resendFormsLink({ requestId }))}
                                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all disabled:opacity-50"
                                style={{ minHeight: "48px" }}
                            >
                                {pending ? "Resending..." : "Resend Forms Link"}
                            </button>
                        </div>
                    )}

                    {consultationStage === "FORMS_SIGNED" && (
                        <ActivateSection
                            requestId={requestId}
                            prospectName={prospectName}
                            prospectEmailAddr={prospectEmailAddr}
                            formsSignedAt={formsSignedAt}
                        />
                    )}

                    {consultationStage === "ACTIVE" && (
                        <p className="flex items-center gap-2 text-sm text-emerald-400">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                            Active client
                        </p>
                    )}
                </div>
            )}

            {isAwaitingSignup && (
                <div className="space-y-3">
                    <p className="text-sm text-amber-400">
                        ⏳ Accepted — waiting for client to sign up.
                    </p>
                    {successMsg && (
                        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">{successMsg}</p>
                    )}
                    <button
                        disabled={pending}
                        onClick={() => {
                            setError(null);
                            setSuccessMsg(null);
                            startTransition(async () => {
                                try {
                                    const result = await resendInvite(requestId);
                                    if (result.success) {
                                        setSuccessMsg(result.message);
                                    } else {
                                        setError(result.message);
                                    }
                                    router.refresh();
                                } catch (e) {
                                    setError(e instanceof Error ? e.message : "Something went wrong");
                                }
                            });
                        }}
                        className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-300 transition-all hover:bg-blue-500/20 disabled:opacity-50"
                    >
                        Send Invite
                    </button>
                </div>
            )}

            {/* Bypass pipeline */}
            {bypassEligible && (
                <div className="border-t border-white/[0.06] pt-4">
                    {!confirmBypass ? (
                        <button
                            disabled={pending}
                            onClick={() => setConfirmBypass(true)}
                            className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-500 transition-all hover:border-zinc-500 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50"
                        >
                            Bypass Pipeline — Activate Directly
                        </button>
                    ) : (
                        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                            <p className="text-sm text-amber-300">
                                Are you sure? This will skip intake forms and add <strong>{prospectName}</strong> directly to your active client roster.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    disabled={pending}
                                    onClick={() => {
                                        setError(null);
                                        setSuccessMsg(null);
                                        startTransition(async () => {
                                            try {
                                                const result = await bypassPipelineAndActivate({ requestId });
                                                if (result.success) {
                                                    setSuccessMsg(result.message ?? "Client activated.");
                                                } else {
                                                    setError(result.message);
                                                }
                                                router.refresh();
                                            } catch (e) {
                                                setError(e instanceof Error ? e.message : "Something went wrong");
                                            }
                                        });
                                        setConfirmBypass(false);
                                    }}
                                    className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-all hover:bg-amber-400 disabled:opacity-50"
                                >
                                    Yes, Activate Now
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmBypass(false)}
                                    className="px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ActivateSection({ requestId, prospectName, prospectEmailAddr, formsSignedAt }: {
    requestId: string;
    prospectName: string;
    prospectEmailAddr: string | null;
    formsSignedAt: string | null;
}) {
    const [pending, startTransition] = useTransition();
    const [step, setStep] = useState<"idle" | "confirm" | "success" | "error">("idle");
    const [result, setResult] = useState<{ path?: string; email?: string; clientId?: string } | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const router = useRouter();

    const handleActivate = () => {
        setErrorMsg(null);
        startTransition(async () => {
            try {
                const res = await activateClient({ requestId });
                if (res.success) {
                    setResult(res as { path?: string; email?: string; clientId?: string });
                    setStep("success");
                    router.refresh();
                } else {
                    setErrorMsg((res as { message?: string }).message ?? "Something went wrong.");
                    setStep("error");
                }
            } catch (e) {
                setErrorMsg(e instanceof Error ? e.message : "Something went wrong.");
                setStep("error");
            }
        });
    };

    return (
        <div className="space-y-3">
            {formsSignedAt && (
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    Forms signed on {new Date(formsSignedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
            )}

            {step === "idle" && (
                <button
                    disabled={pending}
                    onClick={() => setStep("confirm")}
                    className="w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                    style={{ minHeight: "56px" }}
                >
                    Activate {prospectName} as a Client
                </button>
            )}

            {step === "confirm" && (
                <div
                    role="alert"
                    className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5"
                >
                    <p className="text-sm text-zinc-300 leading-relaxed">
                        This will add <strong className="text-zinc-100">{prospectName}</strong> to your active client roster.
                    </p>
                    {prospectEmailAddr && (
                        <p className="text-sm text-zinc-400">
                            A welcome email will be sent to <strong className="text-zinc-200">{prospectEmailAddr}</strong>.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button
                            autoFocus
                            disabled={pending}
                            onClick={handleActivate}
                            className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-zinc-900 transition-all hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:opacity-50"
                            style={{ minHeight: "48px" }}
                        >
                            {pending ? "Activating..." : "Yes, Activate"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setStep("idle")}
                            className="px-5 py-3 text-sm text-zinc-500 hover:text-zinc-300"
                            style={{ minHeight: "48px" }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {step === "success" && result && (
                <div role="status" className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        {prospectName} is now an active client!
                    </p>
                    {result.path === "existing_account" && result.clientId && (
                        <Link
                            href={`/coach/clients/${result.clientId}`}
                            className="block text-sm text-blue-400 hover:underline"
                        >
                            View {prospectName}&apos;s dashboard →
                        </Link>
                    )}
                    {result.path === "invite_sent" && result.email && (
                        <p className="text-sm text-zinc-400">
                            Invite sent to <strong className="text-zinc-200">{result.email}</strong> — they&apos;ll appear on your dashboard once they sign up.
                        </p>
                    )}
                    <Link href="/coach/leads" className="block text-sm text-zinc-500 hover:text-zinc-300">
                        ← Back to all leads
                    </Link>
                </div>
            )}

            {step === "error" && (
                <div className="space-y-3">
                    <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                        {errorMsg}
                    </p>
                    <button
                        disabled={pending}
                        onClick={() => { setStep("idle"); setErrorMsg(null); }}
                        className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all disabled:opacity-50"
                        style={{ minHeight: "48px" }}
                    >
                        Try Again
                    </button>
                </div>
            )}
        </div>
    );
}

function daysAgoText(dateStr: string) {
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return "today";
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
}

function SendIntakePacketSection({ requestId, activeDocuments }: { requestId: string; activeDocuments: { id: string; title: string; type: string }[] }) {
    const [pending, startTransition] = useTransition();
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set(activeDocuments.map(d => d.id)));
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggleDoc = (id: string) => {
        setSelectedDocs(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleSend = () => {
        setError(null);
        startTransition(async () => {
            try {
                const res = await sendIntakePacket({ requestId, documentIds: Array.from(selectedDocs) });
                if (res.success) {
                    setSent(true);
                } else {
                    setError((res as { message?: string }).message ?? "Failed to send.");
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to send.");
            }
        });
    };

    if (sent) {
        return (
            <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    Intake packet sent!
                </p>
                <p className="text-xs text-zinc-500">The page will refresh with the updated status.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-emerald-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                Consultation complete
            </p>

            {activeDocuments.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Include documents</p>
                    {activeDocuments.map(doc => (
                        <label key={doc.id} className="flex items-center gap-2 text-sm text-zinc-300">
                            <input
                                type="checkbox"
                                checked={selectedDocs.has(doc.id)}
                                onChange={() => toggleDoc(doc.id)}
                                className="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
                            />
                            {doc.title}
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${doc.type === "FILE" ? "bg-blue-500/10 text-blue-400" : "bg-violet-500/10 text-violet-400"}`}>
                                {doc.type === "FILE" ? "File" : "Text"}
                            </span>
                        </label>
                    ))}
                </div>
            )}

            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

            <button
                disabled={pending}
                onClick={handleSend}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                style={{ minHeight: "48px" }}
            >
                {pending ? "Sending..." : `Send Intake Packet${selectedDocs.size > 0 ? ` (${selectedDocs.size} doc${selectedDocs.size > 1 ? "s" : ""})` : ""}`}
            </button>
        </div>
    );
}
