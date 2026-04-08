"use client";

import { useState, useRef, useCallback } from "react";
import { InboxClientCard, type InboxClient } from "./inbox-client-card";
import { reorderClients } from "@/app/actions/coach-client";

type Filter = "all" | "new" | "reviewed" | "missing";

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "reviewed", label: "Reviewed" },
  { key: "missing", label: "Missing" },
];

export function CoachInbox({ clients }: { clients: InboxClient[] }) {
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [orderedClients, setOrderedClients] = useState<InboxClient[]>(clients);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const dragIndexRef = useRef<number | null>(null);
  const prevOrderRef = useRef<InboxClient[]>(clients);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDragEnabled = activeFilter === "all" && !query.trim();

  const isMissing = (c: InboxClient) =>
    c.weekStatus === "missing" || c.cadenceStatus === "overdue";

  // Priority order for the "All" tab: overdue → due → submitted/new → upcoming → reviewed
  const STATUS_PRIORITY: Record<string, number> = {
    overdue: 0,
    due: 1,
    missing: 2,
    submitted: 3,
    new: 3,
    upcoming: 4,
    not_due: 4,
    reviewed: 5,
  };

  function getStatusPriority(c: InboxClient): number {
    const key = c.cadenceStatus ?? c.weekStatus;
    return STATUS_PRIORITY[key] ?? 4;
  }

  const tabFiltered =
    activeFilter === "all"
      ? [...orderedClients].sort((a, b) => getStatusPriority(a) - getStatusPriority(b))
      : activeFilter === "missing"
      ? orderedClients.filter(isMissing)
      : activeFilter === "reviewed"
      ? orderedClients.filter((c) => c.weekStatus === "reviewed" && c.cadenceStatus !== "overdue")
      : orderedClients.filter((c) => c.weekStatus === activeFilter);

  const filtered = query.trim()
    ? tabFiltered.filter((c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(query.toLowerCase())
      )
    : tabFiltered;

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

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, clientId: string, index: number) {
    dragIndexRef.current = index;
    prevOrderRef.current = [...orderedClients];
    setDraggingId(clientId);
    e.dataTransfer.effectAllowed = "move";

    // Custom ghost: transparent 1×1 pixel so default browser ghost disappears
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const from = dragIndexRef.current;
    if (from === null || from === index) return;

    setDropTargetIndex(index);
    dragIndexRef.current = index;

    setOrderedClients((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
  }

  function handleDragEnd() {
    const newOrder = [...orderedClients];
    setDraggingId(null);
    setDropTargetIndex(null);
    dragIndexRef.current = null;

    // Debounce the save to avoid hammering on rapid drops
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      reorderClients({ orderedClientIds: newOrder.map((c) => c.id) }).catch(() => {
        setOrderedClients(prevOrderRef.current);
      });
    }, 300);
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          placeholder="Search clients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-white/[0.10] bg-white/[0.05] py-3 pl-10 pr-4 text-sm font-medium text-white placeholder:text-zinc-500 transition-all focus:border-blue-400/40 focus:bg-white/[0.07] focus:outline-none focus:ring-1 focus:ring-blue-400/30"
          style={{ fontSize: "max(1rem, 16px)" }}
          aria-label="Search clients by name"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Clear search"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        )}
      </div>

      {/* Filter bar — horizontally scrollable on mobile */}
      <div
        className="flex gap-1 overflow-x-auto rounded-xl bg-white/[0.04] border border-white/[0.08] p-1.5 scrollbar-none"
        role="tablist"
        aria-label="Filter clients"
      >
        {filters.map((f, i) => {
          const count =
            f.key === "all"
              ? clients.length
              : f.key === "missing"
              ? clients.filter((c) => c.weekStatus === "missing" || c.cadenceStatus === "overdue").length
              : f.key === "reviewed"
              ? clients.filter((c) => c.weekStatus === "reviewed" && c.cadenceStatus !== "overdue").length
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
              className={`min-h-[44px] shrink-0 flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
                activeFilter === f.key
                  ? "bg-white/[0.12] text-white shadow-sm shadow-black/20 border border-white/[0.12]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] border border-transparent"
              }`}
            >
              {f.label}
              <span
                className={`ml-1.5 inline-block min-w-[1.25rem] rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                  f.key === "new"
                    ? "bg-blue-500/20 text-blue-300"
                    : f.key === "reviewed"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : f.key === "missing"
                    ? "bg-red-500/20 text-red-300"
                    : "bg-slate-500/15 text-slate-300"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Client cards */}
      <div role="tabpanel">
        {filtered.length === 0 ? (
          <div className="animate-fade-in sf-surface-card flex flex-col items-center gap-2 py-16">
            <p className="text-sm font-medium text-zinc-300">
              {query ? `No clients match "${query}"` : "No clients match this filter"}
            </p>
            <p className="text-xs text-zinc-400">
              {query ? "Try a different name." : "Try selecting a different category above."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((client, index) => {
              const isDragging = draggingId === client.id;
              const isDropTarget = dropTargetIndex === index && draggingId !== null && !isDragging;

              return (
                <div
                  key={client.id}
                  draggable={isDragEnabled}
                  onDragStart={isDragEnabled ? (e) => handleDragStart(e, client.id, index) : undefined}
                  onDragOver={isDragEnabled ? (e) => handleDragOver(e, index) : undefined}
                  onDragEnd={isDragEnabled ? handleDragEnd : undefined}
                  className={[
                    "group relative transition-all duration-200 ease-out",
                    isDragEnabled ? "cursor-grab active:cursor-grabbing" : "",
                    isDragging ? "opacity-25 scale-[0.97]" : "opacity-100 scale-100",
                  ].join(" ")}
                >
                  {/* Glowing drop indicator line above this card */}
                  {isDropTarget && (
                    <div className="absolute -top-1 left-4 right-4 z-10 flex items-center">
                      <div className="h-[2px] w-full rounded-full bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_8px_2px_rgba(96,165,250,0.35)]" />
                    </div>
                  )}
                  <InboxClientCard client={client} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hint */}
      {isDragEnabled && orderedClients.length > 1 && (
        <p className="text-center text-xs text-zinc-400">
          Drag to reorder · Saved automatically
        </p>
      )}
    </div>
  );
}
