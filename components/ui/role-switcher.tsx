"use client";

import { setActiveRole } from "@/app/actions/roles";
import { useState } from "react";

export function RoleSwitcher({
  currentRole,
}: {
  currentRole: "coach" | "client";
}) {
  const [switching, setSwitching] = useState(false);

  const targetRole = currentRole === "coach" ? "CLIENT" : "COACH";
  const label =
    currentRole === "coach" ? "Switch to Client" : "Switch to Coach";

  async function handleSwitch() {
    setSwitching(true);
    try {
      await setActiveRole({ role: targetRole });
    } catch {
      // redirect throws NEXT_REDIRECT — expected behavior
    } finally {
      setSwitching(false);
    }
  }

  return (
    <button
      onClick={handleSwitch}
      disabled={switching}
      aria-label={label}
      className="min-h-[44px] rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {switching ? "Switching..." : label}
    </button>
  );
}
