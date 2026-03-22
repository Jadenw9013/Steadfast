import { getCurrentDbUser } from "@/lib/auth/roles";
import { getDefaultTemplate } from "@/lib/queries/check-in-templates";
import Link from "next/link";
import { ResetTemplateButton } from "@/components/coach/reset-template-button";
import { CadenceEditor } from "@/components/coach/cadence-editor";
import { CoachEmailSettings } from "@/components/coach/coach-email-settings";
import { parseCadenceConfig, cadenceFromLegacyDays } from "@/lib/scheduling/cadence";
import { TeamSection } from "@/components/coach/TeamSection";
import { getTeamWithMembers, getActiveTeamInvite } from "@/lib/queries/teams";

export default async function CoachSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string }>;
}) {
  const { joined } = await searchParams;
  const justJoined = joined === "true";
  const user = await getCurrentDbUser();
  const template = await getDefaultTemplate(user.id);

  // Resolve cadence config: prefer new JSON, fall back to legacy days
  const cadenceConfig =
    parseCadenceConfig(user.cadenceConfig) ??
    cadenceFromLegacyDays(user.checkInDaysOfWeek);

  // Fetch team data + active invite if the coach is on a team
  const [teamData, activeInvite] = await Promise.all([
    user.teamId ? getTeamWithMembers(user.teamId) : Promise.resolve(null),
    user.teamId ? getActiveTeamInvite(user.teamId) : Promise.resolve(null),
  ]);

  const questionCount = template
    ? (template.questions as unknown[]).length
    : 0;



  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="animate-fade-in flex items-center gap-3">
        <Link
          href="/coach/dashboard"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 sm:hidden"
          aria-label="Back to dashboard"
        >
          &larr;
        </Link>
        <div>
          <nav className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 mb-1">
            <Link href="/coach/dashboard" className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-zinc-600 dark:text-zinc-300">Settings</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight">Coach Settings</h1>
          <p className="text-xs text-zinc-500">
            Configure check-ins for all clients
          </p>
        </div>
      </div>

      {/* Check-in Schedule */}
      <section aria-labelledby="schedule-heading" className="animate-fade-in" style={{ animationDelay: "60ms" }}>
        <h2
          id="schedule-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Check-in Schedule
        </h2>
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <CadenceEditor
            mode="coach"
            initialConfig={cadenceConfig}
          />
        </div>
      </section>

      {/* Check-in Form */}
      <section aria-labelledby="form-heading" className="animate-fade-in" style={{ animationDelay: "120ms" }}>
        <h2
          id="form-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Check-in Form
        </h2>
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {template
                  ? `Custom Template (${questionCount} custom question${questionCount !== 1 ? "s" : ""})`
                  : "Using Default Template"}
              </p>
              <p className="text-xs text-zinc-500">
                {template
                  ? template.name
                  : "Core fields only: weight, diet, energy, notes, photos"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {template && <ResetTemplateButton />}
              <Link
                href="/coach/settings/check-in-form"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Customize Form
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Onboarding Templates */}
      <section aria-labelledby="onboarding-heading" className="animate-fade-in" style={{ animationDelay: "150ms" }}>
        <h2
          id="onboarding-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Intake Forms & Documents
        </h2>
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Onboarding Templates</p>
              <p className="text-xs text-zinc-500">Manage the forms and documents used in your client onboarding.</p>
            </div>
            <Link
              href="/coach/templates/onboarding"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Go to Templates →
            </Link>
          </div>
        </div>
      </section>

      {/* Email Notifications */}
      <section aria-labelledby="notifications-heading" className="animate-fade-in" style={{ animationDelay: "180ms" }}>
        <h2
          id="notifications-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Email Notifications
        </h2>
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <CoachEmailSettings
            initialEmailClientCheckIns={user.emailClientCheckIns}
            initialEmailClientMessages={user.emailClientMessages}
            initialEmailCoachingRequests={user.emailCoachingRequests}
          />
        </div>
      </section>

      {/* Team */}
      <section aria-labelledby="team-heading" className="animate-fade-in" style={{ animationDelay: "240ms" }}>
        <h2
          id="team-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Team
        </h2>
        <TeamSection
          user={{ id: user.id, teamId: user.teamId, teamRole: user.teamRole }}
          teamData={teamData}
          activeInvite={activeInvite}
          justJoined={justJoined}
        />
      </section>
    </div>
  );
}
