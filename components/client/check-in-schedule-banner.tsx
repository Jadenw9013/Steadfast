"use client";

import Link from "next/link";
import type { CadenceStatus } from "@/lib/scheduling/cadence";

export function CheckInScheduleBanner({
  cadenceStatus,
  statusLabel,
  nextDueLabel,
  latestReviewedCheckInId,
}: {
  cadenceStatus: CadenceStatus;
  statusLabel: string;
  nextDueLabel?: string;
  latestReviewedCheckInId?: string;
}) {
  // ── Due: blue CTA ──────────────────────────────────────────────────────────
  if (cadenceStatus === "due") {
    return (
      <Link
        href="/client/check-in"
        className="group block rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50 to-indigo-50/50 px-6 py-4 transition-all hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-blue-800/40 dark:from-blue-950/40 dark:to-indigo-950/20 dark:hover:border-blue-700"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-200/80 dark:bg-blue-800/40">
            <span className="text-sm" aria-hidden="true">{"\uD83D\uDCC5"}</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-blue-800 dark:text-blue-200">
              {statusLabel}
            </p>
            <p className="mt-0.5 text-xs text-blue-600/80 dark:text-blue-400/80">
              Tap to submit your check-in now
            </p>
          </div>
          <span className="text-blue-400 transition-transform group-hover:translate-x-1 dark:text-blue-600" aria-hidden="true">
            &rarr;
          </span>
        </div>
      </Link>
    );
  }

  // ── Overdue: red CTA ───────────────────────────────────────────────────────
  if (cadenceStatus === "overdue") {
    return (
      <Link
        href="/client/check-in"
        className="group block rounded-2xl border border-red-200/80 bg-gradient-to-br from-red-50 to-orange-50/50 px-6 py-4 transition-all hover:border-red-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:border-red-800/40 dark:from-red-950/40 dark:to-orange-950/20 dark:hover:border-red-700"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-200/80 dark:bg-red-800/40">
            <span className="text-sm" aria-hidden="true">{"\u26A0\uFE0F"}</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800 dark:text-red-200">
              {statusLabel}
            </p>
            <p className="mt-0.5 text-xs text-red-600/80 dark:text-red-400/80">
              Tap to submit your check-in now
            </p>
          </div>
          <span className="text-red-400 transition-transform group-hover:translate-x-1 dark:text-red-600" aria-hidden="true">
            &rarr;
          </span>
        </div>
      </Link>
    );
  }

  // ── Submitted: amber static ────────────────────────────────────────────────
  if (cadenceStatus === "submitted") {
    return (
      <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/50 px-6 py-4 dark:border-amber-800/40 dark:from-amber-950/40 dark:to-orange-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-200/80 dark:bg-amber-800/40">
            <span className="text-sm" aria-hidden="true">&#9203;</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
              {statusLabel}
            </p>
            <p className="mt-0.5 text-xs text-amber-600/80 dark:text-amber-400/80">
              {nextDueLabel || "Your coach will review it soon"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Reviewed: green CTA → links to the reviewed check-in ─────────────────
  if (cadenceStatus === "reviewed") {
    const content = (
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-200/80 dark:bg-emerald-800/40">
          <span className="text-sm" aria-hidden="true">&#10003;</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
            Your coach left feedback
          </p>
          <p className="mt-0.5 text-xs text-emerald-600/80 dark:text-emerald-400/80">
            {nextDueLabel || "Tap to view your reviewed check-in"}
          </p>
        </div>
        {latestReviewedCheckInId && (
          <span className="text-emerald-400 transition-transform group-hover:translate-x-1 dark:text-emerald-600" aria-hidden="true">
            &rarr;
          </span>
        )}
      </div>
    );

    if (latestReviewedCheckInId) {
      return (
        <Link
          href={`/client/check-ins/${latestReviewedCheckInId}`}
          className="group block rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-green-50/50 px-6 py-4 transition-all hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-green-950/20 dark:hover:border-emerald-700"
        >
          {content}
        </Link>
      );
    }

    return (
      <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-green-50/50 px-6 py-4 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-green-950/20">
        {content}
      </div>
    );
  }

  // ── Upcoming: zinc/gray info ───────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-zinc-50 to-zinc-100/50 px-6 py-4 dark:border-zinc-800/40 dark:from-zinc-900/40 dark:to-zinc-950/20">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200/80 dark:bg-zinc-800/40">
          <span className="text-sm" aria-hidden="true">{"\uD83D\uDCC5"}</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {statusLabel}
          </p>
          {nextDueLabel && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {nextDueLabel}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
