"use client";

import { useState, useTransition, useRef } from "react";
import { markContacted, scheduleConsultation, updateConsultationStage, bypassPipelineAndActivate, activateClient, goBackStage, declineRequest } from "@/app/actions/coaching-requests";
import { sendIntakePacket, sendFormsForSignature } from "@/app/actions/intake";
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
    existingMeeting?: { meetingLink: string | null; scheduledTime: string | null; notes: string | null } | null;
    activeDocuments?: { id: string; title: string; type: string }[];
    intakePacketSentAt?: string | null;
    coachNotes?: string | null;
};

// ── Stage prev-step map (iOS match) ──────────────────────────────────────────
const PREV_STAGE: Record<string, string> = {
    CONSULTATION_SCHEDULED: "PENDING",
    CONSULTATION_DONE: "PENDING",
    INTAKE_SENT: "CONSULTATION_SCHEDULED",
    INTAKE_SUBMITTED: "CONSULTATION_SCHEDULED",
    FORMS_SENT: "INTAKE_SUBMITTED",
    FORMS_SIGNED: "INTAKE_SUBMITTED",
    ACTIVE: "INTAKE_SUBMITTED",
};

function stageName(stage: string): string {
    const map: Record<string, string> = {
        PENDING: "Pending",
        CONSULTATION_SCHEDULED: "Contacted",
        CONSULTATION_DONE: "Contacted",
        INTAKE_SENT: "Contacted",
        INTAKE_SUBMITTED: "Intake",
        FORMS_SENT: "Intake",
        FORMS_SIGNED: "Intake",
        ACTIVE: "Active",
    };
    return map[stage] ?? stage.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

export function LeadActions({
    requestId, status, prospectId, prospectName, consultationStage,
    consultationDate, formsSignedAt, prospectEmailAddr, existingMeeting,
    activeDocuments, intakePacketSentAt, coachNotes,
}: LeadActionsProps) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const router = useRouter();

    // Coach notes auto-save
    const [localNotes, setLocalNotes] = useState(coachNotes ?? "");
    const [notesSaveState, setNotesSaveState] = useState<"idle" | "saving" | "saved">("idle");
    const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Bypass pipeline
    const [confirmBypass, setConfirmBypass] = useState(false);

    // Mark contacted confirm (iOS sends intake optionally)
    const [showContactedConfirm, setShowContactedConfirm] = useState(false);

    // Decline confirm
    const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);

    // Back step confirm
    const [showBackConfirm, setShowBackConfirm] = useState(false);

    function handleNotesBlur() {
        if (localNotes === (coachNotes ?? "")) return;
        setNotesSaveState("saving");
        if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
        fetch(`/api/coach/leads/${requestId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coachNotes: localNotes }),
        }).then(() => {
            setNotesSaveState("saved");
            notesTimerRef.current = setTimeout(() => setNotesSaveState("idle"), 2500);
        }).catch(() => setNotesSaveState("idle"));
    }

    function run(action: () => Promise<unknown>, onSuccess?: string) {
        setError(null);
        setSuccessMsg(null);
        startTransition(async () => {
            try {
                const result = await action();
                if (onSuccess) setSuccessMsg(onSuccess);
                // Handle result.message for bypass
                if (result && typeof result === "object" && "success" in result) {
                    const r = result as { success: boolean; message?: string };
                    if (r.success) {
                        setSuccessMsg(r.message ?? onSuccess ?? "Done.");
                    } else {
                        setError(r.message ?? "Something went wrong.");
                        return;
                    }
                }
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong");
            }
        });
    }

    const stage = consultationStage;
    const canGoBack = !!PREV_STAGE[stage];
    const isActive = stage === "ACTIVE";
    const isDeclined = stage === "DECLINED" || status === "DECLINED" || status === "REJECTED";
    // Bypass is available from any non-terminal stage — the whole point is to skip remaining steps
    const bypassEligible = !isActive && !isDeclined;

    return (
        <div className="space-y-4">
            {/* ── Error banner ── */}
            {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0 mt-0.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    <p className="text-sm text-red-300">{error}</p>
                </div>
            )}

            {/* ── Success banner ── */}
            {successMsg && (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0 mt-0.5"><path d="M20 6 9 17l-5-5"/></svg>
                    <p className="text-sm text-emerald-300">{successMsg}</p>
                </div>
            )}

            {/* ── Coach Notes (private, auto-save) ── */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label htmlFor="coachNotesTA" className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Coach Notes
                    </label>
                    {notesSaveState === "saving" && (
                        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-400" />
                            Saving…
                        </span>
                    )}
                    {notesSaveState === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
                </div>
                <textarea
                    id="coachNotesTA"
                    rows={3}
                    value={localNotes}
                    onChange={(e) => setLocalNotes(e.target.value)}
                    onBlur={handleNotesBlur}
                    placeholder="Add private notes…"
                    className="w-full rounded-lg border-0 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                    style={{ fontSize: "max(1rem, 16px)", minHeight: "72px" }}
                />
            </div>

            {/* ── Primary CTA (stage-based, iOS match) ── */}
            {stage === "PENDING" && !showContactedConfirm && (
                <ActionButton
                    icon={<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.35 2 2 0 0 1 3.68 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.66a16 16 0 0 0 6 6l1.02-1.02a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>}
                    label="Mark as Contacted"
                    variant="secondary"
                    loading={pending}
                    onClick={() => setShowContactedConfirm(true)}
                />
            )}

            {/* Contacted confirm dialog (iOS match) */}
            {stage === "PENDING" && showContactedConfirm && (
                <div className="space-y-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-4">
                    <p className="text-sm text-zinc-300">Send intake form to prospect?</p>
                    <p className="text-sm text-zinc-400">Optionally send the intake form so the prospect can fill it out before your meeting.</p>
                    <div className="flex flex-col gap-2">
                        <button
                            disabled={pending}
                            onClick={() => {
                                run(async () => {
                                    await markContacted(requestId);
                                    try { await sendIntakePacket({ requestId, documentIds: (activeDocuments ?? []).map(d => d.id) }); } catch {}
                                }, "Marked as contacted. Intake form sent.");
                                setShowContactedConfirm(false);
                            }}
                            className="sf-button-primary w-full disabled:opacity-50"
                            style={{ minHeight: "48px" }}
                        >
                            Send Intake &amp; Mark Contacted
                        </button>
                        <button
                            disabled={pending}
                            onClick={() => {
                                run(() => markContacted(requestId), "Marked as contacted.");
                                setShowContactedConfirm(false);
                            }}
                            className="sf-button-secondary w-full disabled:opacity-50"
                            style={{ minHeight: "48px" }}
                        >
                            Just Mark Contacted
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowContactedConfirm(false)}
                            className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Contacted/Consultation stage — open intake form */}
            {(stage === "CONSULTATION_SCHEDULED" || stage === "CONSULTATION_DONE" || stage === "INTAKE_SENT") && (
                <ActionButton
                    icon={<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>}
                    label="Open Intake Form"
                    variant="secondary"
                    loading={pending}
                    href={`/coach/leads/${requestId}/review`}
                />
            )}

            {/* Intake submitted — Activate */}
            {(stage === "INTAKE_SUBMITTED" || stage === "FORMS_SENT" || stage === "FORMS_SIGNED") && (
                <ActivateButton requestId={requestId} prospectName={prospectName} prospectEmailAddr={prospectEmailAddr} formsSignedAt={formsSignedAt} />
            )}

            {/* Active — info card */}
            {isActive && (
                <InfoCard
                    icon={<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                    color="emerald"
                    text={prospectId
                        ? "Client is active and on your roster."
                        : "Lead is activated. They'll appear on your roster once they create their Steadfast account."}
                />
            )}

            {/* Declined — info card */}
            {isDeclined && (
                <InfoCard
                    icon={<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>}
                    color="zinc"
                    text="This lead is closed."
                />
            )}

            {/* ── Decline button (iOS match) ── */}
            {!isDeclined && !isActive && (
                <>
                    {!showDeclineConfirm ? (
                        <button
                            disabled={pending}
                            onClick={() => setShowDeclineConfirm(true)}
                            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-semibold text-red-400/85 ring-1 ring-white/[0.08] transition-colors hover:bg-red-500/[0.06] disabled:opacity-50"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                            Decline
                        </button>
                    ) : (
                        <div className="space-y-3 rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4">
                            <p className="text-sm text-zinc-300">
                                Decline <strong className="text-zinc-100">{prospectName}</strong>? This will mark the lead as inactive.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    disabled={pending}
                                    onClick={() => {
                                        run(() => declineRequest(requestId), "Lead marked as inactive.");
                                        setShowDeclineConfirm(false);
                                    }}
                                    className="sf-button-danger disabled:opacity-50"
                                    style={{ minHeight: "44px" }}
                                >
                                    Decline Lead
                                </button>
                                <button type="button" onClick={() => setShowDeclineConfirm(false)} className="sf-button-ghost" style={{ minHeight: "44px" }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Back a Step (iOS match) ── */}
            {canGoBack && !isActive && (
                <>
                    {!showBackConfirm ? (
                        <button
                            disabled={pending}
                            onClick={() => setShowBackConfirm(true)}
                            className="block w-full text-center text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-300 disabled:opacity-50"
                        >
                            Back a Step
                        </button>
                    ) : (
                        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                            <p className="text-sm text-zinc-300">
                                Move back to <strong className="text-zinc-100">{stageName(PREV_STAGE[stage])}</strong>?
                            </p>
                            <div className="flex gap-2">
                                <button
                                    disabled={pending}
                                    onClick={() => {
                                        run(() => goBackStage(requestId), `Stage updated to ${stageName(PREV_STAGE[stage])}.`);
                                        setShowBackConfirm(false);
                                    }}
                                    className="sf-button-secondary disabled:opacity-50"
                                    style={{ minHeight: "44px" }}
                                >
                                    Move to {stageName(PREV_STAGE[stage])}
                                </button>
                                <button type="button" onClick={() => setShowBackConfirm(false)} className="sf-button-ghost" style={{ minHeight: "44px" }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Bypass Pipeline (web exclusive, kept) ── */}
            {bypassEligible && (
                <div className="border-t border-white/[0.06] pt-4">
                    {!confirmBypass ? (
                        <button
                            disabled={pending}
                            onClick={() => setConfirmBypass(true)}
                            className="w-full py-3 rounded-xl text-sm font-semibold text-amber-400 ring-1 ring-white/[0.06] transition-colors hover:bg-amber-500/[0.06] disabled:opacity-50"
                        >
                            Bypass Pipeline — Activate Directly
                        </button>
                    ) : (
                        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                            <p className="text-sm text-amber-300">
                                Are you sure? This will skip intake forms and add <strong>{prospectName}</strong> directly to your active client roster.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    disabled={pending}
                                    onClick={() => {
                                        run(() => bypassPipelineAndActivate({ requestId }), "Client activated.");
                                        setConfirmBypass(false);
                                    }}
                                    className="sf-button-primary disabled:opacity-50"
                                    style={{ minHeight: "44px" }}
                                >
                                    Yes, Activate Now
                                </button>
                                <button type="button" onClick={() => setConfirmBypass(false)} className="sf-button-ghost" style={{ minHeight: "44px" }}>
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

// ── Reusable Action Button ──────────────────────────────────────────────────
function ActionButton({ icon, label, variant, loading, onClick, href }: {
    icon: React.ReactNode;
    label: string;
    variant: "primary" | "secondary";
    loading?: boolean;
    onClick?: () => void;
    href?: string;
}) {
    const cls = variant === "primary"
        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-[0_8px_16px_rgba(37,99,235,0.3)]"
        : "bg-white/[0.04] text-zinc-200 ring-1 ring-white/[0.08] hover:bg-white/[0.06]";

    const inner = (
        <span className="flex items-center justify-center gap-2.5">
            {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : icon}
            <span className="text-sm font-semibold">{loading ? `${label}…` : label}</span>
        </span>
    );

    if (href) {
        return (
            <Link
                href={href}
                className={`flex w-full items-center justify-center rounded-xl py-3.5 transition-all ${cls}`}
                style={{ minHeight: "52px" }}
            >
                {inner}
            </Link>
        );
    }

    return (
        <button
            disabled={loading}
            onClick={onClick}
            className={`w-full rounded-xl py-3.5 transition-all disabled:opacity-50 ${cls}`}
            style={{ minHeight: "52px" }}
        >
            {inner}
        </button>
    );
}

// ── Activate Client Button (gradient, iOS style) ────────────────────────────
function ActivateButton({ requestId, prospectName, prospectEmailAddr, formsSignedAt }: {
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

    if (step === "success" && result) {
        return (
            <div role="status" className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    {prospectName} is now an active client!
                </p>
                {result.path === "existing_account" && result.clientId && (
                    <Link href={`/coach/clients/${result.clientId}`} className="block text-sm text-blue-400 hover:underline">
                        View {prospectName}&apos;s dashboard →
                    </Link>
                )}
                {result.path === "invite_sent" && result.email && (
                    <p className="text-sm text-zinc-400">
                        Invite sent to <strong className="text-zinc-200">{result.email}</strong> — they&apos;ll appear once they sign up.
                    </p>
                )}
                <Link href="/coach/leads" className="block text-sm text-zinc-400 hover:text-zinc-200">← Back to all leads</Link>
            </div>
        );
    }

    if (step === "error") {
        return (
            <div className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0 mt-0.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    <p className="text-sm text-red-300">{errorMsg}</p>
                </div>
                <button onClick={() => { setStep("idle"); setErrorMsg(null); }} className="sf-button-secondary w-full disabled:opacity-50" style={{ minHeight: "48px" }}>
                    Try Again
                </button>
            </div>
        );
    }

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
                    className="w-full rounded-xl py-4 text-base font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-[0_8px_16px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_8px_24px_rgba(37,99,235,0.5)] disabled:opacity-50"
                    style={{ minHeight: "56px" }}
                >
                    <span className="flex items-center justify-center gap-2">
                        {pending ? (
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                        )}
                        {pending ? "Activating…" : "Activate Client"}
                    </span>
                </button>
            )}

            {step === "confirm" && (
                <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
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
                            className="sf-button-primary disabled:opacity-50"
                            style={{ minHeight: "48px" }}
                        >
                            {pending ? "Activating..." : "Yes, Activate"}
                        </button>
                        <button type="button" onClick={() => setStep("idle")} className="sf-button-ghost" style={{ minHeight: "48px" }}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Info Card (iOS match) ───────────────────────────────────────────────────
function InfoCard({ icon, color, text }: { icon: React.ReactNode; color: "emerald" | "zinc"; text: string }) {
    const colorMap = {
        emerald: {
            bg: "bg-emerald-500/[0.06]",
            border: "border-emerald-500/15",
            icon: "text-emerald-400",
            text: "text-zinc-300",
        },
        zinc: {
            bg: "bg-zinc-500/[0.06]",
            border: "border-zinc-500/15",
            icon: "text-zinc-500",
            text: "text-zinc-400",
        },
    };
    const c = colorMap[color];

    return (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${c.bg} ${c.border}`}>
            <span className={c.icon}>{icon}</span>
            <p className={`text-sm leading-relaxed ${c.text}`}>{text}</p>
        </div>
    );
}
