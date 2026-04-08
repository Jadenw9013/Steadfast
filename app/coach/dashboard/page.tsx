import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachClientsWithWeekStatus } from "@/lib/queries/check-ins";
import { CoachInbox } from "@/components/coach/inbox/coach-inbox";
import type { InboxClient } from "@/components/coach/inbox/inbox-client-card";
import { computeCurrentPeriod } from "@/lib/scheduling/periods";
import { parseCadenceConfig, getCadencePreview, cadenceFromLegacyDays } from "@/lib/scheduling/cadence";
import Link from "next/link";

function getGreeting(): string {
  // Approximate US local time from UTC (rough EST/CST center)
  const localHour = (new Date().getUTCHours() + 19) % 24; // UTC-5
  if (localHour < 12) return "Good morning";
  if (localHour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function CoachDashboard() {
  const user = await getCurrentDbUser();
  const rawClients = await getCoachClientsWithWeekStatus(user.id);

  const clients: InboxClient[] = rawClients.map((c) => ({
    ...c,
    weekOf: c.weekOf,
  }));

  // Cadence-aware period label
  const coachCadence = parseCadenceConfig(user.cadenceConfig);
  const effectiveCadence = coachCadence ?? cadenceFromLegacyDays(user.checkInDaysOfWeek);
  const cadencePreview = getCadencePreview(effectiveCadence);
  const period = computeCurrentPeriod([1], new Date(), "America/Los_Angeles");
  const weekLabel = `${period.label} \u00b7 ${cadencePreview}`;

  const totalCount = clients.length;
  const overdueCount = clients.filter(
    (c) => c.cadenceStatus === "overdue" || c.cadenceStatus === "due"
  ).length;
  const reviewedCount = clients.filter((c) => c.weekStatus === "reviewed").length;

  const greeting = getGreeting();
  const coachFirstName = user.firstName ?? "Coach";

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <section className="animate-fade-in">
        {/* Greeting row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              {greeting}, {coachFirstName}
            </h1>
            <p className="mt-1 text-xs font-bold uppercase tracking-wider text-zinc-400">{weekLabel}</p>
          </div>

          {/* Stats pills */}
          {clients.length > 0 && (
            <div
              className="flex flex-wrap gap-2 sm:shrink-0 sm:items-start"
              role="status"
              aria-label="Client summary"
            >
              <span
                className="text-xs font-bold uppercase tracking-widest text-zinc-300"
                aria-label={`${totalCount} total clients`}
              >
                {totalCount} client{totalCount !== 1 ? "s" : ""}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  overdueCount > 0
                    ? "bg-red-500/10 text-red-400"
                    : "bg-zinc-800/60 text-zinc-500"
                }`}
                aria-label={`${overdueCount} clients overdue`}
              >
                {overdueCount > 0 && (
                  <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 motion-safe:animate-pulse" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                  </span>
                )}
                {overdueCount} overdue
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full bg-zinc-800/60 px-3 py-1 text-xs font-semibold text-zinc-400"
                aria-label={`${reviewedCount} clients reviewed this week`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                {reviewedCount} reviewed
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Subtle gradient divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" aria-hidden />

      {/* ── Client list ─────────────────────────────────────────────────────── */}
      {clients.length > 0 && (
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white">
            Clients
          </h2>
          <Link
            href="/coach/clients/invite"
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-zinc-300 transition-all hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            aria-label="Invite a client"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
            Invite Client
          </Link>
        </div>
      )}
      {clients.length === 0 ? (
        <div className="animate-fade-in-up sf-surface-card flex flex-col items-center gap-5 px-8 py-20 text-center" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
          {/* Abstract coaching illustration — pure CSS/SVG */}
          <div className="relative flex h-16 w-16 items-center justify-center">
            {/* Outer ring */}
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-zinc-700/60" />
            {/* Inner circle */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/60 ring-1 ring-white/[0.06]">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            {/* Small satellite dots */}
            <div className="absolute -right-1 top-1 h-2.5 w-2.5 rounded-full bg-blue-500/30 ring-1 ring-blue-500/40" />
            <div className="absolute -left-1 bottom-1 h-2 w-2 rounded-full bg-emerald-500/30 ring-1 ring-emerald-500/40" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xl font-bold tracking-tight text-zinc-100">
              Your roster is empty
            </p>
            <p className="mx-auto max-w-xs text-sm text-zinc-500">
              Add your first lead to get started.
            </p>
          </div>

          <Link
            href="/coach/leads"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e] active:scale-[0.97]"
            style={{ minHeight: "44px" }}
          >
            Go to Leads
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </Link>
        </div>
      ) : (
        <section aria-label="Client inbox">
          <CoachInbox clients={clients} />
        </section>
      )}
    </div>
  );
}
