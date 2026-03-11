"use client";

import { useState, useTransition } from "react";
import { setAdherenceEnabled } from "@/app/actions/adherence";

interface Props {
  clientId: string;
  initialEnabled: boolean;
}

export function AdherenceToggle({ clientId, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await setAdherenceEnabled({ clientId, enabled: next });
      if (result?.error) {
        setEnabled(!next);
        setError("Could not update setting. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Daily adherence tracking"
          disabled={pending}
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
            enabled
              ? "bg-emerald-500 dark:bg-emerald-600"
              : "bg-zinc-300 dark:bg-zinc-600"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-4 w-4 translate-x-0 rounded-full bg-white shadow-sm ring-0 transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-sm font-medium text-gray-700 dark:text-zinc-200">
          Daily adherence tracking
        </span>
        {pending && (
          <span className="text-xs text-gray-400 dark:text-zinc-500">Saving…</span>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
