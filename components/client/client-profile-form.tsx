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
                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Action Row */}
            <div className="flex flex-col gap-3 sm:flex-row">
                <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition-all hover:border-zinc-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-[#0a1224] dark:text-zinc-100 dark:hover:border-zinc-600"
                >
                    Edit Profile
                </button>
            </div>

            {/* About Me card */}
            <div className="mt-6 rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-[#0a1224]">
                <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">About Me</h3>
                    <button
                        type="button"
                        onClick={() => setShowEditModal(true)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                        Edit
                    </button>
                </div>
                <div className="p-6 space-y-5">
                    <DetailRow label="Name" value={`${initialData.firstName || ""} ${initialData.lastName || ""}`.trim() || "Not set"} muted={!initialData.firstName} />
                    <DetailRow label="Bio" value={initialData.clientBio || "Not set"} muted={!initialData.clientBio} multiline />
                    <DetailRow label="Fitness Goal" value={initialData.fitnessGoal || "Not set"} muted={!initialData.fitnessGoal} />
                </div>
            </div>

            {/* Edit Modal */}
            {showEditModal && (
                <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Edit Profile">
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowEditModal(false)} />
                    <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0a1224]">
                        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-[#0a1224]">
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Edit Profile</h2>
                            <button
                                type="button"
                                onClick={() => setShowEditModal(false)}
                                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                                aria-label="Close"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>

                        <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-5">
                            {message?.type === "error" && (
                                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                    {message.text}
                                </div>
                            )}

                            <div className="grid gap-5 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        First Name
                                    </label>
                                    <input
                                        {...form.register("firstName")}
                                        type="text"
                                        className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                    />
                                    {form.formState.errors.firstName && (
                                        <p className="mt-1 text-xs text-red-600">{form.formState.errors.firstName.message}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        Last Name
                                    </label>
                                    <input
                                        {...form.register("lastName")}
                                        type="text"
                                        className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                    Bio
                                </label>
                                <textarea
                                    {...form.register("clientBio")}
                                    rows={3}
                                    className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                    placeholder="A little about yourself..."
                                />
                                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Visible to your coach</p>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                    Fitness Goal
                                </label>
                                <input
                                    {...form.register("fitnessGoal")}
                                    type="text"
                                    className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                    placeholder="e.g. Lose 20 lbs, Run a marathon, Build muscle"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="rounded-xl px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
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
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
            <p className={`mt-1.5 text-sm leading-relaxed ${muted
                ? "text-zinc-400 italic dark:text-zinc-500"
                : "text-zinc-800 dark:text-zinc-200"
                } ${multiline ? "whitespace-pre-wrap" : ""}`}>
                {value}
            </p>
        </div>
    );
}
