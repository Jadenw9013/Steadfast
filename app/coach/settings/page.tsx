import { getCurrentDbUser } from "@/lib/auth/roles";
import { getDefaultTemplate } from "@/lib/queries/check-in-templates";
import Link from "next/link";
import { ResetTemplateButton } from "@/components/coach/reset-template-button";
import { NotificationSettings } from "@/components/client/notification-settings";
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
      <div className="flex items-center gap-3">
        <Link
          href="/coach/dashboard"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Back to dashboard"
        >
          &larr;
        </Link>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Coach Settings</h1>
          <p className="text-xs text-zinc-500">
            Configure check-ins for all clients
          </p>
        </div>
      </div>

      {/* Check-in Schedule */}
      <section aria-labelledby="schedule-heading">
        <h2
          id="schedule-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Check-in Schedule
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <CadenceEditor
            mode="coach"
            initialConfig={cadenceConfig}
          />
        </div>
      </section>

      {/* Check-in Form */}
      <section aria-labelledby="form-heading">
        <h2
          id="form-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Check-in Form
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
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
      <section aria-labelledby="sms-heading">
        <h2
          id="sms-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          SMS Notifications
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <NotificationSettings
            role="COACH"
            initialPhoneNumber={user.phoneNumber || ""}
            initialSmsOptIn={user.smsOptIn}
            initialSmsMealPlanUpdates={user.smsMealPlanUpdates}
            initialSmsDailyCheckInReminder={user.smsDailyCheckInReminder}
            initialSmsCoachMessages={user.smsCoachMessages}
            initialSmsCheckInFeedback={user.smsCheckInFeedback}
            initialSmsCheckInReminderTime={user.smsCheckInReminderTime}
            initialSmsClientCheckIns={user.smsClientCheckIns}
            initialSmsMissedCheckInAlerts={user.smsMissedCheckInAlerts}
            initialSmsClientMessages={user.smsClientMessages}
            initialSmsNewClientSignups={user.smsNewClientSignups}
            initialSmsMissedCheckInAlertTime={user.smsMissedCheckInAlertTime}
          />
        </div>
      </section>
    </div>
  );
}
