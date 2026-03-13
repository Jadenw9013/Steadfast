"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Toggle } from "@/components/ui/toggle";
import { upsertCoachProfile } from "@/app/actions/marketplace";
import Link from "next/link";

const SERVICES_OPTIONS = [
    "Custom workout plans", "Custom meal plans", "Weekly check-ins",
    "Messaging support", "Form video reviews", "Contest prep",
    "Supplement guidance", "Lifestyle coaching", "Habit coaching",
];

const GOALS_OPTIONS = [
    "Fat loss", "Muscle gain", "Bodybuilding prep", "Lifestyle fitness",
    "Strength training", "Powerlifting", "Athletic performance", "Body recomposition",
];

const CLIENT_TYPES_OPTIONS = [
    "Beginner", "Intermediate", "Advanced", "Competitors",
];

const profileSchema = z.object({
    slug: z.string().min(3, "Slug must be at least 3 characters").regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
    headline: z.string().max(100, "Headline max 100 characters").optional().nullable(),
    bio: z.string().max(500, "Bio max 500 characters").optional().nullable(),
    specialties: z.string().optional().nullable(),
    pricing: z.string().max(100).optional().nullable(),
    acceptingClients: z.boolean(),
    isPublished: z.boolean(),
    welcomeMessage: z.string().max(300, "Welcome message max 300 characters").optional().nullable(),
    experience: z.string().max(2000).optional().nullable(),
    certifications: z.string().max(1000).optional().nullable(),
    coachingType: z.string().optional().nullable(),
    location: z.string().max(100).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    state: z.string().max(100).optional().nullable(),
    serviceTier: z.enum(["training-only", "nutrition-only", "full-coaching"]).optional().nullable(),
    gymName: z.string().max(100).optional().nullable(),
    yearsCoaching: z.number().int().min(0).max(50).optional().nullable(),
    services: z.array(z.string()).default([]),
    clientGoals: z.array(z.string()).default([]),
    clientTypes: z.array(z.string()).default([]),
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
    experience?: string | null;
    certifications?: string | null;
    coachingType?: string | null;
    location?: string | null;
    city?: string | null;
    state?: string | null;
    serviceTier?: string | null;
    gymName?: string | null;
    yearsCoaching?: number | null;
    services?: string[] | null;
    clientGoals?: string[] | null;
    clientTypes?: string[] | null;
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

    // Toggle states (managed separately for instant feedback)
    const [isPublished, setIsPublished] = useState(initialData?.isPublished ?? false);
    const [isAccepting, setIsAccepting] = useState(initialData?.acceptingClients ?? true);

    const form = useForm<FormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: zodResolver(profileSchema) as any,
        defaultValues: {
            slug: initialData?.slug || "",
            headline: initialData?.headline || "",
            bio: initialData?.bio || "",
            specialties: initialData?.specialties?.join(", ") || "",
            pricing: initialData?.pricing || "",
            acceptingClients: initialData?.acceptingClients ?? true,
            isPublished: initialData?.isPublished || false,
            welcomeMessage: initialData?.welcomeMessage || "",
            experience: initialData?.experience || "",
            certifications: initialData?.certifications || "",
            coachingType: initialData?.coachingType || "",
            location: initialData?.location || "",
            city: initialData?.city || "",
            state: initialData?.state || "",
            serviceTier: (initialData?.serviceTier as "training-only" | "nutrition-only" | "full-coaching" | null) ?? null,
            gymName: initialData?.gymName || "",
            yearsCoaching: initialData?.yearsCoaching ?? null,
            services: initialData?.services ?? [],
            clientGoals: initialData?.clientGoals ?? [],
            clientTypes: initialData?.clientTypes ?? [],
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
                yearsCoaching: data.yearsCoaching ? Number(data.yearsCoaching) : null,
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
            <div className="flex gap-3">
                <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-all hover:border-zinc-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-[#0a1224] dark:text-zinc-100 dark:hover:border-zinc-600"
                >
                    Edit Profile
                </button>
                {isPublished && initialData?.slug && (
                    <Link
                        href={`/coaches/${initialData.slug}`}
                        target="_blank"
                        className="flex-1 rounded-xl bg-zinc-900 px-5 py-2.5 text-center text-sm font-semibold text-white transition-all hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                        Preview Profile
                    </Link>
                )}
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

                                {/* ── Visibility & Availability ── */}
                                <div className="space-y-4 rounded-xl border border-zinc-100 p-4 dark:border-zinc-800">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Public Visibility</h3>
                                            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                                {isPublished ? "Your coaching page is visible." : "Your page is hidden."}
                                            </p>
                                        </div>
                                        <Toggle
                                            checked={isPublished}
                                            onChange={(val) => handleToggle("isPublished", val)}
                                            label="Show my coaching page publicly"
                                        />
                                    </div>
                                    <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Accepting Clients</h3>
                                            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                                {isAccepting ? "Clients can request coaching." : "Roster is full."}
                                            </p>
                                        </div>
                                        <Toggle
                                            checked={isAccepting}
                                            onChange={(val) => handleToggle("acceptingClients", val)}
                                            label="Accepting new clients"
                                        />
                                    </div>
                                </div>

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

                                {/* ── Experience & Certs ── */}
                                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">Experience & Credentials</p>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Coaching Experience</label>
                                            <textarea {...form.register("experience")} rows={3} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="Tell clients about your coaching background..." />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Certifications</label>
                                            <textarea {...form.register("certifications")} rows={2} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="NASM, ISSA, CSCS, etc." />
                                        </div>
                                    </div>
                                </div>

                                {/* ── Coaching Details ── */}
                                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">Coaching Details</p>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Coaching Mode</label>
                                            <select {...form.register("coachingType")} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100">
                                                <option value="">Select mode</option>
                                                <option value="online">Online</option>
                                                <option value="in-person">In-Person</option>
                                                <option value="hybrid">Hybrid (online + in-person)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Service Tier</label>
                                            <select {...form.register("serviceTier")} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100">
                                                <option value="">Not specified</option>
                                                <option value="training-only">Training plans only</option>
                                                <option value="nutrition-only">Nutrition plans only</option>
                                                <option value="full-coaching">Full coaching (training + nutrition)</option>
                                            </select>
                                            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Helps clients find coaches who match their needs</p>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location (display)</label>
                                            <input {...form.register("location")} type="text" className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="e.g. Austin, TX" />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Gym Name</label>
                                            <input {...form.register("gymName")} type="text" className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="e.g. Gold's Gym" />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">City <span className="font-normal text-zinc-400">(for local search)</span></label>
                                            <input {...form.register("city")} type="text" className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="e.g. Austin" />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">State / Province <span className="font-normal text-zinc-400">(for local search)</span></label>
                                            <input {...form.register("state")} type="text" className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="e.g. TX" />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Years Coaching</label>
                                            <input {...form.register("yearsCoaching", { valueAsNumber: true })} type="number" min={0} max={50} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100" placeholder="e.g. 5" />
                                        </div>
                                    </div>
                                </div>

                                {/* ── Services Offered ── */}
                                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Services Offered</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {SERVICES_OPTIONS.map((service) => {
                                            const services = form.watch("services") ?? [];
                                            const checked = services.includes(service);
                                            return (
                                                <label key={service} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={(e) => {
                                                            const next = e.target.checked
                                                                ? [...services, service]
                                                                : services.filter((s: string) => s !== service);
                                                            form.setValue("services", next, { shouldDirty: true });
                                                        }}
                                                        className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600"
                                                    />
                                                    <span className="text-zinc-700 dark:text-zinc-300">{service}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ── Client Goals ── */}
                                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Client Goals Supported</p>
                                    <div className="flex flex-wrap gap-2">
                                        {GOALS_OPTIONS.map((goal) => {
                                            const goals = form.watch("clientGoals") ?? [];
                                            const active = goals.includes(goal);
                                            return (
                                                <button
                                                    key={goal}
                                                    type="button"
                                                    onClick={() => {
                                                        const next = active
                                                            ? goals.filter((g: string) => g !== goal)
                                                            : [...goals, goal];
                                                        form.setValue("clientGoals", next, { shouldDirty: true });
                                                    }}
                                                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors border ${active
                                                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                                                        : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                                                    }`}
                                                >
                                                    {active ? "✓ " : ""}{goal}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ── Client Types ── */}
                                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Client Experience Levels</p>
                                    <div className="flex flex-wrap gap-2">
                                        {CLIENT_TYPES_OPTIONS.map((type) => {
                                            const types = form.watch("clientTypes") ?? [];
                                            const active = types.includes(type);
                                            return (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => {
                                                        const next = active
                                                            ? types.filter((t: string) => t !== type)
                                                            : [...types, type];
                                                        form.setValue("clientTypes", next, { shouldDirty: true });
                                                    }}
                                                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors border ${active
                                                        ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                                                        : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                                                    }`}
                                                >
                                                    {active ? "✓ " : ""}{type}
                                                </button>
                                            );
                                        })}
                                    </div>
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

function ModalWrapper({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return createPortal(<>{children}</>, document.body);
}
