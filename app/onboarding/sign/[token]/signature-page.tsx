"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { submitSignature } from "@/app/actions/signature";
import Link from "next/link";

type Props = {
    token: string;
    prospectName: string;
    coachName: string;
    answers: Record<string, unknown>;
    prospectHasAccount: boolean;
};

type AnswerSection = {
    sectionId: string;
    sectionTitle: string;
    answers: { questionId: string; questionLabel: string; value: string }[];
};

function formatValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "Not provided";
    return String(value);
}

export function SignaturePage({ token, prospectName, coachName, answers, prospectHasAccount }: Props) {
    const [tab, setTab] = useState<"type" | "draw">("type");
    const [typedName, setTypedName] = useState("");
    const [agreed, setAgreed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [fontSize, setFontSize] = useState<"normal" | "large">("normal");
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const hasDrawnRef = useRef(false);

    // Parse answers — support both self-describing shape and legacy flat shape
    const answerSections: AnswerSection[] = (() => {
        if (answers?.sections && Array.isArray(answers.sections)) {
            return answers.sections as AnswerSection[];
        }
        // Legacy fallback: flat key/value, render as single section
        const entries = Object.entries(answers).filter(([k]) => !k.startsWith("_"));
        if (entries.length === 0) return [];
        return [{
            sectionId: "legacy",
            sectionTitle: "Your Information",
            answers: entries.map(([k, v]) => ({
                questionId: k,
                questionLabel: k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
                value: formatValue(v),
            })),
        }];
    })();

    // Font size toggle
    useEffect(() => {
        try {
            const saved = localStorage.getItem("sign-font-size");
            if (saved === "large") setFontSize("large");
        } catch { /* */ }
    }, []);

    const toggleFontSize = () => {
        const next = fontSize === "normal" ? "large" : "normal";
        setFontSize(next);
        try { localStorage.setItem("sign-font-size", next); } catch { /* */ }
    };

    const readAloud = () => {
        if (!("speechSynthesis" in window)) return;
        window.speechSynthesis.cancel();
        const text = answerSections.map(s =>
            `${s.sectionTitle}. ` + s.answers.map(a => `${a.questionLabel}: ${a.value || "Not provided"}`).join(". ")
        ).join(". ");
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
    };

    // Canvas drawing
    const getCanvasContext = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.strokeStyle = "#e4e4e7";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        return ctx;
    }, []);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if ("touches" in e) {
            return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
        }
        return { x: (e.nativeEvent.offsetX) * scaleX, y: (e.nativeEvent.offsetY) * scaleY };
    };

    const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        isDrawingRef.current = true;
        hasDrawnRef.current = true;
        const ctx = getCanvasContext();
        if (!ctx) return;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingRef.current) return;
        e.preventDefault();
        const ctx = getCanvasContext();
        if (!ctx) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const endDraw = () => { isDrawingRef.current = false; };

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawnRef.current = false;
    };

    const handleSubmit = async () => {
        setError(null);
        setSubmitting(true);
        try {
            let signatureValue = "";
            let signatureType: "TYPED" | "DRAWN" = "TYPED";

            if (tab === "type") {
                signatureValue = typedName.trim();
                signatureType = "TYPED";
            } else {
                const canvas = canvasRef.current;
                if (canvas) signatureValue = canvas.toDataURL("image/png");
                signatureType = "DRAWN";
            }

            if (!signatureValue) {
                setError("Please provide your signature before submitting.");
                setSubmitting(false);
                return;
            }

            const result = await submitSignature({ token, signatureType, signatureValue });
            if (!result.success) {
                setError(result.message ?? "Something went wrong. Please try again.");
            } else {
                setSuccess(true);
            }
        } catch {
            setError("Something went wrong. Please try again.");
        }
        setSubmitting(false);
    };

    const canSubmit = agreed && !submitting && (tab === "type" ? typedName.trim().length > 0 : hasDrawnRef.current);
    const textSize = fontSize === "large" ? "text-lg" : "text-base";

    // Success state
    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4">
                <div className="max-w-md text-center space-y-5">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M20 6 9 17l-5-5" /></svg>
                    </div>
                    <h1 className="text-2xl font-bold text-zinc-100">You&apos;re all signed up, {prospectName}!</h1>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                        Your coach {coachName} has been notified and will be in touch soon.
                    </p>
                    {prospectHasAccount ? (
                        <Link href="/client" className="inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-all min-h-[48px]">
                            Go to your dashboard →
                        </Link>
                    ) : (
                        <p className="text-sm text-zinc-500 leading-relaxed">
                            You&apos;ll receive a separate email to set up your Steadfast account where you can access your plans and check in with your coach.
                        </p>
                    )}
                    <p className="text-xs text-zinc-600 pt-4">Steadfast</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl py-8 px-4 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-zinc-600">Steadfast</p>
                    <h1 className="text-xl font-bold text-zinc-100 mt-2">{coachName} has sent you forms to review</h1>
                    <p className="text-sm text-zinc-500 mt-1">{prospectName}</p>
                </div>
                <div className="flex items-center gap-2">
                    {"speechSynthesis" in globalThis && (
                        <button onClick={readAloud} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all min-h-[48px]" aria-label="Read page aloud">
                            🔊
                        </button>
                    )}
                    <button onClick={toggleFontSize} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all min-h-[48px]" aria-label={`Switch to ${fontSize === "normal" ? "larger" : "normal"} text`}>
                        {fontSize === "normal" ? "A+" : "A"}
                    </button>
                </div>
            </div>

            {/* Intro */}
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
                <p className={`${textSize} text-zinc-300 leading-relaxed`}>
                    Hi {prospectName}, {coachName} has prepared the following information based on your consultation.
                    Please read everything carefully. At the bottom, you can sign to confirm everything is accurate.
                </p>
            </div>

            {/* Dynamic answers display */}
            {answerSections.map((section) => (
                <div key={section.sectionId} className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 space-y-4">
                    <h2 className="text-lg font-bold text-zinc-200">{section.sectionTitle}</h2>
                    <div className="space-y-3">
                        {section.answers.map((a) => (
                            <div key={a.questionId} className="flex justify-between gap-4">
                                <span className={`${textSize} text-zinc-500 shrink-0`}>{a.questionLabel}</span>
                                <span className={`${textSize} text-zinc-200 text-right`}>{a.value || "Not provided"}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {/* Agreement */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 space-y-4">
                <h2 className="text-lg font-bold text-zinc-200">Agreement</h2>
                <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4">
                    <p className={`${textSize} text-zinc-300 leading-relaxed`}>
                        By signing below, you confirm that the information above is accurate and you agree to work with {coachName} as your coach.
                    </p>
                </div>
                <div className="space-y-2 text-sm text-zinc-400 leading-relaxed" id="agreement-text">
                    <p>By signing below, I confirm that:</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>The information above is accurate to the best of my knowledge</li>
                        <li>I understand this information will be used by {coachName} to build my coaching program</li>
                        <li>I am voluntarily entering into a coaching relationship with {coachName}</li>
                    </ul>
                </div>
            </div>

            {/* Signature */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-5 space-y-5">
                <h2 className="text-lg font-bold text-zinc-200">Signature</h2>

                {/* Tabs */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setTab("type")}
                        className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all min-h-[48px] ${tab === "type" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
                    >
                        Type your signature
                    </button>
                    <button
                        onClick={() => setTab("draw")}
                        className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all min-h-[48px] ${tab === "draw" ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
                    >
                        Draw your signature
                    </button>
                </div>

                {/* Type tab */}
                {tab === "type" && (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="sig-typed" className="mb-1.5 block text-sm font-medium text-zinc-400">Type your full legal name</label>
                            <input
                                id="sig-typed"
                                type="text"
                                value={typedName}
                                onChange={(e) => setTypedName(e.target.value)}
                                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-base text-zinc-100 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 min-h-[48px]"
                                style={{ fontSize: "max(1rem, 16px)" }}
                                aria-label="Type your full legal name as your signature"
                                autoComplete="name"
                            />
                        </div>
                        {typedName.trim() && (
                            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-6 text-center">
                                <p className="text-zinc-600 text-xs mb-2">Signature preview</p>
                                <p style={{ fontFamily: "'Brush Script MT', 'Segoe Script', 'Comic Sans MS', cursive", fontSize: "2rem" }} className="text-zinc-200 break-words">
                                    {typedName}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Draw tab */}
                {tab === "draw" && (
                    <div className="space-y-3">
                        <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
                            <canvas
                                ref={canvasRef}
                                width={600}
                                height={200}
                                className="w-full cursor-crosshair touch-none"
                                style={{ minHeight: "160px" }}
                                aria-label="Signature drawing area"
                                onMouseDown={startDraw}
                                onMouseMove={draw}
                                onMouseUp={endDraw}
                                onMouseLeave={endDraw}
                                onTouchStart={startDraw}
                                onTouchMove={draw}
                                onTouchEnd={endDraw}
                            />
                        </div>
                        <button onClick={clearCanvas} className="rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all min-h-[48px]">
                            Clear
                        </button>
                    </div>
                )}

                {/* Checkbox */}
                <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        className="mt-0.5 h-6 w-6 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                        aria-describedby="agreement-text"
                    />
                    <span className={`${textSize} text-zinc-400 group-hover:text-zinc-300`}>I have read and understood all of the above information</span>
                </label>

                {/* Timestamp */}
                <p className="text-xs text-zinc-600">
                    Signing on {new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}
                </p>

                {/* Error */}
                {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</p>}

                {/* Submit */}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    aria-disabled={!canSubmit}
                    className="w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
                >
                    {submitting ? "Submitting..." : "Confirm and Sign"}
                </button>
            </div>

            <p className="text-center text-xs text-zinc-700 pb-8">Steadfast</p>
        </div>
    );
}
