"use client";

import { useState } from "react";
import Link from "next/link";
import { DeleteCheckInButton } from "@/components/client/delete-check-in-button";

type CheckInItem = {
  id: string;
  weight: number | null;
  status: string;
  notes: string | null;
  submittedAt: string; // ISO string for serialization
  _count: { photos: number };
};

export function RecentCheckIns({ checkIns }: { checkIns: CheckInItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section
      className="animate-fade-in"
      style={{ animationDelay: "400ms" }}
      aria-labelledby="checkins-heading"
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group mb-3 flex w-full items-center justify-between rounded-xl px-1 py-2 text-left transition-colors hover:bg-white/[0.03]"
        aria-expanded={isOpen}
        aria-controls="checkins-content"
      >
        <h2
          id="checkins-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Recent Check-Ins
          <span className="ml-2 text-sm font-normal text-zinc-500">
            ({checkIns.length})
          </span>
        </h2>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-zinc-500 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:text-zinc-300 ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Collapsible content */}
      <div
        id="checkins-content"
        className={`grid transition-all duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {checkIns.length === 0 ? (
            <div className="sf-surface-card flex flex-col items-center gap-4 px-8 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /></svg>
              </div>
              <div>
                <p className="text-sm font-semibold">No check-ins yet</p>
                <Link
                  href="/client/check-in"
                  className="mt-1.5 inline-block text-sm font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  Submit your first check-in
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {checkIns.map((checkIn, idx) => {
                const prev = checkIns[idx + 1];
                const delta =
                  prev?.weight && checkIn.weight
                    ? +(checkIn.weight - prev.weight).toFixed(1)
                    : null;

                const dateLabel = new Date(checkIn.submittedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });

                return (
                  <div
                    key={checkIn.id}
                    className="relative sf-glass-card transition-all hover:border-blue-500/20"
                  >
                    {/* Overflow menu — top right */}
                    <div className="absolute right-1 top-1 z-10 sm:right-2 sm:top-2">
                      <DeleteCheckInButton checkInId={checkIn.id} />
                    </div>

                    <Link
                      href={`/client/check-ins/${checkIn.id}`}
                      className="block rounded-2xl px-4 py-3.5 pr-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 sm:px-5 sm:py-4"
                      aria-label={`View check-in from ${dateLabel}`}
                    >
                      {/* Mobile: stacked | Desktop: horizontal */}
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                        {/* Weight + delta */}
                        <div className="flex items-baseline gap-2">
                          {checkIn.weight ? (
                            <p className="text-xl font-bold tabular-nums leading-tight tracking-tight">
                              {checkIn.weight}
                              <span className="ml-0.5 text-[10px] font-normal text-zinc-400">lbs</span>
                            </p>
                          ) : (
                            <p className="text-xl font-bold text-zinc-700">
                              &mdash;
                            </p>
                          )}
                          {delta != null && delta !== 0 && (
                            <span
                              className={`text-xs font-semibold ${delta < 0
                                ? "text-emerald-500"
                                : "text-red-400"
                                }`}
                            >
                              {delta < 0 ? "\u2193" : "\u2191"} {Math.abs(delta)}
                            </span>
                          )}
                        </div>

                        {/* Date + meta row */}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-300">
                            {dateLabel}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                            {checkIn._count.photos > 0 && (
                              <span>{checkIn._count.photos} photo{checkIn._count.photos > 1 ? "s" : ""}</span>
                            )}
                            {checkIn.notes && (
                              <span className="truncate max-w-[200px] sm:max-w-[180px]">{checkIn.notes}</span>
                            )}
                          </div>
                        </div>

                        {/* Status badge */}
                        <span
                          className={`self-start shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold mr-10 sm:self-center ${checkIn.status === "REVIEWED"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-amber-500/20 text-amber-400"
                            }`}
                        >
                          {checkIn.status === "REVIEWED" ? "Reviewed" : "Pending"}
                        </span>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
