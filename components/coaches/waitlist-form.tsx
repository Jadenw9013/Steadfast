"use client";

import { useState } from "react";
import { submitWaitlistEntry } from "@/app/actions/coaching-requests";

export function WaitlistForm({ coachProfileId }: { coachProfileId: string }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        const formData = new FormData(e.currentTarget);

        try {
            await submitWaitlistEntry({
                coachProfileId,
                prospectName: formData.get("name") as string,
                prospectEmail: formData.get("email") as string,
                note: (formData.get("note") as string) || undefined,
            });
            setSubmitted(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    }

    if (submitted) {
        return (
            <div className="text-center py-4">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                        <path d="M20 6 9 17l-5-5" />
                    </svg>
                </div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    You&apos;re on the list!
                </h3>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    We&apos;ll let you know when a spot opens up. Check your email for a confirmation.
                </p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            <div>
                <label htmlFor="waitlist-name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Name
                </label>
                <input
                    id="waitlist-name"
                    name="name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                    placeholder="Your name"
                />
            </div>

            <div>
                <label htmlFor="waitlist-email" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Email
                </label>
                <input
                    id="waitlist-email"
                    name="email"
                    type="email"
                    required
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                    placeholder="you@example.com"
                />
            </div>

            <div>
                <label htmlFor="waitlist-note" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Quick note <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <textarea
                    id="waitlist-note"
                    name="note"
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-[#020815] dark:text-zinc-100"
                    placeholder="What are you looking for help with?"
                />
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-zinc-700 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
            >
                {isSubmitting ? "Joining..." : "Join Waitlist"}
            </button>
        </form>
    );
}
