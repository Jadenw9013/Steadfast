import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import Link from "next/link";
import { Metadata } from "next";
import { LeadsPageHeader } from "@/components/coach/leads-page-header";

export const metadata: Metadata = { title: "Leads | Steadfast" };

// ── Pipeline group definitions ────────────────────────────────────────────────
const PIPELINE_GROUPS = [
  {
    key: "PENDING",
    label: "Pending",
    stages: ["PENDING"],
    accentColor: "#52525b",       // zinc-600
    accentClass: "bg-zinc-600",
    alwaysShow: true,
  },
  {
    key: "IN_CONSULTATION",
    label: "In Consultation",
    stages: ["CONSULTATION_SCHEDULED", "CONSULTATION_DONE"],
    accentColor: "rgba(59,130,246,0.6)", // blue-500/60
    accentClass: "bg-blue-500/60",
    alwaysShow: false,
  },
  {
    key: "INTAKE_OUT",
    label: "Intake Out",
    stages: ["INTAKE_SENT"],
    accentColor: "rgba(139,92,246,0.6)", // violet-500/60
    accentClass: "bg-violet-500/60",
    alwaysShow: false,
  },
  {
    key: "INTAKE_RECEIVED",
    label: "Intake Received",
    stages: ["INTAKE_SUBMITTED"],
    accentColor: "rgba(245,158,11,0.6)", // amber-500/60
    accentClass: "bg-amber-500/60",
    alwaysShow: false,
  },
  {
    key: "FORMS",
    label: "Forms Out",
    stages: ["FORMS_SENT"],
    accentColor: "rgba(6,182,212,0.6)",  // cyan-500/60
    accentClass: "bg-cyan-500/60",
    alwaysShow: false,
  },
  {
    key: "READY_TO_ACTIVATE",
    label: "Ready to Activate",
    stages: ["FORMS_SIGNED"],
    accentColor: "rgba(16,185,129,0.6)", // emerald-500/60
    accentClass: "bg-emerald-500/60",
    alwaysShow: false,
  },
] as const;

// ── Lead card gradient ring per consultation stage ────────────────────────────
const STAGE_RING: Record<string, string> = {
  PENDING:                "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)",
  CONSULTATION_SCHEDULED: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
  CONSULTATION_DONE:      "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
  INTAKE_SENT:            "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
  INTAKE_SUBMITTED:       "linear-gradient(135deg, #f59e0b 0%, #eab308 100%)",
  FORMS_SENT:             "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
  FORMS_SIGNED:           "linear-gradient(135deg, #10b981 0%, #2dd4bf 100%)",
  ACTIVE:                 "linear-gradient(135deg, #10b981 0%, #2dd4bf 100%)",
  DECLINED:               "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)",
};

// ── Stage badge config ────────────────────────────────────────────────────────
const STAGE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:                { label: "New",                    color: "text-blue-400",    bg: "bg-blue-500/10" },
  CONSULTATION_SCHEDULED: { label: "Consultation Scheduled", color: "text-blue-400",    bg: "bg-blue-500/10" },
  CONSULTATION_DONE:      { label: "Consultation Done",      color: "text-violet-400",  bg: "bg-violet-500/10" },
  INTAKE_SENT:            { label: "Intake Sent",            color: "text-violet-400",  bg: "bg-violet-500/10" },
  INTAKE_SUBMITTED:       { label: "Intake Received",        color: "text-amber-400",   bg: "bg-amber-500/10" },
  FORMS_SENT:             { label: "Forms Sent",             color: "text-cyan-400",    bg: "bg-cyan-500/10" },
  FORMS_SIGNED:           { label: "Signed",                 color: "text-emerald-400", bg: "bg-emerald-500/10" },
  ACTIVE:                 { label: "Active",                 color: "text-emerald-400", bg: "bg-emerald-500/10" },
  DECLINED:               { label: "Inactive",               color: "text-zinc-500",    bg: "bg-zinc-800" },
};

