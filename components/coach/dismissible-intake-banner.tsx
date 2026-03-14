"use client";

import { useState, useEffect } from "react";
import { SendIntakeButton } from "@/components/coach/send-intake-button";

function storageKey(clientId: string) {
  return `intake-banner-dismissed:${clientId}`;
}

export function DismissibleIntakeBanner({ clientId }: { clientId: string }) {
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // We defer the execution to correctly hydrate first without synchronous triggers.
    const timeout = setTimeout(() => {
      const stored = localStorage.getItem(storageKey(clientId));
      if (stored === "1") {
        setDismissed(true);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timeout);
  }, [clientId]);

  function handleDismiss() {
    localStorage.setItem(storageKey(clientId), "1");
    setDismissed(true);
  }

  if (!hydrated || dismissed) return null;

  return (
    <div className="relative rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-8 dark:border-zinc-700 dark:bg-zinc-900">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        aria-label="Dismiss"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        No starting data yet
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        This client hasn&rsquo;t submitted any information yet. Send them an intake
        questionnaire to collect their baseline stats, goals, and diet details.
      </p>
      <div className="mt-4">
        <SendIntakeButton clientId={clientId} />
      </div>
    </div>
  );
}
