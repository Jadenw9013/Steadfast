import Link from "next/link";
import type { CadenceStatus } from "@/lib/scheduling/cadence";

type WeekStatus = "new" | "reviewed" | "missing" | "not_due";

export type InboxClient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profilePhotoUrl?: string | null;
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

// ── Gradient ring background per status ──────────────────────────────────────
const RING_GRADIENT: Record<string, string> = {
  overdue:   "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
  due:       "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
  submitted: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
  reviewed:  "linear-gradient(135deg, #10b981 0%, #2dd4bf 100%)",
  upcoming:  "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
  new:       "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
  missing:   "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
  not_due:   "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
};

// ── Status badge config: icon + color per status ──────────────────────────────
type BadgeIcon = "pulse-red" | "pulse-amber" | "check" | "clock" | "arrow";

type BadgeInfo = {
  classes: string;
  icon: BadgeIcon;
  defaultLabel: string;
};

const BADGE_MAP: Record<string, BadgeInfo> = {
  overdue: {
    classes: "bg-red-500/15 text-red-400 border border-red-500/20",
    icon: "pulse-red",
    defaultLabel: "Overdue",
  },
  due: {
    classes: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    icon: "pulse-amber",
    defaultLabel: "Due Today",
  },
  submitted: {
    classes: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
    icon: "arrow",
    defaultLabel: "Review",
  },
  reviewed: {
    classes: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    icon: "check",
    defaultLabel: "Reviewed",
  },
  upcoming: {
    classes: "bg-slate-500/15 text-slate-300 border border-slate-500/20",
    icon: "clock",
    defaultLabel: "Upcoming",
  },
  // weekStatus fallbacks
  new: {
    classes: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
    icon: "arrow",
    defaultLabel: "Review",
  },
  missing: {
    classes: "bg-red-500/15 text-red-400 border border-red-500/20",
    icon: "pulse-red",
    defaultLabel: "Missing",
  },
  not_due: {
    classes: "bg-slate-500/15 text-slate-300 border border-slate-500/20",
    icon: "clock",
    defaultLabel: "Upcoming",
  },
};

function StatusBadge({ info, label }: { info: BadgeInfo; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${info.classes}`}
    >
      {/* Icon */}
      {info.icon === "pulse-red" && (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 motion-safe:animate-pulse" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
        </span>
      )}
      {info.icon === "pulse-amber" && (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-safe:animate-pulse" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
        </span>
      )}
      {info.icon === "check" && (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      )}
      {info.icon === "clock" && (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      )}
      {info.icon === "arrow" && (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
      )}
      {label}
    </span>
  );
}

function ArrowDown() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" /><path d="m5 12 7 7 7-7" />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
    </svg>
  );
}

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

  const statusKey = client.cadenceStatus ?? client.weekStatus;
  const ringGradient = RING_GRADIENT[statusKey] ?? RING_GRADIENT.not_due;
  const badgeInfo = BADGE_MAP[statusKey] ?? BADGE_MAP.not_due;
  const badgeLabel = client.cadenceLabel ?? badgeInfo.defaultLabel;

  // Show review CTA only when there's something to review
  const canReview = client.weekStatus !== "missing" && client.cadenceStatus !== "overdue";

  const hasWeight = client.weight != null && client.cadenceStatus !== "overdue";
  const hasWeightChange = client.weightChange != null && client.weightChange !== 0;

  return (
    <div
      className="group relative overflow-hidden sf-glass-card p-4 transition-all duration-200 hover:border-white/[0.16] hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:p-5"
    >
      <Link
        href={profileHref}
        className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e] focus-visible:rounded-xl sm:gap-4"
        aria-label={`${client.firstName ?? ""} ${client.lastName ?? ""} — ${badgeLabel}`}
      >
        {/* Avatar — gradient ring via background + padding technique */}
        <div
          className="relative shrink-0 h-12 w-12 rounded-full p-[2px]"
          style={{ background: ringGradient }}
        >
          {client.profilePhotoUrl ? (
            <img
              src={client.profilePhotoUrl}
              alt={`${client.firstName ?? ""} ${client.lastName ?? ""}`}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full bg-[#111c30] text-sm font-bold text-zinc-100">
              {client.firstName?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          {client.hasClientMessage && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[#0d1829] bg-purple-500" />
            </span>
          )}
        </div>

        {/* Name + sub-line */}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-zinc-100 sm:truncate">
            {client.firstName} {client.lastName}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-zinc-400 sm:text-xs sm:text-zinc-400">
            {client.submittedAt
              ? `Checked in ${formatTimeAgo(client.submittedAt)}`
              : client.nextDueLabel || "Waiting for submission"}
          </p>
        </div>

        {/* Weight — desktop column */}
        {hasWeight && (
          <div className="hidden shrink-0 text-right sm:block">
            <p className="font-mono text-2xl font-bold tabular-nums leading-tight tracking-tight text-zinc-100">
              {client.weight}
              <span className="ml-0.5 text-sm font-normal text-zinc-400">lbs</span>
            </p>
            {hasWeightChange && (
              <p className="mt-0.5 flex items-center justify-end gap-0.5 text-xs font-medium tabular-nums">
                {client.weightChange! < 0 ? (
                  <span className="flex items-center gap-0.5 text-emerald-400">
                    <ArrowDown />
                    {Math.abs(client.weightChange!)} lbs
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 text-red-400">
                    <ArrowUp />
                    {Math.abs(client.weightChange!)} lbs
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Status badge — fades to 0 on hover when reviewable */}
        <div
          className={`shrink-0 transition-opacity duration-200 ${canReview ? "group-hover:opacity-0" : ""}`}
        >
          <StatusBadge info={badgeInfo} label={badgeLabel} />
        </div>
      </Link>

      {/* Weight — mobile second row */}
      {hasWeight && (
        <div className="mt-2 flex items-center gap-2 pl-[60px] sm:hidden">
          <span className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {client.weight}
            <span className="ml-0.5 text-sm font-normal text-zinc-400">lbs</span>
          </span>
          {hasWeightChange && (
            <>
              {client.weightChange! < 0 ? (
                <span className="flex items-center gap-0.5 text-xs font-medium text-emerald-400">
                  <ArrowDown />{Math.abs(client.weightChange!)} lbs
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-xs font-medium text-red-400">
                  <ArrowUp />{Math.abs(client.weightChange!)} lbs
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Review CTA — fades in over badge position on hover */}
      {canReview && (
        <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 sm:right-5">
          <Link
            href={reviewHref}
            className="sf-button-secondary !px-3.5 !py-2 text-xs shadow-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            Review
          </Link>
        </div>
      )}
    </div>
  );
}
