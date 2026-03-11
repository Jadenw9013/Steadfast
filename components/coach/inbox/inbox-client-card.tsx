import Link from "next/link";
import type { CadenceStatus } from "@/lib/scheduling/cadence";

type WeekStatus = "new" | "reviewed" | "missing" | "not_due";

export type InboxClient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  weekStatus: WeekStatus;
  isDueToday: boolean;
  hasClientMessage: boolean;
  checkInId: string | null;
  weekOf: Date;
  weight: number | null;
  weightChange: number | null;
  dietCompliance: number | null;
  energyLevel: number | null;
  submittedAt: Date | null;
  cadenceStatus?: CadenceStatus;
  cadenceLabel?: string;
  nextDueLabel?: string;
};

const statusConfig = {
  new: {
    label: "Ready for review",
    ring: "ring-blue-500/40",
    pill: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
  },
  reviewed: {
    label: "Reviewed",
    ring: "ring-emerald-500/40",
    pill: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
  },
  missing: {
    label: "Due today",
    ring: "ring-amber-500/40",
    pill: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
  },
  not_due: {
    label: "Not due yet",
    ring: "ring-zinc-300/50 dark:ring-zinc-600/40",
    pill: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
} as const;

const cadenceStatusRing: Record<string, string> = {
  due: "ring-amber-500/40",
  overdue: "ring-red-500/40",
  upcoming: "ring-zinc-300/50 dark:ring-zinc-600/40",
  submitted: "ring-blue-500/40",
  reviewed: "ring-emerald-500/40",
};

const cadenceStatusPill: Record<string, string> = {
  due: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
  overdue: "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400",
  upcoming: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  submitted: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
  reviewed: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
};

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  return `${diffDays}d ago`;
}

export function InboxClientCard({ client }: { client: InboxClient }) {
  const profileHref = `/coach/clients/${client.id}`;
  const reviewHref = client.checkInId
    ? `/coach/clients/${client.id}/check-ins/${client.checkInId}`
    : `/coach/clients/${client.id}`;

  // Use cadence-aware status when available, falling back to legacy
  const status = statusConfig[client.weekStatus];
  const ringClass = client.cadenceStatus
    ? cadenceStatusRing[client.cadenceStatus] || status.ring
    : status.ring;
  const pillClass = client.cadenceStatus
    ? cadenceStatusPill[client.cadenceStatus] || status.pill
    : status.pill;
  const pillLabel = client.cadenceLabel || status.label;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-4 transition-all duration-200 hover:border-zinc-300 hover:shadow-lg hover:shadow-zinc-950/5 sm:p-5 dark:border-white/[0.06] dark:bg-[#0a1224] dark:hover:border-blue-500/20 dark:hover:shadow-blue-500/[0.06]">
      <Link
        href={profileHref}
        className="flex items-center gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:rounded-xl"
        aria-label={`${client.firstName} ${client.lastName} — ${pillLabel}`}
      >
        {/* Avatar with status ring */}
        <div className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 ring-2 ${ringClass} text-sm font-bold dark:bg-[#111c30]`}>
          {client.firstName?.[0]?.toUpperCase() ?? "?"}
          {client.hasClientMessage && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-purple-500 dark:border-[#0a1224]" />
            </span>
          )}
        </div>

        {/* Name + submission time */}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug truncate">
            {client.firstName} {client.lastName}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {client.submittedAt
              ? `Checked in ${formatTimeAgo(client.submittedAt)}`
              : client.nextDueLabel || "Waiting for submission"}
          </p>
        </div>

        {/* Weight metric — desktop */}
        {client.weekStatus !== "missing" && client.weight != null && (
          <div className="hidden text-right sm:block">
            <p className="text-xl font-bold tabular-nums leading-tight tracking-tight">
              {client.weight}
              <span className="ml-0.5 text-xs font-normal text-zinc-400">lbs</span>
            </p>
            {client.weightChange != null && client.weightChange !== 0 && (
              <p className="mt-0.5 text-xs font-medium tabular-nums">
                <span className={client.weightChange < 0 ? "text-emerald-500" : "text-red-400"}>
                  {client.weightChange < 0 ? "\u2193" : "\u2191"} {Math.abs(client.weightChange)} lbs
                </span>
              </p>
            )}
          </div>
        )}

        {/* Status pill — fades out on hover for non-missing clients */}
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-opacity duration-200 ${client.weekStatus !== "missing" ? "group-hover:opacity-0" : ""} ${pillClass}`}>
          {pillLabel}
        </span>
      </Link>

      {/* Review CTA — fades in over the pill position on hover */}
      {client.weekStatus !== "missing" && (
        <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 sm:right-5">
          <Link
            href={reviewHref}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-md transition-all hover:bg-zinc-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500"
          >
            Review
          </Link>
        </div>
      )}
    </div>
  );
}
