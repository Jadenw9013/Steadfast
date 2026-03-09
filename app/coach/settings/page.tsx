import { getCurrentDbUser } from "@/lib/auth/roles";
import { getDefaultTemplate } from "@/lib/queries/check-in-templates";
import Link from "next/link";
import { ResetTemplateButton } from "@/components/coach/reset-template-button";
import { CadenceEditor } from "@/components/coach/cadence-editor";
import { parseCadenceConfig, cadenceFromLegacyDays } from "@/lib/scheduling/cadence";

export default async function CoachSettingsPage() {
  const user = await getCurrentDbUser();
  const template = await getDefaultTemplate(user.id);

  // Resolve cadence config: prefer new JSON, fall back to legacy days
  const cadenceConfig =
    parseCadenceConfig(user.cadenceConfig) ??
    cadenceFromLegacyDays(user.checkInDaysOfWeek);

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
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-zinc-800/80 dark:bg-[#121215]">
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
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-zinc-800/80 dark:bg-[#121215]">
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

      {/* SMS Notifications */}
      <section aria-labelledby="sms-heading" className="animate-fade-in" style={{ animationDelay: "180ms" }}>
        <h2
          id="sms-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          SMS Notifications
        </h2>
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-zinc-800/80 dark:bg-[#121215]">
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Email and SMS notifications are coming soon.
          </p>
        </div>
      </section>
    </div>
  );
}
