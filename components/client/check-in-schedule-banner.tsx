"use client";

import Link from "next/link";
import type { CadenceStatus } from "@/lib/scheduling/cadence";

export function CheckInScheduleBanner({
  cadenceStatus,
  statusLabel,
  checkedInToday,
}: {
  cadenceStatus: CadenceStatus;
  statusLabel: string;
  checkedInToday: boolean;
}) {
  // Only show the banner when the client is due or overdue and hasn't checked in today
  if (checkedInToday) return null;
  if (cadenceStatus !== "due" && cadenceStatus !== "overdue") return null;

  const isOverdue = cadenceStatus === "overdue";

  return (
    <Link
      href="/client/check-in"
      className={`group block rounded-2xl border px-6 py-4 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${isOverdue
        ? "border-red-200/80 bg-gradient-to-br from-red-50 to-orange-50/50 hover:border-red-300 focus-visible:ring-red-500 dark:border-red-800/40 dark:from-red-950/40 dark:to-orange-950/20 dark:hover:border-red-700"
        : "border-blue-200/80 bg-gradient-to-br from-blue-50 to-indigo-50/50 hover:border-blue-300 focus-visible:ring-blue-500 dark:border-blue-800/40 dark:from-blue-950/40 dark:to-indigo-950/20 dark:hover:border-blue-700"
        }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isOverdue
            ? "bg-red-200/80 dark:bg-red-800/40"
            : "bg-blue-200/80 dark:bg-blue-800/40"
            }`}
        >
          <span className="text-sm" aria-hidden="true">
            {isOverdue ? "\u26A0\uFE0F" : "\uD83D\uDCC5"}
          </span>
        </div>
        <div className="flex-1">
          <p
            className={`text-sm font-bold ${isOverdue
              ? "text-red-800 dark:text-red-200"
              : "text-blue-800 dark:text-blue-200"
              }`}
          >
            {statusLabel}
          </p>
          <p
            className={`mt-0.5 text-xs ${isOverdue
              ? "text-red-600/80 dark:text-red-400/80"
              : "text-blue-600/80 dark:text-blue-400/80"
              }`}
          >
            Tap to submit your check-in now
          </p>
        </div>
        <span
          className={`transition-transform group-hover:translate-x-1 ${isOverdue
            ? "text-red-400 dark:text-red-600"
            : "text-blue-400 dark:text-blue-600"
            }`}
          aria-hidden="true"
        >
          &rarr;
        </span>
      </div>
    </Link>
  );
}
