"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useRef, useEffect } from "react";
import { submitCoachingRequest } from "@/app/actions/coaching-requests";
import Link from "next/link";

const intakeSchema = z.object({
    prospectName: z.string().min(2, "Name must be at least 2 characters").max(100),
    prospectEmail: z.string().email("Please enter a valid email address"),
    prospectPhone: z.string().min(7, "Please enter a valid phone number").max(30),
    goals: z.string().min(5, "Please elaborate on your goals").max(1000),
    experience: z.string().max(1000).optional(),
    injuries: z.string().max(1000).optional(),
});

type FormValues = z.infer<typeof intakeSchema>;

const STEPS = [
    { id: "contact", label: "Contact" },
    { id: "intake", label: "Intake" },
    { id: "review", label: "Review" },
] as const;

/* ── Reusable Field Components ── */

function FieldLabel({ htmlFor, children, required, focused, error }: {
    htmlFor: string; children: React.ReactNode; required?: boolean;
    focused?: boolean; error?: boolean;
}) {
    return (
        <label htmlFor={htmlFor} className={`block text-[13px] font-semibold uppercase tracking-widest mb-2 transition-colors duration-150 ${
            focused ? "text-[var(--sf-accent-light)]" : error ? "text-red-400" : "text-zinc-400"
        }`}>
            {children}
            {required && <span className="text-red-400/70 ml-0.5">*</span>}
        </label>
    );
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400 animate-fade-in">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
            {message}
        </p>
    );
}

/* ── Main Form ── */

