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
            <div
                className="relative overflow-hidden rounded-2xl border px-5 py-4"
                style={{
                    background: `linear-gradient(135deg, rgba(16,37,33,0.18), transparent), rgba(0,0,0,0.18)`,
                    borderColor: `rgba(34,197,94,0.20)`,
                    backdropFilter: `blur(20px) saturate(180%)`,
                    WebkitBackdropFilter: `blur(20px) saturate(180%)`,
                }}
            >
                {/* Subtle top-edge glow */}
                <div
                    className="absolute top-0 left-0 right-0 h-px"
                    style={{
                        background: `linear-gradient(to right, transparent, rgba(34,197,94,0.35), transparent)`,
                    }}
                />
                <div className="flex items-center gap-3">
                    <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{
                            background: `rgba(34,197,94,0.12)`,
                            border: `1px solid rgba(34,197,94,0.20)`,
                        }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#4ADE80' }}><path d="M20 6 9 17l-5-5" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium" style={{ color: '#E8EAEE' }}>
                            You&apos;ve reviewed {coachName}
                        </p>
                        <p className="mt-0.5 text-xs" style={{ color: 'rgba(174,181,194,0.7)' }}>
                            Thanks for sharing your experience!
                        </p>
                    </div>
                    <Link
                        href={`/client/coach/${coachId}/review`}
                        className="shrink-0 text-xs font-semibold transition-colors hover:brightness-125"
                        style={{ color: '#4ADE80' }}
                    >
                        Edit Review
                    </Link>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss"
                        className="shrink-0 rounded-lg p-1.5 transition-colors"
                        style={{ color: 'rgba(174,181,194,0.5)' }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                            e.currentTarget.style.color = 'rgba(174,181,194,0.8)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'rgba(174,181,194,0.5)';
                        }}
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
            className="group relative block overflow-hidden rounded-2xl border transition-all"
            style={{
                background: `linear-gradient(135deg, rgba(255,255,255,0.055), rgba(59,91,219,0.08), transparent), rgba(0,0,0,0.18)`,
                borderColor: `rgba(255,255,255,0.12)`,
                backdropFilter: `blur(20px) saturate(180%)`,
                WebkitBackdropFilter: `blur(20px) saturate(180%)`,
                padding: '16px 20px',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(59,91,219,0.35)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(59,91,219,0.12), 0 0 0 1px rgba(59,91,219,0.08)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.boxShadow = 'none';
            }}
        >
            {/* Top accent edge glow */}
            <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                    background: `linear-gradient(to right, transparent, rgba(91,124,250,0.32), transparent)`,
                }}
            />
            {/* Radial glow behind star */}
            <div
                className="pointer-events-none absolute -left-8 -top-8 h-32 w-32 opacity-40"
                style={{
                    background: `radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)`,
                }}
            />
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                    {/* Star icon container with warm glow */}
                    <div
                        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{
                            background: `linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,191,36,0.06))`,
                            border: `1px solid rgba(251,191,36,0.18)`,
                        }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#FBBF24' }}>
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: '#FFFFFF' }}>
                            Rate {coachName}
                        </p>
                        <p className="mt-0.5 hidden text-xs sm:block" style={{ color: '#AEB5C2' }}>
                            Help others find the right coach with a verified review
                        </p>
                    </div>
                </div>
                {/* CTA pill button */}
                <span
                    className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all group-hover:shadow-lg"
                    style={{
                        background: `linear-gradient(to right, #223B8F, #3B5BDB, #223B8F)`,
                        color: '#FFFFFF',
                        border: `1px solid rgba(59,91,219,0.50)`,
                        boxShadow: `0 2px 8px rgba(59,91,219,0.25)`,
                    }}
                >
                    <span className="sm:hidden">Rate →</span>
                    <span className="hidden sm:inline">Leave Review →</span>
                </span>
            </div>
        </Link>
    );
}
