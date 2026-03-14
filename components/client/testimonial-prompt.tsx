"use client";

import { useState } from "react";
import Link from "next/link";

interface TestimonialPromptProps {
    coachId: string;
    coachName: string;
    hasExisting: boolean;
}

export function TestimonialPrompt({ coachId, coachName, hasExisting }: TestimonialPromptProps) {
    const storageKey = `review-banner-dismissed-${coachId}`;
    // Lazy initializer reads localStorage once on mount — avoids hydration mismatch
    // and satisfies the react-hooks/set-state-in-effect rule.
    const [dismissed, setDismissed] = useState(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem(storageKey) === "1";
    });

    function dismiss() {
        localStorage.setItem(storageKey, "1");
        setDismissed(true);
    }

    if (dismissed) return null;

    if (hasExisting) {
        return (
            <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 px-5 py-4 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 dark:text-emerald-400"><path d="M20 6 9 17l-5-5" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                            You&apos;ve reviewed {coachName}
                        </p>
                        <p className="mt-0.5 text-xs text-emerald-600/80 dark:text-emerald-400/70">
                            Thanks for sharing your experience!
                        </p>
                    </div>
                    <Link
                        href={`/client/coach/${coachId}/review`}
                        className="shrink-0 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                        Edit Review
                    </Link>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss"
                        className="shrink-0 rounded-md p-1 text-emerald-600/60 transition-colors hover:bg-emerald-100 hover:text-emerald-700 dark:text-emerald-400/60 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-300"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <Link
            href={`/client/coach/${coachId}/review`}
            className="group block rounded-2xl border border-blue-200/60 bg-blue-50/50 px-5 py-4 transition-all hover:border-blue-300 hover:shadow-sm dark:border-blue-800/40 dark:bg-blue-950/20 dark:hover:border-blue-700"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                            Rate {coachName}
                        </p>
                        <p className="mt-0.5 hidden text-xs text-blue-600/80 sm:block dark:text-blue-400/70">
                            Help others find the right coach with a verified review
                        </p>
                    </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-blue-600 transition-transform group-hover:translate-x-0.5 dark:text-blue-400">
                    <span className="sm:hidden">Rate →</span>
                    <span className="hidden sm:inline">Leave Review →</span>
                </span>
            </div>
        </Link>
    );
}
