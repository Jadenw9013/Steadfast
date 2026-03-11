import Link from "next/link";

export function CheckInStatus({
  status,
  weekLabel,
  statusLabel,
  nextDueLabel,
  checkInDate,
  checkInId,
}: {
  status: "none" | "submitted" | "reviewed";
  weekLabel: string;
  statusLabel?: string;
  nextDueLabel?: string;
  checkInDate?: string;
  checkInId?: string;
}) {
  if (status === "none") {
    return (
      <Link
        href="/client/check-in"
        className="group relative block overflow-hidden rounded-2xl bg-zinc-900 px-6 py-6 text-white transition-all hover:shadow-xl hover:shadow-zinc-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-gradient-to-br dark:from-blue-600 dark:to-blue-700 dark:text-white dark:hover:shadow-blue-500/20"
        role="status"
        aria-live="polite"
      >
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold sm:text-xl">Submit Your Check-In</p>
            <p className="mt-1 text-sm opacity-60">
              {statusLabel || weekLabel}
            </p>
            {nextDueLabel && (
              <p className="mt-0.5 text-xs opacity-40">{nextDueLabel}</p>
            )}
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl transition-transform group-hover:translate-x-1 dark:bg-zinc-900/10" aria-hidden="true">
            &rarr;
          </span>
        </div>
      </Link>
    );
  }

  if (status === "submitted") {
    return (
      <div
        className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 px-6 py-5 shadow-sm dark:border-amber-800/40 dark:from-amber-950/40 dark:to-orange-950/20 dark:shadow-none"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200/80 dark:bg-amber-800/40">
            <span className="text-base" aria-hidden="true">&#9203;</span>
          </div>
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
              {statusLabel || "Waiting for coach review"}
            </p>
            <p className="mt-0.5 text-xs text-amber-600/80 dark:text-amber-400/80">
              {checkInDate && <span>submitted {checkInDate}</span>}
              {nextDueLabel && <span> &middot; {nextDueLabel}</span>}
              {!checkInDate && !nextDueLabel && weekLabel}
            </p>
            <Link
              href="/client/check-in"
              className="mt-1 inline-block text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            >
              Update check-in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (checkInId) {
    return (
      <Link
        href={`/client/check-ins/${checkInId}`}
        className="group relative block overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 px-6 py-5 shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-green-950/20 dark:shadow-none dark:hover:shadow-emerald-900/20"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-200/80 dark:bg-emerald-800/40">
            <span className="text-base" aria-hidden="true">&#10003;</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
              Review your latest check-in
            </p>
            <p className="mt-0.5 text-xs text-emerald-600/80 dark:text-emerald-400/80">
              {nextDueLabel || `${weekLabel} \u00b7 tap to view feedback`}
            </p>
          </div>
          <span className="text-emerald-400 transition-transform group-hover:translate-x-1 dark:text-emerald-600" aria-hidden="true">
            &rarr;
          </span>
        </div>
      </Link>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 px-6 py-5 shadow-sm dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-green-950/20 dark:shadow-none"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-200/80 dark:bg-emerald-800/40">
          <span className="text-base" aria-hidden="true">&#10003;</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
            Review your latest check-in
          </p>
          <p className="mt-0.5 text-xs text-emerald-600/80 dark:text-emerald-400/80">
            {nextDueLabel || weekLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
