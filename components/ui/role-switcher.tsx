"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Optimistic, instant role switcher.
 *
 * Calls the lightweight API route (PATCH) instead of a heavy server action,
 * then does a client-side navigation — feels instant.
 */
export function RoleSwitcher({
  currentRole,
}: {
  currentRole: "coach" | "client";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const targetRole = currentRole === "coach" ? "CLIENT" : "COACH";
  const label =
    currentRole === "coach" ? "Switch to Client" : "Switch to Coach";
  const targetPath =
    targetRole === "COACH" ? "/coach/dashboard" : "/client";

  function handleSwitch() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/switch-role", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: targetRole }),
        });

        if (!res.ok) {
          console.error("Role switch failed:", await res.text());
          return;
        }

        // Navigate client-side — much faster than server redirect
        router.push(targetPath);
        router.refresh();
      } catch (err) {
        console.error("Role switch error:", err);
      }
    });
  }

  return (
    <button
      onClick={handleSwitch}
      disabled={isPending}
      aria-label={label}
      className="hidden sm:inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/[0.08] hover:text-blue-300 disabled:opacity-40 disabled:cursor-wait"
    >
      {isPending ? (
        <span className="flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Switching…
        </span>
      ) : (
        label
      )}
    </button>
  );
}
