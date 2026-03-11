"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useCallback, useEffect } from "react";
import { Toggle } from "@/components/ui/toggle";
import { upsertCoachProfile } from "@/app/actions/marketplace";

const profileSchema = z.object({
    slug: z.string().min(3, "Slug must be at least 3 characters").regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
    headline: z.string().max(100, "Headline max 100 characters").optional().nullable(),
    bio: z.string().max(500, "Bio max 500 characters").optional().nullable(),
    specialties: z.string().optional().nullable(),
    pricing: z.string().max(100).optional().nullable(),
    acceptingClients: z.boolean(),
    isPublished: z.boolean(),
    welcomeMessage: z.string().max(300, "Welcome message max 300 characters").optional().nullable(),
});

type FormValues = z.infer<typeof profileSchema>;

type InitialDataProps = {
    slug?: string | null;
    headline?: string | null;
    bio?: string | null;
    specialties?: string[] | null;
    pricing?: string | null;
    acceptingClients?: boolean | null;
    isPublished?: boolean | null;
    welcomeMessage?: string | null;
} | null;

export function ProfileForm({
    initialData,
    userName,
    userInitials,
}: {
    initialData: InitialDataProps;
    userName: string;
    userInitials: string;
}) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [shareCopied, setShareCopied] = useState(false);

    // Toggle states (managed separately for instant feedback)
    const [isPublished, setIsPublished] = useState(initialData?.isPublished ?? false);
    const [isAccepting, setIsAccepting] = useState(initialData?.acceptingClients ?? true);

    const form = useForm<FormValues>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            slug: initialData?.slug || "",
            headline: initialData?.headline || "",
            bio: initialData?.bio || "",
            specialties: initialData?.specialties?.join(", ") || "",
            pricing: initialData?.pricing || "",
            acceptingClients: initialData?.acceptingClients ?? true,
            isPublished: initialData?.isPublished || false,
            welcomeMessage: initialData?.welcomeMessage || "",
        },
    });

    async function onSubmit(data: FormValues) {
        setIsSubmitting(true);
        setMessage(null);

        try {
            const specialtiesArray = data.specialties
                ? data.specialties.split(",").map((s) => s.trim()).filter(Boolean)
                : [];

            await upsertCoachProfile({
                ...data,
                specialties: specialtiesArray,
            });

            setIsPublished(data.isPublished);
            setIsAccepting(data.acceptingClients);
            setMessage({ type: "success", text: "Profile updated successfully." });
            setShowEditModal(false);
        } catch (err: unknown) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save profile." });
        } finally {
            setIsSubmitting(false);
        }
    }

    const handleToggle = useCallback(async (field: "isPublished" | "acceptingClients", value: boolean) => {
        const currentValues = form.getValues();
        const updated = { ...currentValues, [field]: value };

        if (field === "isPublished") setIsPublished(value);
        if (field === "acceptingClients") setIsAccepting(value);

        try {
            const specialtiesArray = updated.specialties
                ? updated.specialties.split(",").map((s) => s.trim()).filter(Boolean)
                : [];
            await upsertCoachProfile({ ...updated, specialties: specialtiesArray });
            form.setValue(field, value);
        } catch {
            // Revert on failure
            if (field === "isPublished") setIsPublished(!value);
            if (field === "acceptingClients") setIsAccepting(!value);
        }
    }, [form]);

    async function handleShareProfile() {
        const slug = form.getValues("slug");
        if (!slug) return;
        const fullUrl = `${window.location.origin}/coaches/${slug}`;
        try {
            await navigator.clipboard.writeText(fullUrl);
            setShareCopied(true);
            setTimeout(() => setShareCopied(false), 2000);
        } catch {
            /* ignore */
        }
    }

    const specialtiesArr = (form.getValues("specialties") || "").split(",").map(s => s.trim()).filter(Boolean);

    return (
        <>
            {/* ── Success/Error toast ── */}
            {message && (
                <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${message.type === "success"
                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                    }`}>
                    {message.text}
                </div>
            )}

            {/* ── Action Row ── */}
            <div className="flex flex-col gap-3 sm:flex-row">
                <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition-all hover:border-zinc-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-[#0a1224] dark:text-zinc-100 dark:hover:border-zinc-600"
                >
                    Edit Profile
                </button>
                <button
                    type="button"
                    onClick={handleShareProfile}
                    disabled={!isPublished || !form.getValues("slug")}
                    className={`flex-1 rounded-xl px-5 py-3 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed ${shareCopied
                        ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        }`}
                >
                    {shareCopied ? "✓ Link Copied" : "Share Profile"}
                </button>
            </div>

            {/* ── About Your Coaching ── */}
            <div className="mt-6 rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-[#0a1224]">
                <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">About Your Coaching</h3>
                    <button
                        type="button"
                        onClick={() => setShowEditModal(true)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                        Edit
                    </button>
                </div>
                <div className="p-6 space-y-5">
                    <DetailRow label="Professional Headline" value={initialData?.headline || "Not set"} muted={!initialData?.headline} />
                    <DetailRow label="About / Coaching Philosophy" value={initialData?.bio || "Not set"} muted={!initialData?.bio} multiline />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <DetailRow label="Specialties" value={specialtiesArr.length > 0 ? specialtiesArr.join(", ") : "Not set"} muted={specialtiesArr.length === 0} />
                        <DetailRow label="Pricing" value={initialData?.pricing || "Not set"} muted={!initialData?.pricing} />
                    </div>
                </div>
            </div>

            {/* ── Welcome Message ── */}
            <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-[#0a1224]">
                <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Welcome Message</h3>
                        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Shown on your clients&apos; dashboard</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowEditModal(true)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                        Edit
                    </button>
                </div>
                <div className="px-6 py-5">
                    {initialData?.welcomeMessage ? (
                        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{initialData.welcomeMessage}</p>
                    ) : (
                        <p className="text-sm italic text-zinc-400 dark:text-zinc-500">No welcome message set. Add one to greet your clients.</p>
                    )}
                </div>
            </div>

            {/* ── Visibility & Availability ── */}
            <div className="mt-4 space-y-px overflow-hidden rounded-2xl border border-zinc-200/80 shadow-sm dark:border-zinc-800/80">
                {/* Public Visibility */}
                <div className="bg-white px-6 py-5 dark:bg-[#0a1224]">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Public Visibility</h3>
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {isPublished
                                    ? "Your coaching page is visible in the directory."
                                    : "Your coaching page is hidden from the public directory."}
                            </p>
                        </div>
                        <Toggle
                            checked={isPublished}
                            onChange={(val) => handleToggle("isPublished", val)}
                            label="Show my coaching page publicly"
                        />
                    </div>
                </div>
                {/* Divider */}
                <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
                {/* Client Availability */}
                <div className="bg-white px-6 py-5 dark:bg-[#0a1224]">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Accepting New Clients</h3>
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {isAccepting
                                    ? "People can request coaching from your page."
                                    : "Turn this off if your coaching roster is full."}
                            </p>
                        </div>
                        <Toggle
                            checked={isAccepting}
                            onChange={(val) => handleToggle("acceptingClients", val)}
                            label="Accepting new clients"
                        />
                    </div>
                </div>
            </div>

            {/* ── Edit Profile Modal ── */}
            {showEditModal && (
                <ModalWrapper onClose={() => setShowEditModal(false)}>
                    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Edit Profile">
                        {/* Backdrop */}
                        <div
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                            onClick={() => setShowEditModal(false)}
                        />

                        {/* Modal */}
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

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        Profile URL
                                    </label>
                                    <div className="flex rounded-md shadow-sm">
                                        <span className="inline-flex items-center rounded-l-md border border-r-0 border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                                            /coaches/
                                        </span>
                                        <input
                                            {...form.register("slug")}
                                            type="text"
                                            className="block w-full flex-1 rounded-none rounded-r-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                            placeholder="john-smith"
                                        />
                                    </div>
                                    {form.formState.errors.slug && (
                                        <p className="mt-1 text-xs text-red-600">{form.formState.errors.slug.message}</p>
                                    )}
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        Professional Headline
                                    </label>
                                    <input
                                        {...form.register("headline")}
                                        type="text"
                                        className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                        placeholder="e.g. Strength & Conditioning Coach"
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        About / Coaching Philosophy
                                    </label>
                                    <textarea
                                        {...form.register("bio")}
                                        rows={4}
                                        className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                        placeholder="Tell prospective clients about your coaching approach..."
                                    />
                                </div>

                                <div className="grid gap-5 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                            Specialties
                                        </label>
                                        <input
                                            {...form.register("specialties")}
                                            type="text"
                                            className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                            placeholder="Powerlifting, Hypertrophy"
                                        />
                                        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Comma separated</p>
                                    </div>

                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                            Pricing
                                        </label>
                                        <input
                                            {...form.register("pricing")}
                                            type="text"
                                            className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                            placeholder="e.g. $150/mo"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        Welcome Message
                                    </label>
                                    <textarea
                                        {...form.register("welcomeMessage")}
                                        rows={3}
                                        className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                        placeholder="e.g. Welcome to coaching — check in every week and message me anytime."
                                    />
                                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Shown to your clients on their dashboard</p>
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
                                        className="rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                                    >
                                        {isSubmitting ? "Saving..." : "Save Changes"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </ModalWrapper>
            )}
        </>
    );
}

/* ── Helpers ── */

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

function ModalWrapper({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return <>{children}</>;
}
