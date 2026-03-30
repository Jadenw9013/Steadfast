"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";

/**
 * Optimistic, instant role switcher.
 *
 * Calls the lightweight API route (PATCH) then does a client-side replacement.
 * Variant "inline" renders as a small button, "row" renders as a full-width clickable row.
 */
export function RoleSwitcher({
  currentRole,
  variant = "inline",
}: {
  currentRole: "coach" | "client";
  variant?: "inline" | "row";
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const targetRole = currentRole === "coach" ? "CLIENT" : "COACH";
  const label =
    currentRole === "coach" ? "Switch to Client" : "Switch to Coach";
  const targetPath =
    targetRole === "COACH" ? "/coach/dashboard" : "/client";

  const handleSwitch = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);

    try {
      const res = await fetch("/api/switch-role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      });

      if (!res.ok) {
        console.error("Role switch failed:", await res.text());
        setIsPending(false);
        return;
      }

      // Use replace for instant navigation — no history entry
      router.replace(targetPath);
      router.refresh();
    } catch (err) {
      console.error("Role switch error:", err);
      setIsPending(false);
    }
  }, [isPending, targetRole, targetPath, router]);

  const spinner = (
    <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );

  // ── Row variant: full-width clickable row ───────────────────
  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={handleSwitch}
        disabled={isPending}
        className="group flex w-full items-center gap-4 sf-glass-card p-4 text-left transition-all hover:border-white/[0.16] disabled:opacity-60 disabled:cursor-wait"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5" />
            <path d="M8 21H3v-5" />
            <path d="M21 3l-9 9" />
            <path d="M3 21l9-9" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">{label}</p>
          <p className="text-xs text-zinc-500">
            {currentRole === "coach" ? "View your client dashboard" : "View your coach dashboard"}
          </p>
        </div>
        {isPending ? (
          <span className="flex items-center gap-1.5 text-blue-400">
            {spinner}
            <span className="text-xs">Switching…</span>
          </span>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-zinc-500 transition-colors group-hover:text-zinc-300"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        )}
      </button>
    );
  }

  // ── Inline variant: compact button ─────────────────────────
  return (
    <button
      onClick={handleSwitch}
      disabled={isPending}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/[0.08] hover:text-blue-300 disabled:opacity-40 disabled:cursor-wait"
    >
      {isPending ? (
        <span className="flex items-center gap-1.5">
          {spinner}
          Switching…
        </span>
      ) : (
        label
      )}
    </button>
  );
}
