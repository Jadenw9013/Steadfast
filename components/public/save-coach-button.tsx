"use client";

import { useState, useTransition } from "react";
import { toggleSavedCoach } from "@/app/actions/saved-coaches";

interface SaveCoachButtonProps {
    coachProfileId: string;
    initialSaved: boolean;
    size?: "sm" | "md";
}

export function SaveCoachButton({ coachProfileId, initialSaved, size = "sm" }: SaveCoachButtonProps) {
    const [saved, setSaved] = useState(initialSaved);
    const [isPending, startTransition] = useTransition();

    function handleToggle() {
        startTransition(async () => {
            try {
                const result = await toggleSavedCoach({ coachProfileId });
                setSaved(result.saved);
            } catch {
                // Silently fail — button will stay in current state
            }
        });
    }

    const iconSize = size === "md" ? 20 : 16;

    return (
        <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggle(); }}
            disabled={isPending}
            title={saved ? "Remove from saved" : "Save coach"}
            aria-label={saved ? "Remove from saved" : "Save coach"}
            className={`group inline-flex items-center justify-center rounded-full transition-all disabled:opacity-50 ${
                size === "md"
                    ? "h-10 w-10"
                    : "h-8 w-8"
            } ${
                saved
                    ? "bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                    : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200 hover:text-red-500 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-red-400"
            }`}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width={iconSize}
                height={iconSize}
                viewBox="0 0 24 24"
                fill={saved ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${saved ? "scale-110" : "group-hover:scale-110"}`}
            >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
            </svg>
        </button>
    );
}