function daysInStage(updatedAt: Date): number {
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
}

function daysAgo(date: Date | null): string {
  if (!date) return "";
  const d = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  if (d === 0) return "Signed today";
  if (d === 1) return "Signed 1 day ago";
  return `Signed ${d} days ago`;
}

export default async function CoachLeadsPage() {
  const user = await getCurrentDbUser();
  if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

  const profile = await db.coachProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Leads</h1>
        <p className="text-sm text-zinc-500">
          You don&apos;t have a coaching profile yet.{" "}
          <Link href="/coach/marketplace/profile" className="text-blue-400 hover:underline">
            Set one up →
          </Link>
        </p>
      </div>
    );
  }

  // Raw SQL: adapter-pg crashes on CoachingRequest (Json columns) regardless of select/include
  const requests = await db.$queryRawUnsafe<Array<{
    id: string; prospectName: string; prospectEmail: string;
    status: string; consultationStage: string; intakeAnswers: Record<string, string>;
    source: string; formsSignedAt: Date | null; createdAt: Date; updatedAt: Date;
  }>>(
    `SELECT "id","prospectName","prospectEmail","status","consultationStage",
            "intakeAnswers","source","formsSignedAt","createdAt","updatedAt"
     FROM "CoachingRequest" WHERE "coachProfileId" = $1
     ORDER BY "createdAt" DESC`, profile.id
  );

  const activeRequests = requests.filter(
    (r) => r.status !== "DECLINED" && r.status !== "REJECTED"
  );
  const declinedLeads = requests.filter(
    (r) =>
      r.consultationStage === "DECLINED" ||
      r.status === "DECLINED" ||
      r.status === "REJECTED"
  );

  return (
    <div className="space-y-8">
      {/* ── Header + Add Lead form ──────────────────────────────────────────── */}
      <LeadsPageHeader />

      {/* ── Pipeline groups ────────────────────────────────────────────────── */}
      {activeRequests.length === 0 ? (
        /* Full empty state */
        <div className="sf-surface-card flex flex-col items-center gap-5 py-20 text-center" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.06)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
          <div className="relative flex h-16 w-16 items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-zinc-700/60" />
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/60 ring-1 ring-white/[0.06]">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="absolute -right-1 top-1 h-2.5 w-2.5 rounded-full bg-blue-500/20 ring-1 ring-blue-500/30" />
            <div className="absolute -left-1 bottom-1 h-2 w-2 rounded-full bg-violet-500/20 ring-1 ring-violet-500/30" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xl font-bold tracking-tight text-zinc-100">No leads yet</p>
            <p className="mx-auto max-w-xs text-sm text-zinc-500">
              Add a lead manually or share your coaching profile to get started.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2 sm:flex-row">
            <Link
              href="/coach/marketplace/profile"
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-800 px-5 py-3 text-sm font-semibold text-zinc-200 transition-all hover:border-white/[0.14] hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 active:scale-[0.97]"
              style={{ minHeight: "44px" }}
            >
              View Profile
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          {PIPELINE_GROUPS.map((group) => {
            const leads = requests.filter(
              (r) =>
                (group.stages as readonly string[]).includes(r.consultationStage) &&
                r.status !== "DECLINED" &&
                r.status !== "REJECTED"
            );

            if (leads.length === 0 && !group.alwaysShow) return null;

            const isReadyToActivate = group.key === "READY_TO_ACTIVATE";

            return (
              <section
                key={group.key}
                role="region"
                aria-label={`${group.label} leads`}
              >
                {/* Group header with left accent bar */}
                <div className="mb-3 flex items-center gap-3 border-b border-white/[0.06] pb-3">
                  <div className={`h-4 w-1 shrink-0 rounded-full ${group.accentClass}`} aria-hidden="true" />
                  <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                    {group.label}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        isReadyToActivate
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {leads.length}
                    </span>
                  </h2>
                </div>

                {leads.length === 0 ? (
                  /* Empty group state — only for PENDING (alwaysShow) */
                  <div className="sf-glass-card flex items-center gap-3 px-5 py-5">
                    <p className="text-sm text-zinc-600">No leads in this stage yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leads.map((r) => {
                      const stageBadge =
                        STAGE_BADGE[r.consultationStage] ?? STAGE_BADGE.PENDING;
                      const ringGradient =
                        STAGE_RING[r.consultationStage] ?? STAGE_RING.PENDING;
                      const answers = r.intakeAnswers as Record<string, string>;
                      const days = daysInStage(r.updatedAt);

                      return (
                        <Link
                          key={r.id}
                          href={`/coach/leads/${r.id}`}
                          className="group flex items-center gap-4 rounded-[14px] border border-white/[0.06] px-4 py-4 transition-all duration-200 hover:border-white/[0.14] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
                          style={{ background: "#0d1829", minHeight: "60px" }}
                        >
                          {/* Avatar with stage-colored gradient ring */}
                          <div
                            className="relative h-10 w-10 shrink-0 rounded-full p-[2px]"
                            style={{ background: ringGradient }}
                          >
                            <div className="flex h-full w-full items-center justify-center rounded-full bg-[#111c30] text-sm font-bold text-zinc-300">
                              {r.prospectName[0]?.toUpperCase() ?? "?"}
                            </div>
                          </div>

                          {/* Center info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-[15px] font-semibold text-zinc-100">
                                {r.prospectName}
                              </p>
                              {r.source === "EXTERNAL" && (
                                <span className="shrink-0 rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-400">
                                  External
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-sm text-zinc-500 sm:text-xs">
                              {isReadyToActivate
                                ? daysAgo(r.formsSignedAt)
                                : (answers?.goals ?? r.prospectEmail)}
                            </p>
                            {!isReadyToActivate && days > 0 && (
                              <p className="mt-0.5 text-xs text-zinc-600">
                                {days} day{days !== 1 ? "s" : ""} in {group.label.toLowerCase()}
                              </p>
                            )}
                          </div>

                          {/* Right: stage badge + arrow */}
                          <div className="flex shrink-0 items-center gap-2">
                            {isReadyToActivate ? (
                              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                                Activate →
                              </span>
                            ) : (
                              <span
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${stageBadge.color} ${stageBadge.bg} border-current/20`}
                              >
                                {stageBadge.label}
                              </span>
                            )}
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="shrink-0 text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400"
                              aria-hidden="true"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ── Inactive / declined ─────────────────────────────────────────────── */}
      {declinedLeads.length > 0 && (
        <section role="region" aria-label="Inactive leads">
          <div className="mb-3 flex items-center gap-3 border-b border-white/[0.04] pb-3">
            <div className="h-4 w-1 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" />
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">
              Inactive
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-bold text-zinc-600">
                {declinedLeads.length}
              </span>
            </h2>
          </div>
          <div className="space-y-2">
            {declinedLeads.map((r) => {
              const answers = r.intakeAnswers as Record<string, string>;
              return (
                <Link
                  key={r.id}
                  href={`/coach/leads/${r.id}`}
                  className="flex items-center gap-4 rounded-[14px] border border-white/[0.04] bg-zinc-900/30 px-4 py-4 opacity-60 transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  style={{ minHeight: "60px" }}
                >
                  <div
                    className="relative h-10 w-10 shrink-0 rounded-full p-[2px]"
                    style={{ background: "linear-gradient(180deg, #3f3f46 0%, #27272a 100%)" }}
                  >
                    <div className="flex h-full w-full items-center justify-center rounded-full bg-[#111c30] text-sm font-bold text-zinc-500">
                      {r.prospectName[0]?.toUpperCase() ?? "?"}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-400">{r.prospectName}</p>
                    <p className="mt-0.5 text-xs text-zinc-600 sm:truncate">
                      {answers?.goals ?? r.prospectEmail}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-500">
                    Inactive
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
