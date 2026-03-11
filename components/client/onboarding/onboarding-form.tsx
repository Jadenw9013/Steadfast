"use client";

import { useForm } from "react-hook-form";
import { useState } from "react";
import { submitOnboardingResponse } from "@/app/actions/client-onboarding";
import { OnboardingQuestion } from "@/lib/validations/onboarding-form";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ClientOnboardingForm({ form: dbForm }: { form: any }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const questions = dbForm?.questions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (dbForm.questions as any[])
        : []; // Added a default empty array if dbForm or questions is undefined

    const form = useForm();

    async function onSubmit(data: Record<string, string | number | boolean | string[]>) {
        setIsSubmitting(true);
        setError(null);

        try {
            // Map react-hook-form flat structure to answers array
            const answers = questions.map((q) => {
                let answer = data[q.id];
                // Ensure defaults for specific types
                if (answer === undefined || answer === null) {
                    answer = q.type === "boolean" ? false : "";
                }

                // If boolean came through as string (radio button), fix typed value
                if (q.type === "boolean" && typeof answer === "string") {
                    answer = answer === "true";
                }

                return {
                    questionId: q.id as string,
                    answer: answer as string | number | boolean | string[]
                };
            });

            await submitOnboardingResponse({
                formId: dbForm.id,
                answers
            });
            // The action will automatically redirect to dashboard
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to submit answers");
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {error && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            <div className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0a1224]">
                {questions.map((q) => (
                    <div key={q.id} className="border-b border-zinc-100 pb-6 last:border-0 last:pb-0 dark:border-zinc-800">
                        <label className="mb-2 block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {q.label}
                            {q.required && <span className="ml-1 text-red-500">*</span>}
                        </label>

                        {q.type === "shortText" && (
                            <input
                                {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                type="text"
                                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                            />
                        )}

                        {q.type === "longText" && (
                            <textarea
                                {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                rows={4}
                                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                            />
                        )}

                        {q.type === "number" && (
                            <input
                                {...form.register(q.id, {
                                    required: q.required ? "This is required" : false,
                                    valueAsNumber: true
                                })}
                                type="number"
                                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                            />
                        )}

                        {q.type === "boolean" && (
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                    <input
                                        {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                        type="radio"
                                        value="true"
                                        className="text-zinc-900 focus:ring-zinc-500 dark:bg-[#020815]"
                                    />
                                    Yes
                                </label>
                                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                    <input
                                        {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                        type="radio"
                                        value="false"
                                        className="text-zinc-900 focus:ring-zinc-500 dark:bg-[#020815]"
                                    />
                                    No
                                </label>
                            </div>
                        )}

                        {q.type === "multipleChoice" && q.options && (
                            <div className="space-y-2">
                                {q.options.map((opt: string, i: number) => (
                                    <label key={i} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                        <input
                                            {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                            type="radio"
                                            value={opt}
                                            className="text-zinc-900 focus:ring-zinc-500 dark:bg-[#020815]"
                                        />
                                        {opt}
                                    </label>
                                ))}
                            </div>
                        )}

                        {form.formState.errors[q.id] && (
                            <p className="mt-1 text-xs text-red-600">
                                {form.formState.errors[q.id]?.message as string}
                            </p>
                        )}
                    </div>
                ))}
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
            >
                {isSubmitting ? "Submitting..." : "Complete Onboarding"}
            </button>
        </form>
    );
}
