"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { updateClientProfile } from "@/app/actions/client-profile";

const clientProfileSchema = z.object({
    firstName: z.string().min(1, "First name is required").max(50),
    lastName: z.string().max(50).optional().nullable(),
    clientBio: z.string().max(300, "Bio max 300 characters").optional().nullable(),
    fitnessGoal: z.string().max(100, "Goal max 100 characters").optional().nullable(),
});

type FormValues = z.infer<typeof clientProfileSchema>;

type ClientProfileData = {
    firstName?: string | null;
    lastName?: string | null;
    clientBio?: string | null;
    fitnessGoal?: string | null;
};

export function ClientProfileForm({
    initialData,
}: {
    initialData: ClientProfileData;
}) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(clientProfileSchema),
        defaultValues: {
            firstName: initialData.firstName || "",
            lastName: initialData.lastName || "",
            clientBio: initialData.clientBio || "",
            fitnessGoal: initialData.fitnessGoal || "",
        },
    });

    async function onSubmit(data: FormValues) {
        setIsSubmitting(true);
        setMessage(null);
        try {
            await updateClientProfile(data);
            setMessage({ type: "success", text: "Profile updated." });
            setShowEditModal(false);
        } catch (err: unknown) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save." });
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <>
            {/* Toast */}
            {message && (
                <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${message.type === "success"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Action Row */}
            <div className="flex flex-col gap-3 sm:flex-row">
                <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="flex-1 rounded-xl border border-white/[0.1] bg-white/[0.06] px-5 py-3 text-sm font-semibold text-zinc-200 transition-all hover:border-white/[0.16] hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                    Edit Profile
                </button>
            </div>

            {/* About Me card */}
            <div className="mt-6 sf-glass-card">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
                    <h3 className="text-sm font-semibold text-zinc-200">About Me</h3>
                    <button
                        type="button"
                        onClick={() => setShowEditModal(true)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                    >
                        Edit
                    </button>
                </div>
                <div className="p-5 space-y-5 sm:p-6">
                    <DetailRow label="Name" value={`${initialData.firstName || ""} ${initialData.lastName || ""}`.trim() || "Not set"} muted={!initialData.firstName} />
                    <DetailRow label="Bio" value={initialData.clientBio || "Not set"} muted={!initialData.clientBio} multiline />
                    <DetailRow label="Fitness Goal" value={initialData.fitnessGoal || "Not set"} muted={!initialData.fitnessGoal} />
                </div>
            </div>

            {/* Edit Modal */}
            {showEditModal && (
                <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Edit Profile">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowEditModal(false)} />
                    <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/[0.08] bg-[#111113] shadow-2xl shadow-black/50">

                        {/* Header */}
                        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#111113]/95 backdrop-blur-sm px-5 py-4 sm:px-6">
                            <h2 className="text-base font-semibold text-zinc-100 sm:text-lg">Edit Profile</h2>
                            <button
                                type="button"
                                onClick={() => setShowEditModal(false)}
                                className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
                                aria-label="Close"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={form.handleSubmit(onSubmit)} className="p-5 space-y-5 sm:p-6">
                            {message?.type === "error" && (
                                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                                    {message.text}
                                </div>
                            )}

                            {/* Name fields — stacked on mobile, side-by-side on desktop */}
                            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                                        First Name
                                    </label>
                                    <input
                                        {...form.register("firstName")}
                                        type="text"
                                        className="sf-input w-full"
                                        style={{ fontSize: "max(1rem, 16px)" }}
                                    />
                                    {form.formState.errors.firstName && (
                                        <p className="mt-1 text-xs text-red-400">{form.formState.errors.firstName.message}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                                        Last Name
                                    </label>
                                    <input
                                        {...form.register("lastName")}
                                        type="text"
                                        className="sf-input w-full"
                                        style={{ fontSize: "max(1rem, 16px)" }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                                    Bio
                                </label>
                                <textarea
                                    {...form.register("clientBio")}
                                    rows={3}
                                    className="sf-input w-full resize-none"
                                    placeholder="A little about yourself..."
                                    style={{ fontSize: "max(1rem, 16px)" }}
                                />
                                <p className="mt-1.5 text-xs text-zinc-500">Visible to your coach</p>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                                    Fitness Goal
                                </label>
                                <input
                                    {...form.register("fitnessGoal")}
                                    type="text"
                                    className="sf-input w-full"
                                    placeholder="e.g. Lose 20 lbs, Run a marathon, Build muscle"
                                    style={{ fontSize: "max(1rem, 16px)" }}
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5 pb-safe">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="rounded-xl px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                                    style={{ minHeight: "44px" }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="sf-button-primary rounded-xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                                    style={{ minHeight: "44px" }}
                                >
                                    {isSubmitting ? "Saving..." : "Save Changes"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

function DetailRow({
    label,
    value,
    muted = false,
    multiline = false,
}: {
    label: string;
    value: string;
    muted?: boolean;
    multiline?: boolean;
}) {
    return (
        <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
            <p className={`mt-1.5 text-sm leading-relaxed ${muted
                ? "text-zinc-600 italic"
                : "text-zinc-200"
                } ${multiline ? "whitespace-pre-wrap" : ""}`}>
                {value}
            </p>
        </div>
    );
}