export function RequestForm({ coachProfileId, prefill }: {
    coachProfileId: string;
    prefill?: { name?: string; email?: string; phone?: string };
}) {
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [step, setStep] = useState(0);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(intakeSchema),
        defaultValues: {
            prospectName: prefill?.name ?? "",
            prospectEmail: prefill?.email ?? "",
            prospectPhone: prefill?.phone ?? "",
            goals: "",
            experience: "",
            injuries: "",
        },
        mode: "onBlur",
    });

    const { formState: { errors }, trigger, watch } = form;
    const watchedValues = watch();
    const goalsLength = watchedValues.goals?.length ?? 0;
    const experienceLength = watchedValues.experience?.length ?? 0;

    async function goNext() {
        if (step === 0) {
            const valid = await trigger(["prospectName", "prospectEmail", "prospectPhone"]);
            if (!valid) return;
        } else if (step === 1) {
            const valid = await trigger(["goals"]);
            if (!valid) return;
        }
        setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }

    function goBack() {
        setStep((s) => Math.max(s - 1, 0));
    }

    async function onSubmit(data: FormValues) {
        setIsSubmitting(true);
        setError(null);
        try {
            await submitCoachingRequest({
                coachProfileId,
                prospectName: data.prospectName,
                prospectEmail: data.prospectPhone,
                prospectEmailAddr: data.prospectEmail,
                prospectPhone: data.prospectPhone,
                intakeAnswers: {
                    goals: data.goals,
                    experience: data.experience,
                    injuries: data.injuries,
                },
            });
            setSuccess(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to submit request.");
            setIsSubmitting(false);
        }
    }

    useEffect(() => {
        containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [step]);

    /* ── Success State ── */
    if (success) {
        return (
            <div className="py-10 text-center animate-fade-in">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
                    style={{ background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.25)" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                        stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">Request Submitted</h2>
                <p className="mt-2 text-sm text-zinc-400 max-w-xs mx-auto leading-relaxed">
                    Your coach will review your intake and reach out shortly. Check your email for a confirmation.
                </p>
                <Link href="/coaches" className="sf-button-secondary mt-6 inline-flex text-sm">
                    ← Back to Directory
                </Link>
            </div>
        );
    }

    return (
        <div ref={containerRef}>
            {/* ── Step Progress Bar ── */}
            <div className="mb-8 flex items-center gap-0">
                {STEPS.map((s, i) => (
                    <div key={s.id} className="flex items-center flex-1 last:flex-none">
                        <button
                            type="button"
                            onClick={() => { if (i < step) setStep(i); }}
                            disabled={i > step}
                            className="flex items-center gap-2 group"
                        >
                            {/* Step number circle */}
                            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                                i < step
                                    ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
                                    : i === step
                                        ? "bg-[var(--sf-accent)]/20 text-[var(--sf-accent-light)] ring-1 ring-[var(--sf-accent)]/40"
                                        : "bg-white/[0.04] text-zinc-600 ring-1 ring-white/[0.06]"
                            }`}>
                                {i < step ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    i + 1
                                )}
                            </span>
                            <span className={`text-xs font-semibold transition-colors ${
                                i < step ? "text-emerald-400" : i === step ? "text-white" : "text-zinc-600"
                            }`}>
                                {s.label}
                            </span>
                        </button>
                        {/* Connector line */}
                        {i < STEPS.length - 1 && (
                            <div className="flex-1 mx-3 h-px transition-colors duration-500"
                                style={{ background: i < step ? "rgba(74, 222, 128, 0.3)" : "rgba(255,255,255,0.06)" }} />
                        )}
                    </div>
                ))}
            </div>

            {/* ── Error banner ── */}
            {error && (
                <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400 flex items-start gap-2 animate-fade-in">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                        <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" />
                        <line x1="12" x2="12.01" y1="16" y2="16" />
                    </svg>
                    {error}
                </div>
            )}

            <form onSubmit={form.handleSubmit(onSubmit)}>

                {/* ── Step 0: Contact ── */}
                {step === 0 && (
                    <div className="space-y-5 animate-fade-in">
                        <div className="mb-6">
                            <p className="sf-section-label" style={{ fontSize: "12px" }}>Your Information</p>
                            <p className="text-sm text-zinc-400 mt-1.5">We&apos;ll use this to set up your coaching relationship.</p>
                        </div>

                        <div>
                            <FieldLabel htmlFor="prospectName" required focused={focusedField === "name"} error={!!errors.prospectName}>
                                Full Name
                            </FieldLabel>
                            <input {...form.register("prospectName")} id="prospectName" type="text" autoComplete="name"
                                className={`sf-input ${errors.prospectName ? "error" : ""}`}
                                placeholder="Your full name"
                                onFocus={() => setFocusedField("name")} onBlur={(e) => { setFocusedField(null); form.register("prospectName").onBlur(e); }}
                            />
                            <FieldError message={errors.prospectName?.message} />
                        </div>

                        <div className="grid gap-5 sm:grid-cols-2">
                            <div>
                                <FieldLabel htmlFor="prospectEmail" required focused={focusedField === "email"} error={!!errors.prospectEmail}>
                                    Email
                                </FieldLabel>
                                <input {...form.register("prospectEmail")} id="prospectEmail" type="email" autoComplete="email"
                                    className={`sf-input ${errors.prospectEmail ? "error" : ""}`}
                                    placeholder="you@email.com"
                                    onFocus={() => setFocusedField("email")} onBlur={(e) => { setFocusedField(null); form.register("prospectEmail").onBlur(e); }}
                                />
                                <FieldError message={errors.prospectEmail?.message} />
                            </div>
                            <div>
                                <FieldLabel htmlFor="prospectPhone" required focused={focusedField === "phone"} error={!!errors.prospectPhone}>
                                    Phone Number
                                </FieldLabel>
                                <input {...form.register("prospectPhone")} id="prospectPhone" type="tel" autoComplete="tel"
                                    className={`sf-input ${errors.prospectPhone ? "error" : ""}`}
                                    placeholder="(555) 123-4567"
                                    onFocus={() => setFocusedField("phone")} onBlur={(e) => { setFocusedField(null); form.register("prospectPhone").onBlur(e); }}
                                />
                                <FieldError message={errors.prospectPhone?.message} />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Step 1: Intake ── */}
                {step === 1 && (
                    <div className="space-y-5 animate-fade-in">
                        <div className="mb-6">
                            <p className="sf-section-label" style={{ fontSize: "12px" }}>Tell Us About Yourself</p>
                            <p className="text-sm text-zinc-400 mt-1.5">This helps your coach personalize your program from day one.</p>
                        </div>

                        <div>
                            <FieldLabel htmlFor="goals" required focused={focusedField === "goals"} error={!!errors.goals}>
                                Primary Goals
                            </FieldLabel>
                            <textarea {...form.register("goals")} id="goals" rows={3}
                                className={`sf-textarea ${errors.goals ? "error" : ""}`}
                                placeholder="e.g. Lose 15lbs, build muscle, prep for a show, improve strength..."
                                maxLength={1000}
                                onFocus={() => setFocusedField("goals")} onBlur={(e) => { setFocusedField(null); form.register("goals").onBlur(e); }}
                            />
                            <div className="mt-1 flex justify-between">
                                <FieldError message={errors.goals?.message} />
                                <span className={`text-[11px] tabular-nums ml-auto ${goalsLength > 900 ? "text-amber-400" : "text-zinc-600"}`}>
                                    {goalsLength}/1000
                                </span>
                            </div>
                        </div>

                        <div>
                            <FieldLabel htmlFor="experience" focused={focusedField === "experience"}>
                                Training &amp; Dietary Experience
                            </FieldLabel>
                            <textarea {...form.register("experience")} id="experience" rows={3}
                                className="sf-textarea"
                                placeholder="How many years training? Any programs or diets you've tried?"
                                maxLength={1000}
                                onFocus={() => setFocusedField("experience")} onBlur={(e) => { setFocusedField(null); form.register("experience").onBlur(e); }}
                            />
                            <div className="mt-1 flex justify-end">
                                <span className={`text-[11px] tabular-nums ${experienceLength > 900 ? "text-amber-400" : "text-zinc-600"}`}>
                                    {experienceLength}/1000
                                </span>
                            </div>
                        </div>

                        <div>
                            <FieldLabel htmlFor="injuries" focused={focusedField === "injuries"}>
                                Current Injuries or Limitations
                            </FieldLabel>
                            <input {...form.register("injuries")} id="injuries" type="text"
                                className="sf-input"
                                placeholder="e.g. Lower back pain, shoulder impingement, none"
                                onFocus={() => setFocusedField("injuries")} onBlur={(e) => { setFocusedField(null); form.register("injuries").onBlur(e); }}
                            />
                        </div>
                    </div>
                )}

                {/* ── Step 2: Review ── */}
                {step === 2 && (
                    <div className="space-y-4 animate-fade-in">
                        <div className="mb-6">
                            <p className="sf-section-label" style={{ fontSize: "12px" }}>Review Your Request</p>
                            <p className="text-sm text-zinc-400 mt-1.5">Make sure everything looks good before submitting.</p>
                        </div>

                        <div className="space-y-2">
                            <ReviewRow label="Name" value={watchedValues.prospectName} />
                            <ReviewRow label="Email" value={watchedValues.prospectEmail} />
                            <ReviewRow label="Phone" value={watchedValues.prospectPhone} />
                        </div>

                        <div className="h-px bg-white/[0.06] my-3" />

                        <div className="space-y-2">
                            <ReviewRow label="Goals" value={watchedValues.goals} multiline />
                            {watchedValues.experience && <ReviewRow label="Experience" value={watchedValues.experience} multiline />}
                            {watchedValues.injuries && <ReviewRow label="Injuries" value={watchedValues.injuries} />}
                        </div>

                        <div className="mt-5 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
                            <p className="text-center text-xs text-zinc-400">
                                By submitting, you agree to our{" "}
                                <Link href="/terms" className="text-zinc-400 underline underline-offset-2 hover:text-white transition-colors">Terms</Link>
                                {" "}and{" "}
                                <Link href="/privacy" className="text-zinc-400 underline underline-offset-2 hover:text-white transition-colors">Privacy Policy</Link>.
                            </p>
                        </div>
                    </div>
                )}

                {/* ── Navigation ── */}
                <div className="mt-8 flex items-center gap-3">
                    {step > 0 && (
                        <button type="button" onClick={goBack} className="sf-button-ghost text-sm">
                            ← Back
                        </button>
                    )}
                    <div className="flex-1" />
                    {step < STEPS.length - 1 ? (
                        <button type="button" onClick={goNext} className="sf-button-primary text-sm min-w-[140px]">
                            Continue
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                            </svg>
                        </button>
                    ) : (
                        <button type="submit" disabled={isSubmitting} className="sf-button-primary text-sm min-w-[180px]">
                            {isSubmitting ? (
                                <>
                                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                    Submitting…
                                </>
                            ) : (
                                <>
                                    Submit Request
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
}

/* ── Review Row ── */

function ReviewRow({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
    return (
        <div className="flex gap-4 rounded-xl border border-white/[0.04] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 pt-0.5 w-20">{label}</span>
            <span className={`text-sm text-zinc-300 ${multiline ? "whitespace-pre-wrap leading-relaxed" : "truncate"}`}>
                {value || "—"}
            </span>
        </div>
    );
}
