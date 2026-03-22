"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { addLeadManually } from "@/app/actions/coaching-requests";

const SOURCES = [
    { value: "REFERRAL", label: "Referral" },
    { value: "SOCIAL_MEDIA", label: "Social Media" },
    { value: "IN_PERSON", label: "In Person" },
    { value: "OTHER", label: "Other" },
] as const;

export function AddLeadForm({ onClose }: { onClose: () => void }) {
    const [pending, startTransition] = useTransition();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [goals, setGoals] = useState("");
    const [source, setSource] = useState<string>("REFERRAL");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        nameRef.current?.focus();
    }, []);

    const validate = () => {
        const errs: Record<string, string> = {};
        if (name.trim().length < 2) errs.name = "Name must be at least 2 characters.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address.";
        const digits = phone.replace(/\D/g, "");
        if (digits.length < 10) errs.phone = "Enter at least 10 digits.";
        if (!source) errs.source = "Select a source.";
        return errs;
    };

    const handleSubmit = () => {
        const errs = validate();
        setErrors(errs);
        if (Object.keys(errs).length > 0) return;

        setServerError(null);
        startTransition(async () => {
            try {
                const res = await addLeadManually({
                    prospectName: name.trim(),
                    prospectEmailAddr: email.trim(),
                    prospectPhone: phone.trim(),
                    goals: goals.trim() || undefined,
                    source: source as "REFERRAL" | "SOCIAL_MEDIA" | "IN_PERSON" | "OTHER",
                });
                if (res.success) {
                    onClose();
                } else {
                    setServerError((res as { message?: string }).message ?? "Failed to add lead.");
                }
            } catch (e) {
                setServerError(e instanceof Error ? e.message : "Something went wrong.");
            }
        });
    };

    const handleCancel = () => {
        onClose();
        // Return focus to trigger button
        setTimeout(() => buttonRef.current?.focus(), 0);
    };

    const fieldClass = "w-full rounded-xl border bg-zinc-800/50 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors";
    const normalBorder = "border-zinc-700 focus:border-blue-500/50";
    const errorBorder = "border-red-500/50 focus:border-red-500/50";

    return (
        <div className="rounded-2xl border border-white/[0.06] bg-[#0a1224] p-6 space-y-4 animate-fade-in">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Add Lead Manually</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Name */}
                <div>
                    <label htmlFor="add-lead-name" className="mb-1.5 block text-xs font-medium text-zinc-400">Name *</label>
                    <input
                        ref={nameRef}
                        id="add-lead-name"
                        type="text"
                        value={name}
                        onChange={e => { setName(e.target.value); setErrors(prev => ({ ...prev, name: "" })); }}
                        placeholder="Full name"
                        className={`${fieldClass} ${errors.name ? errorBorder : normalBorder}`}
                        style={{ minHeight: "48px" }}
                    />
                    {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
                </div>

                {/* Email */}
                <div>
                    <label htmlFor="add-lead-email" className="mb-1.5 block text-xs font-medium text-zinc-400">Email *</label>
                    <input
                        id="add-lead-email"
                        type="email"
                        value={email}
                        onChange={e => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: "" })); }}
                        placeholder="email@example.com"
                        className={`${fieldClass} ${errors.email ? errorBorder : normalBorder}`}
                        style={{ minHeight: "48px" }}
                    />
                    {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
                </div>

                {/* Phone */}
                <div>
                    <label htmlFor="add-lead-phone" className="mb-1.5 block text-xs font-medium text-zinc-400">Phone *</label>
                    <input
                        id="add-lead-phone"
                        type="tel"
                        value={phone}
                        onChange={e => { setPhone(e.target.value); setErrors(prev => ({ ...prev, phone: "" })); }}
                        placeholder="(555) 123-4567"
                        className={`${fieldClass} ${errors.phone ? errorBorder : normalBorder}`}
                        style={{ minHeight: "48px" }}
                    />
                    {errors.phone && <p className="mt-1 text-xs text-red-400">{errors.phone}</p>}
                </div>

                {/* Source */}
                <div>
                    <label htmlFor="add-lead-source" className="mb-1.5 block text-xs font-medium text-zinc-400">Source *</label>
                    <select
                        id="add-lead-source"
                        value={source}
                        onChange={e => setSource(e.target.value)}
                        className={`${fieldClass} ${errors.source ? errorBorder : normalBorder}`}
                        style={{ minHeight: "48px" }}
                    >
                        {SOURCES.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                    {errors.source && <p className="mt-1 text-xs text-red-400">{errors.source}</p>}
                </div>
            </div>

            {/* Goals */}
            <div>
                <label htmlFor="add-lead-goals" className="mb-1.5 block text-xs font-medium text-zinc-400">Goals / Notes</label>
                <textarea
                    id="add-lead-goals"
                    value={goals}
                    onChange={e => setGoals(e.target.value)}
                    placeholder="What are they looking to achieve? Any context from your initial conversation."
                    rows={3}
                    className={`${fieldClass} ${normalBorder} resize-y`}
                />
            </div>

            {serverError && (
                <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{serverError}</p>
            )}

            <div className="flex items-center gap-3 pt-1">
                <button
                    disabled={pending}
                    onClick={handleSubmit}
                    className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                    style={{ minHeight: "48px" }}
                >
                    {pending ? "Adding..." : "Add to Pipeline"}
                </button>
                <button
                    ref={buttonRef}
                    type="button"
                    onClick={handleCancel}
                    className="px-5 py-3 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                    style={{ minHeight: "48px" }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
