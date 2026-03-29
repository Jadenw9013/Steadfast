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
      className="sf-button-secondary !min-h-[44px] !px-3 !py-2 text-xs"
    >
      {switching ? "Switching..." : label}
    </button>
  );
}
