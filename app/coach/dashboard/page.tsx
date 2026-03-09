import { getCurrentDbUser, ensureCoachCode } from "@/lib/auth/roles";
import { getCoachClientsWithWeekStatus } from "@/lib/queries/check-ins";
import { CoachCodeDisplay } from "@/components/coach/coach-code-display";
import { CoachInbox } from "@/components/coach/inbox/coach-inbox";
import type { InboxClient } from "@/components/coach/inbox/inbox-client-card";
import { computeCurrentPeriod } from "@/lib/scheduling/periods";
import { parseCadenceConfig, getCadencePreview, cadenceFromLegacyDays } from "@/lib/scheduling/cadence";

function KpiCard({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-[#121215] ${accent}`}
    >
      <p className="text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>
    </div>
  );
}

export default async function CoachDashboard() {
  const user = await getCurrentDbUser();
  const coachCode = await ensureCoachCode(user.id);
  const rawClients = await getCoachClientsWithWeekStatus(user.id);

  const clients: InboxClient[] = rawClients.map((c) => ({
    ...c,
    weekOf: c.weekOf,
  }));

  // Cadence-aware period label
  const coachCadence = parseCadenceConfig(user.cadenceConfig);
  const effectiveCadence = coachCadence ?? cadenceFromLegacyDays(user.checkInDaysOfWeek);
  const cadencePreview = getCadencePreview(effectiveCadence);

  // Fall back to legacy period label if cadence is weekly
  const period = computeCurrentPeriod([1], new Date(), "America/Los_Angeles");
  const weekLabel = `${period.label} \u00b7 ${cadencePreview}`;

  const totalCount = clients.length;
  const newCount = clients.filter((c) => c.weekStatus === "new").length;
  const reviewedCount = clients.filter((c) => c.weekStatus === "reviewed").length;
  const overdueCount = clients.filter((c) => c.cadenceStatus === "overdue" || c.cadenceStatus === "due").length;

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="animate-fade-in">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          {weekLabel}
        </p>
      </section>

      {/* KPI Cards */}
      {clients.length > 0 && (
        <div
          className="stagger-children grid grid-cols-2 gap-4 sm:grid-cols-4"
          role="status"
          aria-label="Client check-in summary"
        >
          <KpiCard
            value={newCount}
            label="Awaiting Review"
            accent="border-l-2 border-l-blue-500"
          />
          <KpiCard
            value={overdueCount}
            label="Due / Overdue"
            accent="border-l-2 border-l-amber-500"
          />
          <KpiCard
            value={reviewedCount}
            label="Reviewed"
            accent="border-l-2 border-l-emerald-500"
          />
          <KpiCard
            value={totalCount}
            label="Total Clients"
            accent=""
          />
        </div>
      )}

      {/* Coach Code */}
      <div className="animate-fade-in" style={{ animationDelay: "200ms" }}>
        <CoachCodeDisplay code={coachCode} />
      </div>

      {/* Client list */}
      {clients.length === 0 ? (
        <div className="animate-fade-in-up flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-20 text-center dark:border-zinc-700 dark:bg-[#121215]">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </div>
          <div>
            <p className="text-base font-semibold">No clients yet</p>
            <p className="mt-1.5 text-sm text-zinc-500">
              Share your coach code above to start receiving check-ins.
            </p>
          </div>
        </div>
      ) : (
        <section aria-label="Client inbox">
          <h2 className="mb-5 text-lg font-semibold tracking-tight">Clients</h2>
          <CoachInbox clients={clients} />
        </section>
      )}
    </div>
  );
}
