"use client";

import { useState, useRef, useEffect } from "react";

const SECTIONS = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    label: "Rules & Guidelines",
    color: "text-blue-400 bg-blue-500/10",
    description: "Dietary rules and habits your client should follow — meal timing windows, food swaps, portion guidelines, weekend flexibility, or any coaching directives that apply to the whole plan.",
    examples: ["Eat every 3–4 hours", "No eating 2 hrs before bed", "Drink 3L water daily"],
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" />
      </svg>
    ),
    label: "Supplements",
    color: "text-emerald-400 bg-emerald-500/10",
    description: "Supplement protocols to follow alongside the nutrition plan. Specify names, doses, and when to take them so clients always know exactly what to do.",
    examples: ["Creatine 5g — post-workout", "Whey protein — AM", "Magnesium — before bed"],
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    label: "Day Overrides",
    color: "text-amber-400 bg-amber-500/10",
    description: "Define different eating patterns for specific days — like high-carb training days vs. low-carb rest days. Color-coded labels make the schedule immediately readable.",
    examples: ["High Carb — Mon/Wed/Fri", "Low Carb — Tue/Thu", "Refeed Day — Sunday"],
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    label: "Plan Metadata",
    color: "text-purple-400 bg-purple-500/10",
    description: "Optional phase label and private coach notes — useful for tracking what program phase this plan belongs to and leaving context notes for yourself.",
    examples: ["Phase: Cutting Phase 2", "Notes: Client traveling this week"],
  },
];

export function PlanDetailsHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="What does each section do?"
        aria-expanded={open}
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          open
            ? "border-blue-400 bg-blue-500/20 text-blue-300"
            : "border-zinc-600 bg-zinc-800 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200"
        }`}
      >
        ?
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Plan Details section guide"
          className="absolute right-0 top-8 z-50 w-[320px] sm:w-[380px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1829] shadow-2xl shadow-black/50 ring-1 ring-black/20"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Plan Details Guide</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Click a section below to add it</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close guide"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Section list */}
          <div className="divide-y divide-white/[0.04]">
            {SECTIONS.map((s) => (
              <div key={s.label} className="flex gap-3 px-4 py-3.5">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${s.color}`}>
                  {s.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-zinc-100">{s.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{s.description}</p>
                  {/* Example chips */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.examples.map((ex) => (
                      <span
                        key={ex}
                        className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                      >
                        {ex}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer tip */}
          <div className="border-t border-white/[0.06] bg-zinc-900/60 px-4 py-2.5">
            <p className="text-[11px] text-zinc-500">
              <span className="font-medium text-zinc-400">Tip:</span> All sections are optional. Add only what's relevant to your client's plan.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
