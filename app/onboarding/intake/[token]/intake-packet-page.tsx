"use client";

import { useState, useTransition, useCallback, useRef, useEffect } from "react";
import { submitIntakePacket, uploadSignedDocument, removeSignedUpload } from "@/app/actions/intake";

type Section = { id: string; title: string; questions: { id: string; label: string; type: string; required: boolean }[] };
type Document = {
    id: string;
    coachDocumentId: string;
    title: string;
    type: "TEXT" | "FILE";
    content: string | null;
    fileName: string | null;
    filePath: string | null;
    fileDownloadUrl: string | null;
    uploadedSignedFileName: string | null;
    uploadedSignedAt: string | null;
};

type Step =
    | { kind: "intro" }
    | { kind: "section"; sIdx: number }
    | { kind: "document"; dIdx: number }
    | { kind: "submit" };

export default function IntakePacketPage({
    token,
    coachName,
    prospectName,
    sections,
    documents,
    initialAnswers,
}: {
    token: string;
    coachName: string;
    prospectName: string;
    sections: Section[];
    documents: Document[];
    /** Answers already stored on the packet, e.g. saved from the iOS app. */
    initialAnswers?: Record<string, string>;
}) {
    // Seeded, not blank: a client sent here to sign a document has usually
    // filled the questions in the app already (T-624).
    const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...initialAnswers }));
    const [signatures, setSignatures] = useState<Record<string, { type: "TYPED" | "DRAWN"; value: string }>>({});
    const [docAcks, setDocAcks] = useState<Record<string, boolean>>({});
    const [pending, startTransition] = useTransition();
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fontSize, setFontSize] = useState(16);
    const [stepErrors, setStepErrors] = useState<string[]>([]);

    // FILE upload state
    const [uploadedFiles, setUploadedFiles] = useState<Record<string, { fileName: string; at: string }>>(
        // Initialize from pre-existing uploads
        () => {
            const initial: Record<string, { fileName: string; at: string }> = {};
            for (const doc of documents) {
                if (doc.uploadedSignedFileName && doc.uploadedSignedAt) {
                    initial[doc.id] = { fileName: doc.uploadedSignedFileName, at: doc.uploadedSignedAt };
                }
            }
            return initial;
        }
    );
    const [selectedFile, setSelectedFile] = useState<Record<string, File>>({});
    const [uploadPending, setUploadPending] = useState<Record<string, boolean>>({});
    const [uploadError, setUploadError] = useState<Record<string, string>>({});
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    // Build ordered list of steps
    const steps: Step[] = [
        { kind: "intro" },
        ...sections.map((_, sIdx) => ({ kind: "section" as const, sIdx })),
        ...documents.map((_, dIdx) => ({ kind: "document" as const, dIdx })),
        { kind: "submit" },
    ];
    const totalSteps = steps.length;
    const [currentStep, setCurrentStep] = useState(0);

    const headingRef = useRef<HTMLHeadingElement>(null);

    const updateAnswer = useCallback((qId: string, value: string) => {
        setAnswers(prev => ({ ...prev, [qId]: value }));
    }, []);

    // Validation for current step
    const validateCurrentStep = (): string[] => {
        const step = steps[currentStep];
        if (step.kind === "section") {
            const section = sections[step.sIdx];
            const errs: string[] = [];
            for (const q of section.questions) {
                if (q.required && !answers[q.id]?.trim()) {
                    errs.push(q.label);
                }
            }
            return errs;
        }
        if (step.kind === "document") {
            const doc = documents[step.dIdx];
            const errs: string[] = [];
            if (doc.type === "FILE") {
                // FILE doc: needs upload + ack
                if (!uploadedFiles[doc.id]) errs.push("Please upload your signed copy.");
                if (!docAcks[doc.id]) errs.push("Please confirm you have signed and uploaded this document.");
            } else {
                // TEXT doc: needs ack + signature
                if (!docAcks[doc.id]) errs.push("Please confirm you have read the document.");
                if (!signatures[doc.id]?.value?.trim()) errs.push("Signature is required.");
            }
            return errs;
        }
        return [];
    };

    const goNext = () => {
        const errs = validateCurrentStep();
        if (errs.length > 0) {
            setStepErrors(errs);
            return;
        }
        setStepErrors([]);
        setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1));
    };

    const goBack = () => {
        setStepErrors([]);
        setCurrentStep(prev => Math.max(prev - 1, 0));
    };

    // Focus heading on step change
    useEffect(() => {
        headingRef.current?.focus();
    }, [currentStep]);

    // Step title
    const stepTitle = (): string => {
        const step = steps[currentStep];
        if (step.kind === "intro") return "Welcome";
        if (step.kind === "section") return sections[step.sIdx].title;
        if (step.kind === "document") return documents[step.dIdx].title;
        return "Submit";
    };

    // FILE upload handlers
    const handleFileSelect = (docId: string, file: File) => {
        // Client-side validation
        const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
        const MAX_SIZE = 10 * 1024 * 1024;
        if (!ALLOWED.includes(file.type)) {
            setUploadError(prev => ({ ...prev, [docId]: "Only PDF, JPG, and PNG files are accepted." }));
            return;
        }
        if (file.size > MAX_SIZE) {
            setUploadError(prev => ({ ...prev, [docId]: "File must be under 10MB." }));
            return;
        }
        setUploadError(prev => { const n = { ...prev }; delete n[docId]; return n; });
        setSelectedFile(prev => ({ ...prev, [docId]: file }));
    };

    const handleUpload = async (docId: string) => {
        const file = selectedFile[docId];
        if (!file) return;
        setUploadPending(prev => ({ ...prev, [docId]: true }));
        setUploadError(prev => { const n = { ...prev }; delete n[docId]; return n; });
        try {
            const formData = new FormData();
            formData.set("token", token);
            formData.set("intakePacketDocumentId", docId);
            formData.set("file", file);
            const res = await uploadSignedDocument(formData);
            if (res.success) {
                setUploadedFiles(prev => ({ ...prev, [docId]: { fileName: res.fileName ?? file.name, at: new Date().toISOString() } }));
                setSelectedFile(prev => { const n = { ...prev }; delete n[docId]; return n; });
            } else {
                setUploadError(prev => ({ ...prev, [docId]: (res as { message?: string }).message ?? "Upload failed." }));
            }
        } catch {
            setUploadError(prev => ({ ...prev, [docId]: "Upload failed. Please try again." }));
        } finally {
            setUploadPending(prev => ({ ...prev, [docId]: false }));
        }
    };

    const handleRemoveUpload = async (docId: string) => {
        setUploadPending(prev => ({ ...prev, [docId]: true }));
        try {
            const res = await removeSignedUpload({ token, intakePacketDocumentId: docId });
            if (res.success) {
                setUploadedFiles(prev => { const n = { ...prev }; delete n[docId]; return n; });
                setDocAcks(prev => ({ ...prev, [docId]: false }));
            }
        } catch { /* non-blocking */ }
        finally {
            setUploadPending(prev => ({ ...prev, [docId]: false }));
        }
    };

    // Completion check for submit
    const requiredQuestions = sections.flatMap(s => s.questions.filter(q => q.required));
    const answeredRequired = requiredQuestions.filter(q => answers[q.id]?.trim());
    const allDocsComplete = documents.every(d => {
        if (d.type === "FILE") return uploadedFiles[d.id] && docAcks[d.id];
        return signatures[d.id]?.value && docAcks[d.id];
    });
    const isReady = answeredRequired.length === requiredQuestions.length && (documents.length === 0 || allDocsComplete);

    const missing: string[] = [];
    for (const q of requiredQuestions) {
        if (!answers[q.id]?.trim()) missing.push(q.label);
    }
    for (const d of documents) {
        if (d.type === "FILE") {
            if (!uploadedFiles[d.id] || !docAcks[d.id]) missing.push(`${d.title} upload`);
        } else {
            if (!signatures[d.id]?.value || !docAcks[d.id]) missing.push(`${d.title} signature`);
        }
    }

    const handleSubmit = () => {
        setError(null);
        startTransition(async () => {
            try {
                // Build signatures: for FILE docs, create a placeholder signature from the upload
                const docSigs = documents
                    .filter(d => {
                        if (d.type === "FILE") return !!uploadedFiles[d.id];
                        return !!signatures[d.id]?.value;
                    })
                    .map(d => {
                        if (d.type === "FILE") {
                            return {
                                intakePacketDocumentId: d.id,
                                coachDocumentId: d.coachDocumentId,
                                signatureType: "TYPED" as const,
                                signatureValue: `FILE_UPLOADED:${uploadedFiles[d.id]?.fileName ?? "document"}`,
                            };
                        }
                        return {
                            intakePacketDocumentId: d.id,
                            coachDocumentId: d.coachDocumentId,
                            signatureType: signatures[d.id].type,
                            signatureValue: signatures[d.id].value,
                        };
                    });
                const selfDescribingAnswers = {
                    sections: sections.map(s => ({
                        sectionId: s.id,
                        sectionTitle: s.title,
                        answers: s.questions.map(q => ({
                            questionId: q.id,
                            label: q.label,
                            value: answers[q.id] ?? "",
                        })),
                    })),
                };
                const res = await submitIntakePacket({ token, answers: selfDescribingAnswers, documentSignatures: docSigs });
                if (res.success) {
                    setSubmitted(true);
                } else {
                    setError((res as { message?: string }).message ?? "Something went wrong.");
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong.");
            }
        });
    };

    if (submitted) {
        return (
            <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-950 p-8">
                <div className="max-w-md text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                    <h1 className="text-2xl font-bold text-zinc-100">All done, {prospectName}!</h1>
                    <p className="mt-2 text-zinc-400">Your coach {coachName} has been notified and will be in touch.</p>
                </div>
            </div>
        );
    }

    const step = steps[currentStep];

    return (
        <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100" style={{ fontSize: `${fontSize}px` }}>
            {/* Header */}
            <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-zinc-950/95 backdrop-blur-sm px-6 py-4">
                <div className="mx-auto flex max-w-2xl items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Steadfast</p>
                        <p className="text-sm text-zinc-300">{coachName} has sent you forms to complete</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setFontSize(f => Math.max(14, f - 2))}
                            className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                            aria-label="Decrease font size"
                        >
                            A
                        </button>
                        <button
                            onClick={() => setFontSize(f => Math.min(22, f + 2))}
                            className="rounded-lg px-2 py-1 text-sm font-bold text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                            aria-label="Increase font size"
                        >
                            A+
                        </button>
                    </div>
                </div>
                {/* Step indicator */}
                <div className="mx-auto max-w-2xl mt-3">
                    <div className="flex items-center gap-1.5" aria-label={`Step ${currentStep + 1} of ${totalSteps}: ${stepTitle()}`}>
                        {steps.map((_, i) => (
                            <div
                                key={i}
                                className={`h-1.5 flex-1 rounded-full transition-colors ${
                                    i < currentStep ? "bg-emerald-500" : i === currentStep ? "bg-blue-500" : "bg-zinc-800"
                                }`}
                            />
                        ))}
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-500">
                        Step {currentStep + 1} of {totalSteps} — {stepTitle()}
                    </p>
                </div>
            </header>

            <main className="mx-auto max-w-2xl px-6 py-8">
                {/* Intro step */}
                {step.kind === "intro" && (
                    <section>
                        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-zinc-100 outline-none mb-4">Welcome, {prospectName}</h2>
                        <p className="text-lg leading-relaxed text-zinc-300">
                            Please take a few minutes to fill out the following.
                            {coachName} will review your answers with you during your consultation.
                            There are no wrong answers — just be honest.
                        </p>
                        <p className="mt-3 text-sm text-zinc-500">This takes about 5-10 minutes.</p>
                    </section>
                )}

                {/* Questionnaire section step */}
                {step.kind === "section" && (() => {
                    const section = sections[step.sIdx];
                    return (
                        <section className="space-y-6">
                            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-zinc-100 outline-none">{section.title}</h2>
                            {section.questions.map(q => (
                                <div key={q.id}>
                                    <label htmlFor={`q-${q.id}`} className="mb-1.5 block text-sm text-zinc-400">
                                        {q.label}{q.required && <span className="text-red-400 ml-1">*</span>}
                                    </label>
                                    {q.type === "long_text" ? (
                                        <textarea
                                            id={`q-${q.id}`}
                                            value={answers[q.id] ?? ""}
                                            onChange={e => updateAnswer(q.id, e.target.value)}
                                            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none resize-y"
                                            rows={3}
                                            style={{ fontSize: `max(1rem, ${fontSize}px)` }}
                                        />
                                    ) : (
                                        <input
                                            id={`q-${q.id}`}
                                            type="text"
                                            value={answers[q.id] ?? ""}
                                            onChange={e => updateAnswer(q.id, e.target.value)}
                                            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
                                            style={{ fontSize: `max(1rem, ${fontSize}px)`, minHeight: "48px" }}
                                        />
                                    )}
                                    {stepErrors.includes(q.label) && (
                                        <p className="mt-1 text-xs text-red-400">This field is required.</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    );
                })()}

                {/* Document step */}
                {step.kind === "document" && (() => {
                    const doc = documents[step.dIdx];
                    return (
                        <section className="space-y-4">
                            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-zinc-100 outline-none">{doc.title}</h2>
                            <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${doc.type === "FILE" ? "bg-blue-500/10 text-blue-400" : "bg-violet-500/10 text-violet-400"}`}>
                                {doc.type === "FILE" ? (doc.fileName?.split(".").pop()?.toUpperCase() ?? "FILE") : "Document"}
                            </span>

                            {doc.type === "TEXT" && doc.content && (
                                <div className="whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5 text-sm leading-relaxed text-zinc-300 max-h-80 overflow-y-auto">
                                    {doc.content}
                                </div>
                            )}

                            {doc.type === "FILE" && (
                                <div className="space-y-5">
                                    {/* Step 1 — Download */}
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-zinc-300">Step 1 — Download</p>
                                        {doc.fileDownloadUrl ? (
                                            <a
                                                href={doc.fileDownloadUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center justify-center gap-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-zinc-500 hover:text-white transition-all"
                                                style={{ minHeight: "48px" }}
                                            >
                                                ⬇ Download {doc.fileName ?? "document"}
                                            </a>
                                        ) : (
                                            <p className="text-sm text-zinc-500">📄 {doc.fileName}</p>
                                        )}
                                        <p className="text-sm text-zinc-400">
                                            Sign this document by hand or using a digital signing app, then upload your signed copy below.
                                        </p>
                                    </div>

                                    {/* Step 2 — Upload signed copy */}
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-zinc-300">Step 2 — Upload signed copy</p>

                                        {uploadedFiles[doc.id] ? (
                                            /* Upload success */
                                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                                                <p className="flex items-center gap-2 text-sm text-emerald-400">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                                    {uploadedFiles[doc.id].fileName} uploaded
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveUpload(doc.id)}
                                                    disabled={uploadPending[doc.id]}
                                                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                                                >
                                                    {uploadPending[doc.id] ? "Removing..." : "Remove"}
                                                </button>
                                            </div>
                                        ) : selectedFile[doc.id] ? (
                                            /* File selected, ready to upload */
                                            <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4 space-y-3">
                                                <p className="text-sm text-zinc-300">
                                                    📄 {selectedFile[doc.id].name} ({(selectedFile[doc.id].size / 1024 / 1024).toFixed(1)} MB)
                                                </p>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUpload(doc.id)}
                                                        disabled={uploadPending[doc.id]}
                                                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-all"
                                                        style={{ minHeight: "48px" }}
                                                    >
                                                        {uploadPending[doc.id] ? "Uploading..." : "Upload"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedFile(prev => { const n = { ...prev }; delete n[doc.id]; return n; })}
                                                        className="px-3 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* Upload drop zone */
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                aria-label="Upload signed document"
                                                onClick={() => fileInputRefs.current[doc.id]?.click()}
                                                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRefs.current[doc.id]?.click(); } }}
                                                className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-8 cursor-pointer hover:border-zinc-500 hover:bg-zinc-800/30 transition-all"
                                                style={{ minHeight: "120px" }}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                                <p className="text-sm text-zinc-500">Upload your signed copy</p>
                                                <p className="text-xs text-zinc-600">PDF, JPG, or PNG — max 10MB</p>
                                                <input
                                                    ref={el => { fileInputRefs.current[doc.id] = el; }}
                                                    type="file"
                                                    accept=".pdf,.jpg,.jpeg,.png"
                                                    className="hidden"
                                                    onChange={e => {
                                                        const file = e.target.files?.[0];
                                                        if (file) handleFileSelect(doc.id, file);
                                                        e.target.value = "";
                                                    }}
                                                />
                                            </div>
                                        )}

                                        {uploadError[doc.id] && (
                                            <p role="alert" className="text-xs text-red-400 mt-1">{uploadError[doc.id]}</p>
                                        )}
                                    </div>

                                    {/* Acknowledgement */}
                                    <label className="flex items-center gap-2 text-sm text-zinc-300" style={{ minHeight: "48px" }}>
                                        <input
                                            type="checkbox"
                                            checked={docAcks[doc.id] ?? false}
                                            onChange={e => setDocAcks(prev => ({ ...prev, [doc.id]: e.target.checked }))}
                                            className="h-5 w-5 rounded border-zinc-600 bg-zinc-800"
                                        />
                                        I confirm I have signed and uploaded this document
                                    </label>
                                </div>
                            )}

                            {doc.type === "TEXT" && (
                                <>
                                    <label className="flex items-center gap-2 text-sm text-zinc-300" style={{ minHeight: "48px" }}>
                                        <input
                                            type="checkbox"
                                            checked={docAcks[doc.id] ?? false}
                                            onChange={e => setDocAcks(prev => ({ ...prev, [doc.id]: e.target.checked }))}
                                            className="h-5 w-5 rounded border-zinc-600 bg-zinc-800"
                                        />
                                        I have read and agree to {doc.title}
                                    </label>

                                    {/* Per-document signature for TEXT docs */}
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-zinc-400" id={`sig-label-${doc.id}`}>Sign {doc.title}</p>
                                        <div className="flex gap-2 mb-2">
                                            <button
                                                onClick={() => setSignatures(prev => ({ ...prev, [doc.id]: { type: "TYPED", value: prev[doc.id]?.value ?? "" } }))}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${(signatures[doc.id]?.type ?? "TYPED") === "TYPED" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-300"}`}
                                            >
                                                Type
                                            </button>
                                            <button
                                                onClick={() => setSignatures(prev => ({ ...prev, [doc.id]: { type: "DRAWN", value: prev[doc.id]?.value ?? "" } }))}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${signatures[doc.id]?.type === "DRAWN" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-300"}`}
                                            >
                                                Draw
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            value={signatures[doc.id]?.value ?? ""}
                                            onChange={e => setSignatures(prev => ({ ...prev, [doc.id]: { type: prev[doc.id]?.type ?? "TYPED", value: e.target.value } }))}
                                            placeholder="Type your full name"
                                            aria-labelledby={`sig-label-${doc.id}`}
                                            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 font-serif italic placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
                                            style={{ fontSize: `max(1rem, ${fontSize}px)`, minHeight: "48px" }}
                                        />
                                    </div>
                                </>
                            )}
                        </section>
                    );
                })()}

                {/* Submit step */}
                {step.kind === "submit" && (
                    <section className="space-y-4">
                        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-zinc-100 outline-none">Submit</h2>
                        <p className="text-sm text-zinc-400">
                            You&apos;re almost done. Once you submit, {coachName} will review your answers and be in touch.
                        </p>
                        {!isReady && missing.length > 0 && (
                            <div role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-400">
                                <p className="font-semibold mb-1">Still needed:</p>
                                <ul className="list-disc pl-5 space-y-0.5">
                                    {missing.map(m => <li key={m}>{m}</li>)}
                                </ul>
                            </div>
                        )}
                        {error && (
                            <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>
                        )}
                    </section>
                )}

                {/* Validation errors */}
                {stepErrors.length > 0 && (
                    <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
                        <p className="font-semibold mb-1">Please complete the following:</p>
                        <ul className="list-disc pl-5 space-y-0.5">
                            {stepErrors.map(e => <li key={e}>{e}</li>)}
                        </ul>
                    </div>
                )}

                {/* Navigation buttons */}
                <div className="mt-8 flex items-center gap-3">
                    {currentStep > 0 && (
                        <button
                            onClick={goBack}
                            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-all"
                            style={{ minHeight: "56px" }}
                        >
                            ← Back
                        </button>
                    )}
                    <div className="flex-1" />
                    {step.kind === "submit" ? (
                        <button
                            disabled={!isReady || pending}
                            onClick={handleSubmit}
                            className="rounded-xl bg-blue-600 px-8 py-3 text-base font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ minHeight: "56px" }}
                        >
                            {pending ? "Submitting..." : "Submit my forms"}
                        </button>
                    ) : (
                        <button
                            onClick={goNext}
                            className="rounded-xl bg-blue-600 px-8 py-3 text-base font-semibold text-white transition-all hover:bg-blue-500"
                            style={{ minHeight: "56px" }}
                        >
                            Next →
                        </button>
                    )}
                </div>
            </main>
        </div>
    );
}
