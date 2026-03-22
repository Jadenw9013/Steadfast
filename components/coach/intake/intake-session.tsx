"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { saveIntakeDraft, markIntakeReadyToSend, sendFormsForSignature } from "@/app/actions/intake";
import Link from "next/link";
import type { IntakeFormSection, IntakeAnswersShape } from "@/lib/intake-form-defaults";

type Props = {
    requestId: string;
    prospectName: string;
    prospectEmail: string | null;
    prefillGoals: string | null;
    existingAnswers: Record<string, unknown> | null;
    submissionId: string | null;
    submissionStatus: string | null;
    sections: IntakeFormSection[];
};

export function IntakeSession({ requestId, prospectName, prospectEmail, prefillGoals, existingAnswers, submissionId, submissionStatus, sections }: Props) {
    // Build steps from sections + review
    const steps = [...sections.map((s) => ({ key: s.id, label: s.title })), { key: "_review", label: "Review & Send" }];
    const [step, setStep] = useState(0);

    // Initialize flat answers keyed by question ID
    const [answers, setAnswers] = useState<Record<string, string>>(() => {
        const flat: Record<string, string> = {};
        // Pre-populate from existingAnswers if in new self-describing shape
        const existing = existingAnswers as IntakeAnswersShape | null;
        if (existing?.sections) {
            for (const sec of existing.sections) {
                for (const a of sec.answers) {
                    flat[a.questionId] = a.value;
                }
            }
        } else if (existingAnswers && typeof existingAnswers === "object") {
            // Legacy flat answers — try to map by key (backwards compat)
            Object.entries(existingAnswers).forEach(([k, v]) => {
                if (typeof v === "string") flat[k] = v;
            });
        }
        return flat;
    });

    const [coachNotes, setCoachNotes] = useState(() => {
        const existing = existingAnswers as IntakeAnswersShape | null;
        return existing?._coachNotes ?? "";
    });

    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "local">("idle");
    const [error, setError] = useState<string | null>(null);
    const [sentEmail, setSentEmail] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [fontSize, setFontSize] = useState<"normal" | "large">("normal");
    const [showRestoreBanner, setShowRestoreBanner] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const localKey = `intake-draft-${requestId}`;
    const fontKey = `intake-font-size-${requestId}`;

    // Restore font preference
    useEffect(() => {
        try {
            const saved = localStorage.getItem(fontKey);
            if (saved === "large") setFontSize("large");
        } catch { /* */ }
    }, [fontKey]);

    // Check for local draft on mount
    useEffect(() => {
        try {
            const local = localStorage.getItem(localKey);
            if (local) {
                const parsed = JSON.parse(local);
                if (parsed._savedAt) setShowRestoreBanner(true);
            }
        } catch { /* */ }
    }, [localKey]);

    const restoreLocal = () => {
        try {
            const local = localStorage.getItem(localKey);
            if (local) {
                const parsed = JSON.parse(local);
                if (parsed.answers) setAnswers(parsed.answers);
                if (parsed.coachNotes) setCoachNotes(parsed.coachNotes);
            }
        } catch { /* */ }
        setShowRestoreBanner(false);
    };

    const dismissBanner = () => setShowRestoreBanner(false);

    /** Build the self-describing answers shape for storage */
    const buildAnswersShape = useCallback((): IntakeAnswersShape => ({
        sections: sections.map((sec) => ({
            sectionId: sec.id,
            sectionTitle: sec.title,
            answers: sec.questions.map((q) => ({
                questionId: q.id,
                questionLabel: q.label,
                value: answers[q.id] ?? "",
            })),
        })),
        _coachNotes: coachNotes,
        _savedAt: Date.now(),
    }), [sections, answers, coachNotes]);

    // Auto-save debounced
    const doSave = useCallback(async () => {
        setSaveStatus("saving");
        try {
            const shape = buildAnswersShape();
            await saveIntakeDraft({ requestId, answers: shape as unknown as Record<string, unknown> });
            setSaveStatus("saved");
            try { localStorage.removeItem(localKey); } catch { /* */ }
        } catch {
            try {
                localStorage.setItem(localKey, JSON.stringify({ answers, coachNotes, _savedAt: Date.now() }));
            } catch { /* */ }
            setSaveStatus("local");
        }
    }, [requestId, localKey, buildAnswersShape, answers, coachNotes]);

    const scheduleAutoSave = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => doSave(), 800);
    }, [doSave]);

    const set = (questionId: string, value: string) => {
        setAnswers((prev) => {
            const next = { ...prev, [questionId]: value };
            return next;
        });
        scheduleAutoSave();
    };

    const setNotes = (value: string) => {
        setCoachNotes(value);
        scheduleAutoSave();
    };

    const goNext = () => setStep((s) => Math.min(s + 1, steps.length - 1));
    const goBack = () => setStep((s) => Math.max(s - 1, 0));

    const handleSendForSignature = async () => {
        setError(null);
        // Save the latest draft first
        const shape = buildAnswersShape();
        await saveIntakeDraft({ requestId, answers: shape as unknown as Record<string, unknown> });

        const readyResult = await markIntakeReadyToSend({ requestId, coachNotes });
        if (!readyResult.success) {
            if ("missingFields" in readyResult && readyResult.missingFields) {
                setError(`Missing required fields: ${(readyResult.missingFields as string[]).join(", ")}`);
            }
            return;
        }
        const sendResult = await sendFormsForSignature({ requestId });
        if (!sendResult.success) {
            setError(sendResult.message ?? "Failed to send forms.");
            return;
        }
        setSentEmail(sendResult.email ?? prospectEmail ?? "the client");
    };

    const toggleFontSize = () => {
        const next = fontSize === "normal" ? "large" : "normal";
        setFontSize(next);
        try { localStorage.setItem(fontKey, next); } catch { /* */ }
    };

    // If already sent
    if (sentEmail || submissionStatus === "SENT" || submissionStatus === "SIGNED") {
        return (
            <div className="space-y-6 text-center py-16">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <h1 className="text-2xl font-bold text-zinc-100">Forms Sent</h1>
                <p className="text-sm text-zinc-400 max-w-md mx-auto">
                    Forms sent to <strong className="text-zinc-200">{sentEmail ?? prospectEmail ?? "the client"}</strong>. They&apos;ll receive
                    an email with a link to review and sign.
                </p>
                <Link href={`/coach/leads/${requestId}`} className="inline-block rounded-xl bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-700 transition-all">
                    ← Back to Lead Detail
                </Link>
            </div>
        );
    }

    const textSize = fontSize === "large" ? "text-lg" : "text-base";
    const inputCls = `w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 ${textSize} text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 min-h-[48px]`;
    const labelCls = `mb-1.5 block text-sm font-medium text-zinc-400`;

    const currentSection = step < sections.length ? sections[step] : null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <Link href={`/coach/leads/${requestId}`} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">← Back to lead</Link>
                    <h1 className="text-2xl font-bold text-zinc-100 mt-1">Intake Session</h1>
                    <p className="text-sm text-zinc-500">{prospectName}</p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={toggleFontSize} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all min-h-[48px]" aria-label={`Switch to ${fontSize === "normal" ? "larger" : "normal"} text`}>
                        {fontSize === "normal" ? "A+" : "A"}
                    </button>
                    <span className={`text-xs font-medium ${saveStatus === "saving" ? "text-amber-400" : saveStatus === "saved" ? "text-emerald-400" : saveStatus === "local" ? "text-orange-400" : "text-zinc-600"}`}>
                        {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : saveStatus === "local" ? "Saved locally" : ""}
                    </span>
                </div>
            </div>

            {/* Restore banner */}
            {showRestoreBanner && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-center justify-between">
                    <p className="text-sm text-amber-300">An unsaved local draft was found. Restore it?</p>
                    <div className="flex gap-2">
                        <button onClick={restoreLocal} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-400">Restore</button>
                        <button onClick={dismissBanner} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">Dismiss</button>
                    </div>
                </div>
            )}

            {/* Step indicator */}
            <div className="flex items-center gap-2" role="navigation" aria-label="Intake form progress">
                {steps.map((s, i) => (
                    <div key={s.key} className="flex items-center gap-2 flex-1">
                        <button
                            onClick={() => setStep(i)}
                            aria-label={`Step ${i + 1} of ${steps.length}: ${s.label}`}
                            aria-current={i === step ? "step" : undefined}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all min-h-[48px] min-w-[48px] ${i < step ? "bg-emerald-500/20 text-emerald-400" : i === step ? "bg-blue-500 text-white" : "bg-zinc-800 text-zinc-600"}`}
                        >
                            {i < step ? "✓" : i + 1}
                        </button>
                        {i < steps.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-emerald-500/30" : "bg-zinc-800"}`} />}
                    </div>
                ))}
            </div>
            <p className="text-xs text-zinc-500 text-center">{steps[step].label}</p>

            {/* Dynamic sections */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6 space-y-5 transition-opacity duration-200">
                {currentSection && (
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-zinc-100">{currentSection.title}</h2>
                        {currentSection.description && (
                            <p className="text-sm text-zinc-500">{currentSection.description}</p>
                        )}
                        {currentSection.questions.map((q) => (
                            <div key={q.id}>
                                <label htmlFor={`q-${q.id}`} className={labelCls}>
                                    {q.label}{q.required ? " *" : ""}
                                </label>
                                {q.type === "long_text" ? (
                                    <textarea
                                        id={`q-${q.id}`}
                                        rows={3}
                                        value={answers[q.id] ?? ""}
                                        onChange={(e) => set(q.id, e.target.value)}
                                        className={inputCls}
                                        placeholder={q.placeholder}
                                        required={q.required}
                                        style={{ fontSize: "max(1rem, 16px)" }}
                                    />
                                ) : (
                                    <input
                                        id={`q-${q.id}`}
                                        type="text"
                                        value={answers[q.id] ?? ""}
                                        onChange={(e) => set(q.id, e.target.value)}
                                        className={inputCls}
                                        placeholder={q.placeholder}
                                        required={q.required}
                                        style={{ fontSize: "max(1rem, 16px)" }}
                                    />
                                )}
                                {q.helperText && (
                                    <p className="mt-1 text-xs text-zinc-600">{q.helperText}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Review & Send */}
                {step === steps.length - 1 && (
                    <div className="space-y-5">
                        <h2 className="text-xl font-bold text-zinc-100">Review & Send</h2>
                        <p className="text-sm text-zinc-500">Review the information below. Once sent, {prospectName} will receive an email to review and sign.</p>

                        {/* Summary card */}
                        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5 space-y-4 text-sm">
                            {sections.map((sec) => (
                                <div key={sec.id} className="space-y-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600">{sec.title}</h3>
                                    {sec.questions.map((q) => (
                                        <div key={q.id} className="flex justify-between text-zinc-400 gap-4">
                                            <span className="shrink-0">{q.label}</span>
                                            <span className="text-zinc-200 text-right">{answers[q.id] || "—"}</span>
                                        </div>
                                    ))}
                                    <hr className="border-zinc-800" />
                                </div>
                            ))}
                        </div>

                        {/* Coach notes */}
                        <div>
                            <label htmlFor="coachNotes" className={labelCls}>Coach Notes (private — not shown to client)</label>
                            <textarea id="coachNotes" rows={3} value={coachNotes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Internal notes about this client..." />
                        </div>

                        {/* Confirmation */}
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500" />
                            <span className="text-sm text-zinc-400 group-hover:text-zinc-300">I confirm this information is correct and ready to send for signature.</span>
                        </label>

                        {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>}

                        {!prospectEmail && (
                            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
                                No email on file for this prospect. Add their email on the lead detail page before sending.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
                <button
                    onClick={goBack}
                    disabled={step === 0}
                    className="rounded-xl border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed min-h-[48px]"
                >
                    ← Back
                </button>

                {step < steps.length - 1 ? (
                    <button onClick={goNext} className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 min-h-[48px]">
                        Next →
                    </button>
                ) : (
                    <button
                        disabled={!confirmed || !prospectEmail}
                        onClick={handleSendForSignature}
                        className="rounded-xl bg-blue-600 px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
                    >
                        Send for Signature
                    </button>
                )}
            </div>
        </div>
    );
}
