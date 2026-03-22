"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
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

export function RequestForm({ coachProfileId }: { coachProfileId: string }) {
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(intakeSchema),
        defaultValues: {
            prospectName: "",
            prospectEmail: "",
            prospectPhone: "",
            goals: "",
            experience: "",
            injuries: "",
        },
    });

    async function onSubmit(data: FormValues) {
        setIsSubmitting(true);
        setError(null);

        try {
            await submitCoachingRequest({
                coachProfileId,
                prospectName: data.prospectName,
                prospectEmail: data.prospectPhone, // backwards compat — legacy field stores phone
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

    if (success) {
        return (
            <div className="text-center py-12 animate-fade-in">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-500">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <h2 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                    Request Sent Successfully
                </h2>
                <p className="mt-2 text-zinc-500 dark:text-zinc-400">
                    Check your email for a confirmation. Your coach will review your intake and reach out once they&apos;ve made a decision.
                </p>
                <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
                    This usually takes a few business days. No action needed from you right now.
                </p>
                <Link
                    href="/coaches"
                    className="mt-8 inline-block text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                >
                    Return to Directory
                </Link>
            </div>
        );
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {error && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            <div className="space-y-4">
                <div>
                    <label htmlFor="prospectName" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        {...form.register("prospectName")}
                        id="prospectName"
                        type="text"
                        required
                        autoComplete="name"
                        aria-describedby="prospectName-error"
                        className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                    />
                    {form.formState.errors.prospectName && (
                        <p id="prospectName-error" className="mt-1 text-xs text-red-600">{form.formState.errors.prospectName.message}</p>
                    )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="prospectEmail" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                            {...form.register("prospectEmail")}
                            id="prospectEmail"
                            type="email"
                            required
                            autoComplete="email"
                            aria-describedby="prospectEmail-error"
                            placeholder="you@example.com"
                            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                        />
                        {form.formState.errors.prospectEmail && (
                            <p id="prospectEmail-error" className="mt-1 text-xs text-red-600">{form.formState.errors.prospectEmail.message}</p>
                        )}
                    </div>

                    <div>
                        <label htmlFor="prospectPhone" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            {...form.register("prospectPhone")}
                            id="prospectPhone"
                            type="tel"
                            required
                            autoComplete="tel"
                            aria-describedby="prospectPhone-error"
                            placeholder="e.g. (512) 555-0100"
                            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                        />
                        {form.formState.errors.prospectPhone && (
                            <p id="prospectPhone-error" className="mt-1 text-xs text-red-600">{form.formState.errors.prospectPhone.message}</p>
                        )}
                    </div>
                </div>
            </div>

            <div className="border-t border-zinc-200/60 pt-6 dark:border-zinc-800/60">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">Intake Questionnaire</h3>

                <div className="space-y-6">
                    <div>
                        <label htmlFor="goals" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            What are your primary goals? <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            {...form.register("goals")}
                            id="goals"
                            rows={4}
                            required
                            aria-describedby="goals-error"
                            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                            placeholder="e.g. Lose 10lbs, increase squat max, prep for a show..."
                        />
                        {form.formState.errors.goals && (
                            <p id="goals-error" className="mt-1 text-xs text-red-600">{form.formState.errors.goals.message}</p>
                        )}
                    </div>

                    <div>
                        <label htmlFor="experience" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Brief training & dietary experience
                        </label>
                        <textarea
                            {...form.register("experience")}
                            id="experience"
                            rows={3}
                            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                            placeholder="How many years have you been training?"
                        />
                    </div>

                    <div>
                        <label htmlFor="injuries" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Current injuries or limitations
                        </label>
                        <input
                            {...form.register("injuries")}
                            id="injuries"
                            type="text"
                            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                            placeholder="e.g. Lower back pain during deadlifts"
                        />
                    </div>
                </div>
            </div>

            <div className="pt-4">
                <p className="mb-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    By submitting this request, you agree to our{" "}
                    <Link href="/terms" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">Terms of Service</Link>
                    {" "}and{" "}
                    <Link href="/privacy" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">Privacy Policy</Link>.
                </p>
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-xl bg-zinc-900 px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
                >
                    {isSubmitting ? "Submitting..." : "Submit Coaching Request"}
                </button>
            </div>
        </form>
    );
}
