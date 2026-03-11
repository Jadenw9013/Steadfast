"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { useState } from "react";
import { upsertMyOnboardingForm } from "@/app/actions/onboarding-forms";
import { upsertOnboardingFormSchema } from "@/lib/validations/onboarding-form";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Trash2Icon(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ArrowUpIcon(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ArrowDownIcon(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PlusIcon(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>; }

// For generating random IDs for new questions
function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OnboardingEditor({ initialData }: { initialData: any }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // Parse options from string array to comma-separated string for editing
    const defaultQuestions = Array.isArray(initialData?.questions)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (initialData.questions as any[]).map((q: any) => ({
            ...q,
            optionsString: Array.isArray(q.options) ? q.options.join(", ") : ""
        }))
        : [];

    const form = useForm({
        defaultValues: {
            isActive: initialData?.isActive ?? true,
            questions: defaultQuestions,
        },
    });

    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: "questions",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function onSubmit(rawValues: any) {
        setIsSubmitting(true);
        setMessage(null);

        try {
            // Transform optionString back to options array
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transformedQuestions = rawValues.questions.map((q: any) => {
                const base = {
                    id: q.id,
                    type: q.type,
                    label: q.label,
                    required: q.required,
                };

                if (q.type === "multipleChoice" && q.optionsString) {
                    return {
                        ...base,
                        options: q.optionsString.split(",").map((s: string) => s.trim()).filter(Boolean)
                    };
                }

                return base;
            });

            // Re-validate against the strict zod schema
            const validated = upsertOnboardingFormSchema.parse({
                isActive: rawValues.isActive,
                questions: transformedQuestions
            });

            await upsertMyOnboardingForm(validated);

            setMessage({ type: "success", text: "Questionnaire saved successfully." });
        } catch (err: unknown) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save questionnaire." });
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {message?.type === "error" && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {message.text}
                </div>
            )}
            {message?.type === "success" && (
                <div className="rounded-md bg-green-50 p-4 text-sm text-green-600 dark:bg-green-900/20 dark:text-green-400">
                    {message.text}
                </div>
            )}

            <div className="flex items-center gap-3 py-2 border-b border-zinc-200 dark:border-zinc-800 pb-4">
                <input
                    {...form.register("isActive")}
                    id="isActive"
                    type="checkbox"
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815]"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Require new clients to complete this intake questionnaire
                </label>
            </div>

            <div className="space-y-4">
                {fields.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">No questions added yet.</p>
                    </div>
                ) : (
                    fields.map((field, index) => {
                        const type = form.watch(`questions.${index}.type`);
                        return (
                            <div key={field.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-[#0a1224]">

                                {/* Hidden input to track generated ID logic across reorders without conflicts */}
                                <input type="hidden" {...form.register(`questions.${index}.id`)} />

                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 space-y-4">

                                        <div className="flex flex-col sm:flex-row gap-4">
                                            <div className="flex-1">
                                                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    Question Text
                                                </label>
                                                <input
                                                    {...form.register(`questions.${index}.label`)}
                                                    placeholder="e.g. What are your primary fitness goals?"
                                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                                />
                                            </div>

                                            <div className="w-full sm:w-48">
                                                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    Type
                                                </label>
                                                <select
                                                    {...form.register(`questions.${index}.type`)}
                                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                                >
                                                    <option value="shortText">Short Text</option>
                                                    <option value="longText">Long Text</option>
                                                    <option value="number">Number</option>
                                                    <option value="multipleChoice">Multiple Choice</option>
                                                    <option value="boolean">Yes / No</option>
                                                </select>
                                            </div>
                                        </div>

                                        {type === "multipleChoice" && (
                                            <div>
                                                <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                                    Options (comma separated)
                                                </label>
                                                <input
                                                    {...form.register(`questions.${index}.optionsString`)}
                                                    placeholder="Option A, Option B, Option C"
                                                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                                                />
                                            </div>
                                        )}

                                        <div className="flex items-center gap-2">
                                            <input
                                                {...form.register(`questions.${index}.required`)}
                                                type="checkbox"
                                                id={`req-${field.id}`}
                                                className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815]"
                                            />
                                            <label htmlFor={`req-${field.id}`} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                                Required Question
                                            </label>
                                        </div>

                                    </div>

                                    <div className="flex shrink-0 flex-col items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => move(index, index - 1)}
                                            disabled={index === 0}
                                            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                        >
                                            <ArrowUpIcon className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => remove(index)}
                                            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                        >
                                            <Trash2Icon className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => move(index, index + 1)}
                                            disabled={index === fields.length - 1}
                                            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                        >
                                            <ArrowDownIcon className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <button
                type="button"
                onClick={() => append({ id: generateId(), type: "shortText", label: "", required: false, optionsString: "" })}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 py-4 text-sm font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-[#0a1224]/50 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-[#0a1224]"
            >
                <PlusIcon className="h-4 w-4" />
                Add Question
            </button>

            <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
                >
                    {isSubmitting ? "Saving..." : "Save Questionnaire"}
                </button>
            </div>
        </form>
    );
}
