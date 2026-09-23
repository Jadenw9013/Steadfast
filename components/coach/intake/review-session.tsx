"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { saveReviewEdits } from "@/app/actions/intake";
import { activateClient } from "@/app/actions/coaching-requests";
import { useRouter } from "next/navigation";
import Link from "next/link";

type AnswersData = {
    sections?: {
        sectionId: string;
        sectionTitle: string;
        answers: { questionId: string; label: string; value: string; required?: boolean }[];
    }[];
};

type ReviewDocument = {
    id: string;
    title: string;
    type: "TEXT" | "FILE";
    content: string | null;
    fileName: string | null;
    signature: { signatureType: "TYPED" | "DRAWN"; signatureValue: string; signedAt: string } | null;
    uploadedSignedFilePath?: string | null;
    uploadedSignedFileName?: string | null;
    uploadedSignedAt?: string | null;
    signedFileUrl?: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

// Detect Yes/No/NA-type question labels
const YES_NO_KEYWORDS = ["cleared", "consent", "agree", "doctor", "approve", "confirm"];
function isYesNoField(label: string) {
    const l = label.toLowerCase();
    return YES_NO_KEYWORDS.some(k => l.includes(k));
}

function yesNoPill(value: string) {
    const v = value.trim().toLowerCase();
    if (["yes", "yea", "yeah"].includes(v))
        return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-0.5 text-sm text-emerald-400">✓ Yes</span>;
    if (["no", "nope"].includes(v))
        return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-0.5 text-sm text-red-400">✗ No</span>;
    if (["n/a", "na"].includes(v))
        return <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700/50 px-3 py-0.5 text-sm text-zinc-400">N/A</span>;
    return null;
}

export function ReviewSession({
    packetId,
    requestId,
    prospectName,
    answers: initialAnswers,
    coachNotes: initialCoachNotes,
    documents,
    consultationStage,
    prospectEmailAddr,
    submittedAt,
}: {
    packetId: string;
    requestId: string;
    prospectName: string;
    answers: AnswersData | null;
    coachNotes: string;
    documents: ReviewDocument[];
    consultationStage: string;
    prospectEmailAddr?: string | null;
    submittedAt?: string | null;
}) {
    const router = useRouter();
    const [answers, setAnswers] = useState<AnswersData>(initialAnswers ?? { sections: [] });
    const [coachNotes, setCoachNotes] = useState(initialCoachNotes);
    const [pending, startTransition] = useTransition();
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState<string | null>(null);
    const [activateStep, setActivateStep] = useState<"idle" | "confirm" | "success" | "error">("idle");
    // T-978: activateClient's return shape. onRoster/clientId/outcome replace
    // the old path union ("existing_account" | "invite_sent"), which no
    // longer exists. A second reader of the pre-T-978 shape the frozen spec's
    // file list did not name (lead-actions.tsx was the only one listed) —
    // fixed identically here so this screen does not silently stop showing
    // the dashboard link / invite-sent line for every successful activation.
    const [activateResult, setActivateResult] = useState<{
        outcome?: string;
        onRoster?: boolean;
        clientId?: string | null;
        email?: string | null;
        message?: string;
    } | null>(null);
    const [missingFields, setMissingFields] = useState<{ questionId: string; label: string; sectionTitle: string }[]>([]);
    const [highlightedField, setHighlightedField] = useState<string | null>(null);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);
    const fadeTimer = useRef<ReturnType<typeof setTimeout>>(null);

    // --- Save logic (preserved exactly) ---
    const debouncedSave = useCallback((updatedAnswers?: AnswersData, updatedNotes?: string) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setSaveState("saving");
        saveTimer.current = setTimeout(() => {
            startTransition(async () => {
                try {
                    await saveReviewEdits({
                        packetId,
                        formAnswers: updatedAnswers as Record<string, unknown> | undefined,
                        coachNotes: updatedNotes,
                    });
                    setSaveState("saved");
                    setError(null);
                    if (fadeTimer.current) clearTimeout(fadeTimer.current);
                    fadeTimer.current = setTimeout(() => setSaveState("idle"), 2000);
                } catch {
                    setSaveState("error");
                    setError("Auto-save failed.");
                }
            });
        }, 1000);
    }, [packetId, startTransition]);

    const commitAnswer = useCallback((sectionIdx: number, answerIdx: number, value: string) => {
        setAnswers(prev => {
            const updated = { ...prev, sections: [...(prev.sections ?? [])] };
            if (updated.sections) {
                updated.sections[sectionIdx] = {
                    ...updated.sections[sectionIdx],
                    answers: [...updated.sections[sectionIdx].answers],
                };
                updated.sections[sectionIdx].answers[answerIdx] = {
                    ...updated.sections[sectionIdx].answers[answerIdx],
                    value,
                };
            }
            debouncedSave(updated, undefined);
            return updated;
        });
    }, [debouncedSave]);

    const updateNotes = useCallback((value: string) => {
        setCoachNotes(value);
        debouncedSave(undefined, value);
    }, [debouncedSave]);

    // --- Validation ---
    const computeMissing = useCallback(() => {
        const missing: { questionId: string; label: string; sectionTitle: string }[] = [];
        for (const section of answers.sections ?? []) {
            for (const a of section.answers) {
                if (a.required && !a.value?.trim()) {
                    missing.push({ questionId: a.questionId, label: a.label, sectionTitle: section.sectionTitle });
                }
            }
        }
        return missing;
    }, [answers]);

    // Shown only after a failed activate attempt; recomputed each render so the
    // checklist updates live as the coach fills fields (empty = banner hidden).
    const visibleMissingFields = missingFields.length > 0 ? computeMissing() : [];

    const handleActivateClick = () => {
        setError(null);
        const missing = computeMissing();
        if (missing.length > 0) {
            setMissingFields(missing);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        setMissingFields([]);
        startTransition(async () => {
            try {
                await saveReviewEdits({ packetId, formAnswers: answers as Record<string, unknown>, coachNotes });
                setActivateStep("confirm");
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to save.");
            }
        });
    };

    const handleActivateConfirm = () => {
        setError(null);
        startTransition(async () => {
            try {
                const res = await activateClient({ requestId });
                if (res.success) {
                    setActivateResult(res);
                    setActivateStep("success");
                    router.refresh();
                } else {
                    setError((res as { message?: string }).message ?? "Failed to activate.");
                    setActivateStep("error");
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to activate.");
                setActivateStep("error");
            }
        });
    };

    // --- Click-to-edit helpers ---
    const startEdit = (questionId: string, currentValue: string) => {
        setEditingField(questionId);
        setEditDraft(currentValue);
        if (highlightedField === questionId) setHighlightedField(null);
    };

    const cancelEdit = () => {
        setEditingField(null);
        setEditDraft("");
    };

    const finishEdit = (sectionIdx: number, answerIdx: number) => {
        commitAnswer(sectionIdx, answerIdx, editDraft);
        setEditingField(null);
        setEditDraft("");
    };

    const scrollToField = (questionId: string) => {
        const el = document.getElementById(`row-${questionId}`);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlightedField(questionId);
        }
    };

    // --- Computed ---
    const canFinalize = consultationStage === "INTAKE_SUBMITTED";
    const totalSections = answers.sections?.length ?? 0;
    const completeSections = (answers.sections ?? []).filter(s => s.answers.every(a => !a.required || a.value?.trim())).length;
    const missingCount = computeMissing().length;
    const firstName = prospectName.split(" ")[0];

    const saveIndicator = (
        <span role="status" aria-live="polite" className="text-xs">
            {saveState === "saving" && <span className="text-zinc-500">Saving...</span>}
            {saveState === "saved" && <span className="text-emerald-400">Saved</span>}
            {saveState === "error" && <span className="text-amber-400">Save failed</span>}
        </span>
    );

    // --- Success state ---
    if (activateStep === "success" && activateResult) {
        return (
            <div className="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    {prospectName} is now an active client!
                </p>
                {activateResult.onRoster && activateResult.clientId && (
                    <Link href={`/coach/clients/${activateResult.clientId}`} className="block text-sm text-blue-400 hover:underline">
                        View {prospectName}&apos;s dashboard →
                    </Link>
                )}
                {(activateResult.outcome === "invite_emailed" || activateResult.outcome === "invite_created_email_failed") && activateResult.message && (
                    // T-978 review round 1, parity gap 3: this used to be a hard-coded
                    // "Invite sent to X" regardless of outcome, so a post-commit email
                    // failure was reported as a success. Render the service's own
                    // message, which distinguishes the two.
                    <p className="text-sm text-zinc-400">{activateResult.message}</p>
                )}
                <Link href="/coach/leads" className="block text-sm text-zinc-500 hover:text-zinc-300">
                    ← Back to all leads
                </Link>
            </div>
        );
    }

    // --- Sidebar content (reused in desktop sidebar + mobile inline) ---
    const sidebarContent = (
        <>
            {/* Prospect info */}
            <div className="mb-6">
                <p id="prospect-name" className="text-lg font-semibold text-zinc-100">{prospectName}</p>
                {submittedAt && (
                    <p className="text-sm text-zinc-500 mt-1">
                        Submitted {new Date(submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                )}
            </div>

            {/* Completion summary */}
            <div className="mb-6">
                {missingCount === 0 ? (
                    <p className="text-sm text-emerald-400">✓ {totalSections} sections complete</p>
                ) : (
                    <p className="text-sm text-amber-400">⚠ {missingCount} field{missingCount !== 1 ? "s" : ""} need{missingCount === 1 ? "s" : ""} attention</p>
                )}
            </div>

            {/* Documents summary */}
            {documents.length > 0 && (
                <div className="mb-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Documents</p>
                    <div className="space-y-2">
                        {documents.map(doc => (
                            <div key={doc.id} className="flex items-center justify-between gap-2">
                                <span className="text-sm text-zinc-300 truncate">{doc.title}</span>
                                {doc.type === "FILE" ? (
                                    doc.uploadedSignedFilePath ? (
                                        <span className="shrink-0 text-xs text-emerald-400">✓ Signed</span>
                                    ) : doc.signature ? (
                                        <span className="shrink-0 text-xs text-emerald-400">✓ Signed</span>
                                    ) : (
                                        <span className="shrink-0 text-xs text-amber-400">⚠ Awaiting upload</span>
                                    )
                                ) : doc.signature ? (
                                    <span className="shrink-0 text-xs text-emerald-400">✓ Signed</span>
                                ) : (
                                    <span className="shrink-0 text-xs text-red-400">✗ Not signed</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Activate button */}
            {canFinalize && activateStep === "idle" && (
                <button
                    disabled={pending}
                    onClick={handleActivateClick}
                    aria-describedby="prospect-name"
                    className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                    style={{ minHeight: "52px" }}
                >
                    {pending ? "Saving..." : `Activate ${firstName} as a Client`}
                </button>
            )}

            {/* Confirm activation */}
            {activateStep === "confirm" && (
                <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
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
                            onClick={handleActivateConfirm}
                            className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-zinc-900 transition-all hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50"
                            style={{ minHeight: "48px" }}
                        >
                            {pending ? "Activating..." : "Yes, Activate"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setActivateStep("idle")}
                            className="px-5 py-3 text-sm text-zinc-500 hover:text-zinc-300"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Error in sidebar */}
            {activateStep === "error" && error && (
                <div className="space-y-2">
                    <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>
                    <button
                        onClick={() => { setActivateStep("idle"); setError(null); }}
                        className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all"
                    >
                        Try Again
                    </button>
                </div>
            )}
        </>
    );

    return (
        <div>
            {/* Sticky header */}
            <div className="sticky top-0 z-10 -mx-4 border-b border-white/[0.06] bg-[#0a0f1e]/90 backdrop-blur px-4 py-3 mb-6 sm:-mx-0">
                {/* Desktop header */}
                <div className="hidden md:flex items-center justify-between gap-4">
                    <Link href={`/coach/leads/${requestId}`} className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                        ← Back to Lead
                    </Link>
                    <p className="text-sm font-semibold text-zinc-100 truncate">Review: {prospectName}</p>
                    <div className="shrink-0">{saveIndicator}</div>
                </div>
                {/* Mobile header */}
                <div className="md:hidden space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <Link href={`/coach/leads/${requestId}`} className="text-sm text-zinc-500 hover:text-zinc-300">← Back</Link>
                        <span className="text-sm font-semibold text-zinc-100 truncate">{prospectName}</span>
                    </div>
                    <div>{saveIndicator}</div>
                </div>
            </div>

            {/* Error */}
            {error && activateStep !== "error" && (
                <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-3 text-sm text-red-400 mb-6">
                    {error}
                </div>
            )}

            {/* Missing fields checklist */}
            {visibleMissingFields.length > 0 && (
                <div role="alert" className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-5 py-4 mb-6">
                    <p className="text-sm font-semibold text-amber-300 mb-3">Complete these fields before activating</p>
                    <ul className="space-y-1.5">
                        {visibleMissingFields.map(f => (
                            <li key={f.questionId}>
                                <button
                                    type="button"
                                    onClick={() => scrollToField(f.questionId)}
                                    className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors"
                                >
                                    <span className="text-amber-400">→</span>
                                    {f.label}
                                    <span className="text-zinc-500">· {f.sectionTitle}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Mobile: completion summary */}
            <div className="lg:hidden mb-6">
                {missingCount === 0 ? (
                    <p className="text-sm text-emerald-400">✓ {totalSections} sections complete</p>
                ) : (
                    <p className="text-sm text-amber-400">⚠ {missingCount} field{missingCount !== 1 ? "s" : ""} need{missingCount === 1 ? "s" : ""} attention</p>
                )}
            </div>

            {/* Two-column layout */}
            <div className="lg:flex lg:gap-8">
                {/* Left column — answers + notes + documents */}
                <div className="lg:w-[65%] min-w-0">
                    {/* Edit hint */}
                    <p className="flex items-center gap-1.5 text-xs text-zinc-500 mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                        Click any answer to edit · Changes auto-save
                    </p>

                    {/* Answer sections — two-tone rows */}
                    {(answers.sections ?? []).map((section, sIdx) => (
                        <div key={section.sectionId}>
                            <h2 className={`text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4 ${sIdx > 0 ? "mt-10" : ""}`}>
                                {section.sectionTitle}
                            </h2>
                            <div>
                                {section.answers.map((a, aIdx) => {
                                    const isEditing = editingField === a.questionId;
                                    const isHighlighted = highlightedField === a.questionId;
                                    const isEmpty = !a.value?.trim();
                                    const isRequired = !!a.required;
                                    const showPill = isYesNoField(a.label) && !isEmpty;
                                    const pill = showPill ? yesNoPill(a.value) : null;
                                    const isLast = aIdx === section.answers.length - 1;

                                    return (
                                        <div
                                            key={a.questionId}
                                            id={`row-${a.questionId}`}
                                            className={`flex gap-4 py-4 transition-all duration-150 ${
                                                !isLast ? "border-b border-white/[0.04]" : ""
                                            } ${isHighlighted ? "ring-2 ring-amber-400/50 rounded-lg" : ""}`}
                                        >
                                            {/* Left — label */}
                                            <div className="w-[40%] shrink-0 pr-4">
                                                <p id={`label-${a.questionId}`} className="text-sm text-zinc-500 font-medium leading-snug">
                                                    {a.label}
                                                    {isRequired && <span className="text-red-400 ml-1">*</span>}
                                                </p>
                                            </div>

                                            {/* Right — answer */}
                                            <div className="flex-1 min-w-0">
                                                {isEditing ? (
                                                    <textarea
                                                        autoFocus
                                                        aria-label={`Edit ${a.label}`}
                                                        value={editDraft}
                                                        onChange={e => setEditDraft(e.target.value)}
                                                        onBlur={() => finishEdit(sIdx, aIdx)}
                                                        onKeyDown={e => {
                                                            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                                                        }}
                                                        className="w-full rounded-lg border border-blue-500/50 bg-zinc-800/60 px-3 py-2 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-y"
                                                        rows={editDraft.length > 100 ? 4 : 2}
                                                        style={{ fontSize: "max(1rem, 16px)", minHeight: "48px" }}
                                                    />
                                                ) : (
                                                    <div
                                                        role="button"
                                                        tabIndex={0}
                                                        aria-labelledby={`label-${a.questionId}`}
                                                        onClick={() => startEdit(a.questionId, a.value)}
                                                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(a.questionId, a.value); } }}
                                                        className="group cursor-pointer rounded-lg px-2 py-1 -mx-2 transition-colors duration-150 hover:bg-zinc-800/50 border border-transparent hover:border-zinc-700/30"
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            {pill ? (
                                                                pill
                                                            ) : isEmpty ? (
                                                                isRequired ? (
                                                                    <span className="text-sm italic text-amber-400">Required</span>
                                                                ) : (
                                                                    <span className="text-base text-zinc-600">—</span>
                                                                )
                                                            ) : (
                                                                <span className="text-base text-zinc-100 leading-relaxed whitespace-pre-wrap">{a.value}</span>
                                                            )}
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-700 group-hover:text-zinc-400 transition-colors"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {(answers.sections ?? []).length === 0 && (
                        <p className="text-sm text-zinc-500">No questionnaire answers submitted.</p>
                    )}

                    {/* Coach notes */}
                    <div className="mt-10">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Coach Notes</h2>
                        <p className="text-xs text-zinc-600 mb-3">Private — not shown to the client</p>
                        <textarea
                            value={coachNotes}
                            onChange={e => updateNotes(e.target.value)}
                            aria-label="Coach notes — private"
                            placeholder="Add notes from your consultation..."
                            className="w-full rounded-xl border border-zinc-700/40 bg-zinc-800/30 px-4 py-3 text-base text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none resize-y"
                            rows={4}
                            style={{ fontSize: "max(1rem, 16px)", minHeight: "100px" }}
                        />
                        {!canFinalize && (
                            <div className="mt-2">{saveIndicator}</div>
                        )}
                    </div>

                    {/* Documents */}
                    {documents.length > 0 && (
                        <div className="mt-10">
                            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-6">Documents</h2>
                            <div className="space-y-6">
                                {documents.map(doc => (
                                    <div key={doc.id} className="space-y-2 pb-6 border-b border-white/[0.04] last:border-0 last:pb-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-base font-semibold text-zinc-100">{doc.title}</p>
                                            <span className="shrink-0 text-xs text-zinc-600">Read only</span>
                                        </div>

                                        {doc.type === "FILE" ? (
                                            /* FILE type document */
                                            doc.uploadedSignedFilePath ? (
                                                <div className="space-y-2">
                                                    <p className="text-sm text-emerald-400">
                                                        ✓ Signed copy uploaded {doc.uploadedSignedAt ? new Date(doc.uploadedSignedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                                                    </p>
                                                    <p className="flex items-center gap-1.5 text-sm text-zinc-300">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                                                        {doc.uploadedSignedFileName}
                                                    </p>
                                                    {doc.signedFileUrl && (
                                                        <a
                                                            href={doc.signedFileUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-block text-sm text-blue-400 hover:underline"
                                                        >
                                                            Download signed copy →
                                                        </a>
                                                    )}
                                                </div>
                                            ) : doc.signature ? (
                                                <div className="space-y-2">
                                                    <p className="text-sm text-emerald-400">
                                                        ✓ Signed {new Date(doc.signature.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {new Date(doc.signature.signedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                    </p>
                                                    {doc.signature.signatureType === "TYPED" ? (
                                                        <p className="text-xl italic text-zinc-300" style={{ fontFamily: "'Dancing Script', cursive, serif" }}>
                                                            — {doc.signature.signatureValue}
                                                        </p>
                                                    ) : (
                                                        <img
                                                            src={doc.signature.signatureValue}
                                                            alt={`Signature for ${doc.title}`}
                                                            className="max-h-[60px] object-contain opacity-70"
                                                        />
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    <p className="text-sm text-amber-400">⚠ Awaiting signed copy</p>
                                                    <p className="text-xs text-zinc-500">The client needs to download, sign, and upload this document.</p>
                                                </div>
                                            )
                                        ) : (
                                            /* TEXT type document */
                                            doc.signature ? (
                                                <div className="space-y-2">
                                                    <p className="text-sm text-emerald-400">
                                                        ✓ Signed {new Date(doc.signature.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {new Date(doc.signature.signedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                    </p>
                                                    {doc.signature.signatureType === "TYPED" ? (
                                                        <p className="text-xl italic text-zinc-300" style={{ fontFamily: "'Dancing Script', cursive, serif" }}>
                                                            — {doc.signature.signatureValue}
                                                        </p>
                                                    ) : (
                                                        <img
                                                            src={doc.signature.signatureValue}
                                                            alt={`Signature for ${doc.title}`}
                                                            className="max-h-[60px] object-contain opacity-70"
                                                        />
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-amber-400">⚠ Not signed</p>
                                            )
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Mobile: documents summary (below content) */}
                    <div className="lg:hidden mt-10">
                        {documents.length > 0 && (
                            <div className="mb-6">
                                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Document Status</p>
                                <div className="space-y-2">
                                    {documents.map(doc => (
                                        <div key={doc.id} className="flex items-center justify-between gap-2">
                                            <span className="text-sm text-zinc-300 truncate">{doc.title}</span>
                                            {doc.type === "FILE" ? (
                                                doc.uploadedSignedFilePath || doc.signature ? (
                                                    <span className="shrink-0 text-xs text-emerald-400">✓ Signed</span>
                                                ) : (
                                                    <span className="shrink-0 text-xs text-amber-400">⚠ Awaiting</span>
                                                )
                                            ) : doc.signature ? (
                                                <span className="shrink-0 text-xs text-emerald-400">✓ Signed</span>
                                            ) : (
                                                <span className="shrink-0 text-xs text-red-400">✗ Not signed</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right column — desktop sidebar */}
                <aside className="hidden lg:block lg:w-[35%]">
                    <div className="sticky top-24 rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-6">
                        {sidebarContent}
                    </div>
                </aside>
            </div>

            {/* Mobile fixed bottom bar */}
            {canFinalize && activateStep === "idle" && (
                <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-white/[0.08] bg-zinc-950/95 backdrop-blur px-4 py-3" role="region" aria-label="Actions">
                    <button
                        disabled={pending}
                        onClick={handleActivateClick}
                        aria-describedby="prospect-name"
                        className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50"
                        style={{ minHeight: "56px" }}
                    >
                        {pending ? "Saving..." : `Activate ${firstName} as a Client`}
                    </button>
                </div>
            )}

            {/* Mobile: confirmation card */}
            {canFinalize && activateStep === "confirm" && (
                <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-white/[0.08] bg-zinc-950/95 backdrop-blur px-4 py-4" role="region" aria-label="Actions">
                    <div className="space-y-3">
                        <p className="text-sm text-zinc-300">
                            Activate <strong className="text-zinc-100">{prospectName}</strong>?
                        </p>
                        <div className="flex gap-2">
                            <button
                                disabled={pending}
                                onClick={handleActivateConfirm}
                                className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-amber-400 disabled:opacity-50"
                                style={{ minHeight: "48px" }}
                            >
                                {pending ? "Activating..." : "Yes, Activate"}
                            </button>
                            <button
                                onClick={() => setActivateStep("idle")}
                                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-400 hover:text-zinc-200"
                                style={{ minHeight: "48px" }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom padding for mobile fixed bottom bar */}
            {canFinalize && <div className="lg:hidden h-24" />}
        </div>
    );
}
