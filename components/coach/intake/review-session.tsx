"use client";

import { useState, useTransition, useCallback, useRef } from "react";
import { saveReviewEdits } from "@/app/actions/intake";
import { sendFormsForSignature } from "@/app/actions/intake";
import { useRouter } from "next/navigation";

type AnswersData = {
    sections?: {
        sectionId: string;
        sectionTitle: string;
        answers: { questionId: string; label: string; value: string }[];
    }[];
};

type ReviewDocument = {
    id: string;
    title: string;
    type: "TEXT" | "FILE";
    content: string | null;
    fileName: string | null;
    signature: { signatureType: "TYPED" | "DRAWN"; signatureValue: string; signedAt: string } | null;
};

export function ReviewSession({
    packetId,
    requestId,
    prospectName,
    answers: initialAnswers,
    coachNotes: initialCoachNotes,
    documents,
    consultationStage,
}: {
    packetId: string;
    requestId: string;
    prospectName: string;
    answers: AnswersData | null;
    coachNotes: string;
    documents: ReviewDocument[];
    consultationStage: string;
}) {
    const router = useRouter();
    const [answers, setAnswers] = useState<AnswersData>(initialAnswers ?? { sections: [] });
    const [coachNotes, setCoachNotes] = useState(initialCoachNotes);
    const [pending, startTransition] = useTransition();
    const [lastSaved, setLastSaved] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [finalized, setFinalized] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

    const debouncedSave = useCallback((updatedAnswers?: AnswersData, updatedNotes?: string) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            startTransition(async () => {
                try {
                    await saveReviewEdits({
                        packetId,
                        formAnswers: updatedAnswers as Record<string, unknown> | undefined,
                        coachNotes: updatedNotes,
                    });
                    setLastSaved(new Date().toLocaleTimeString());
                    setError(null);
                } catch {
                    setError("Auto-save failed. Your changes may not be saved.");
                }
            });
        }, 1000);
    }, [packetId, startTransition]);

    const updateAnswer = useCallback((sectionIdx: number, answerIdx: number, value: string) => {
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

    const handleFinalize = () => {
        setError(null);
        startTransition(async () => {
            try {
                await saveReviewEdits({ packetId, formAnswers: answers as Record<string, unknown>, coachNotes });
                const res = await sendFormsForSignature({ requestId });
                if (res.success) {
                    setFinalized(true);
                    router.refresh();
                } else {
                    setError((res as { message?: string }).message ?? "Failed to finalize.");
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to finalize.");
            }
        });
    };

    if (finalized) {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M20 6 9 17l-5-5"/></svg>
                </div>
                <h2 className="text-lg font-semibold text-zinc-100">Sent for Signature</h2>
                <p className="mt-2 text-sm text-zinc-400">
                    {prospectName} will receive an email with their finalized forms to sign.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Finalize bar — sticky on desktop, fixed bottom on mobile */}
            {consultationStage === "INTAKE_SUBMITTED" && (
                <div className="sticky top-0 z-10 -mx-4 -mt-4 rounded-b-2xl border-b border-white/[0.06] bg-[#0a1224]/95 backdrop-blur-sm px-6 py-4 flex items-center justify-between gap-4 lg:rounded-2xl lg:border lg:mx-0 lg:mt-0">
                    <div className="min-w-0">
                        {lastSaved && <p className="text-xs text-zinc-600">✓ Auto-saved at {lastSaved}</p>}
                        {pending && <p className="text-xs text-zinc-500">Saving...</p>}
                        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
                    </div>
                    <button
                        disabled={pending}
                        onClick={handleFinalize}
                        className="shrink-0 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                        style={{ minHeight: "48px" }}
                    >
                        {pending ? "Saving..." : "Finalize & Send for Signature"}
                    </button>
                </div>
            )}

            {/* All sections — single continuous scroll */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                <div className="space-y-6">
                    {(answers.sections ?? []).map((section, sIdx) => (
                        <section key={section.sectionId} className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6 space-y-5">
                            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{section.sectionTitle}</h2>
                            <div className="space-y-4">
                                {section.answers.map((a, aIdx) => (
                                    <div key={a.questionId}>
                                        <label className="mb-1.5 block text-xs font-medium text-zinc-500">{a.label}</label>
                                        <textarea
                                            value={a.value}
                                            onChange={e => updateAnswer(sIdx, aIdx, e.target.value)}
                                            className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none resize-y"
                                            rows={a.value.length > 100 ? 4 : 2}
                                        />
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}

                    {(answers.sections ?? []).length === 0 && (
                        <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6">
                            <p className="text-sm text-zinc-500">No questionnaire answers submitted.</p>
                        </div>
                    )}

                    {/* Signed Documents */}
                    {documents.length > 0 && (
                        <section className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6 space-y-5">
                            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Signed Documents</h2>
                            {documents.map(doc => (
                                <div key={doc.id} className="space-y-2 border-b border-white/[0.04] pb-4 last:border-0 last:pb-0">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium text-zinc-200">{doc.title}</p>
                                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${doc.type === "FILE" ? "bg-blue-500/10 text-blue-400" : "bg-violet-500/10 text-violet-400"}`}>
                                            {doc.type === "FILE" ? (doc.fileName?.split(".").pop()?.toUpperCase() ?? "File") : "Text"}
                                        </span>
                                    </div>
                                    {doc.signature ? (
                                        <div className="space-y-1">
                                            <p className="flex items-center gap-2 text-sm text-emerald-400">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                                Signed
                                            </p>
                                            <p className="font-serif italic text-sm text-zinc-300">{doc.signature.signatureValue}</p>
                                            <p className="text-xs text-zinc-600">
                                                {doc.signature.signatureType === "TYPED" ? "Typed" : "Drawn"} · {new Date(doc.signature.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-zinc-500">Not signed</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}
                </div>

                {/* Right sidebar: Coach notes — sticky on desktop */}
                <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                    <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 space-y-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Coach Notes</h3>
                        <textarea
                            value={coachNotes}
                            onChange={e => updateNotes(e.target.value)}
                            placeholder="Private notes (not shared with the client)..."
                            className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none resize-y"
                            rows={6}
                        />
                    </div>

                    {consultationStage !== "INTAKE_SUBMITTED" && (
                        <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 space-y-3">
                            {lastSaved && <p className="text-xs text-zinc-600">✓ Auto-saved at {lastSaved}</p>}
                            {pending && <p className="text-xs text-zinc-500">Saving...</p>}
                            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
