"use client";

import { useForm } from "react-hook-form";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOnboardingResponse } from "@/app/actions/client-onboarding";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ClientOnboardingForm({ form: dbForm }: { form: any }) {
    const router = useRouter();
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
                if (answer === undefined || answer === null || (typeof answer === "number" && Number.isNaN(answer))) {
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

            const result = await submitOnboardingResponse({
                formId: dbForm.id,
                answers
            });
            if (!result.success) {
                setError(result.message);
                setIsSubmitting(false);
                return;
            }
            router.push("/client");
            router.refresh();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to submit answers");
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {error && (
                <div className="rounded-xl bg-red-500/15 p-4 text-sm text-red-400">
                    {error}
                </div>
            )}

            <div className="space-y-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
                {questions.map((q) => (
                    <div key={q.id} className="border-b border-white/[0.06] pb-6 last:border-0 last:pb-0">
                        <label className="mb-2 block text-sm font-medium text-zinc-100">
                            {q.label}
                            {q.required && <span className="ml-1 text-red-400">*</span>}
                        </label>

                        {q.type === "shortText" && (
                            <input
                                {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                type="text"
                                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                                style={{ fontSize: "max(1rem, 16px)" }}
                            />
                        )}

                        {q.type === "longText" && (
                            <textarea
                                {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                rows={4}
                                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                                style={{ fontSize: "max(1rem, 16px)" }}
                            />
                        )}

                        {q.type === "number" && (
                            <input
                                {...form.register(q.id, {
                                    required: q.required ? "This is required" : false,
                                    valueAsNumber: true
                                })}
                                type="number"
                                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                                style={{ fontSize: "max(1rem, 16px)" }}
                            />
                        )}

                        {q.type === "boolean" && (
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2 text-sm text-zinc-300">
                                    <input
                                        {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                        type="radio"
                                        value="true"
                                        className="text-zinc-100 focus:ring-zinc-500"
                                    />
                                    Yes
                                </label>
                                <label className="flex items-center gap-2 text-sm text-zinc-300">
                                    <input
                                        {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                        type="radio"
                                        value="false"
                                        className="text-zinc-100 focus:ring-zinc-500"
                                    />
                                    No
                                </label>
                            </div>
                        )}

                        {q.type === "multipleChoice" && q.options && (
                            <div className="space-y-2">
                                {q.options.map((opt: string, i: number) => (
                                    <label key={i} className="flex items-center gap-2 text-sm text-zinc-300">
                                        <input
                                            {...form.register(q.id, { required: q.required ? "This is required" : false })}
                                            type="radio"
                                            value={opt}
                                            className="text-zinc-100 focus:ring-zinc-500"
                                        />
                                        {opt}
                                    </label>
                                ))}
                            </div>
                        )}

                        {form.formState.errors[q.id] && (
                            <p className="mt-1 text-xs text-red-400">
                                {form.formState.errors[q.id]?.message as string}
                            </p>
                        )}
                    </div>
                ))}
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50"
            >
                {isSubmitting ? "Submitting..." : "Complete Onboarding"}
            </button>
        </form>
    );
}
