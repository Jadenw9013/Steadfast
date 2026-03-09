"use client";

import { useState, useRef, useCallback } from "react";
import { InboxClientCard, type InboxClient } from "./inbox-client-card";

type Filter = "all" | "new" | "reviewed" | "missing";

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "reviewed", label: "Reviewed" },
  { key: "missing", label: "Missing" },
];

export function CoachInbox({ clients }: { clients: InboxClient[] }) {
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const filtered =
    activeFilter === "all"
      ? clients
      : clients.filter((c) => c.weekStatus === activeFilter);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % filters.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + filters.length) % filters.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = filters.length - 1;
      }
      if (nextIndex !== null) {
        setActiveFilter(filters[nextIndex].key);
        tabsRef.current[nextIndex]?.focus();
      }
    },
    []
  );

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div
        className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/60"
        role="tablist"
        aria-label="Filter clients"
      >
        {filters.map((f, i) => {
          const count =
            f.key === "all"
              ? clients.length
              : clients.filter((c) => c.weekStatus === f.key).length;
          return (
            <button
              key={f.key}
              ref={(el) => { tabsRef.current[i] = el; }}
              role="tab"
              aria-selected={activeFilter === f.key}
              tabIndex={activeFilter === f.key ? 0 : -1}
              onClick={() => setActiveFilter(f.key)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${activeFilter === f.key
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
            >
              {f.label}
              <span className={`ml-1.5 inline-block min-w-[1.25rem] rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${f.key === "new" ? "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
                  : f.key === "reviewed" ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                    : f.key === "missing" ? "bg-zinc-200/60 text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400"
                      : "bg-zinc-200/60 dark:bg-zinc-700/60"
                }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Client cards */}
      <div role="tabpanel">
        {filtered.length === 0 ? (
          <div className="animate-fade-in flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-16 dark:border-zinc-700">
            <p className="text-sm font-medium text-zinc-400">No clients match this filter</p>
            <p className="text-xs text-zinc-400/70">Try selecting a different category above.</p>
          </div>
        ) : (
          <div className="stagger-children space-y-3">
            {filtered.map((client) => (
              <InboxClientCard key={client.id} client={client} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
