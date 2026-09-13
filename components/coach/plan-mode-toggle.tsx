"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setClientPlanMode } from "@/app/actions/plan-mode";

type PlanMode = "MEAL_PLAN" | "MACROS";

const OPTIONS: { value: PlanMode; label: string; sub: string }[] = [
  { value: "MEAL_PLAN", label: "Meal Plan", sub: "Foods & portions" },
  { value: "MACROS", label: "Macros Only", sub: "Targets, no foods" },
];

export function PlanModeToggle({ clientId, initialMode }: { clientId: string; initialMode: PlanMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<PlanMode>(initialMode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const activeIndex = OPTIONS.findIndex((o) => o.value === mode);

  function handleSelect(next: PlanMode) {
    if (next === mode || pending) return;
    const previous = mode;
    setMode(next);
    setError(null);
    startTransition(async () => {
      const result = await setClientPlanMode({ clientId, mode: next });
      if (result?.error) {
        setMode(previous);
        setError("Could not update. Please try again.");
        return;
      }
      // Re-fetch the effective plan server-side so the editor below picks up
      // the new mode (items vs. macroTargets) immediately.
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Plan Type</p>
      <div
        role="radiogroup"
        aria-label="Meal plan display mode"
        className="relative grid grid-cols-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1"
      >
        {/* Sliding active-pill background */}
        <div
          aria-hidden
          className="absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-blue-500/20 shadow-sm shadow-blue-500/10 transition-transform duration-200 ease-out"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
        {OPTIONS.map((option) => {
          const isActive = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={pending}
              onClick={() => handleSelect(option.value)}
              className={`relative z-10 flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-center transition-colors disabled:cursor-not-allowed ${
                isActive ? "text-blue-200" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="text-sm font-bold">{option.label}</span>
              <span className="text-[10px] font-medium opacity-80">{option.sub}</span>
            </button>
          );
        })}
      </div>
      {pending && <p className="text-[11px] text-zinc-500">Saving…</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
