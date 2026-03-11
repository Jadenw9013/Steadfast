"use client";

import { useState } from "react";
import { sendClientIntake, resendClientIntake } from "@/app/actions/client-intake";

interface SendIntakeButtonProps {
  clientId: string;
  isResend?: boolean;
}

export function SendIntakeButton({ clientId, isResend = false }: SendIntakeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      if (isResend) {
        await resendClientIntake(clientId);
      } else {
        await sendClientIntake(clientId);
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {isResend ? "Resent" : "Sent"}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={
          isResend
            ? "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            : "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
        }
      >
        {loading
          ? "Sending…"
          : isResend
          ? "Resend Intake"
          : "Send Intake Questionnaire"}
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
