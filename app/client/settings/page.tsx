import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { NotificationSettings } from "@/components/client/notification-settings";
import { LeaveCoachButton } from "@/components/client/leave-coach-button";

export default async function ClientSettingsPage() {
  const user = await getCurrentDbUser();

  const coachAssignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    include: {
      coach: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="animate-fade-in text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Settings
      </h1>

      <div className="animate-fade-in rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-[#121215]" style={{ animationDelay: "60ms" }}>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Email Notifications
        </h2>
        <NotificationSettings
          role="CLIENT"
          initialPhoneNumber={user.phoneNumber || ""}
          initialSmsOptIn={user.smsOptIn}
          initialSmsMealPlanUpdates={user.smsMealPlanUpdates}
          initialSmsDailyCheckInReminder={user.smsDailyCheckInReminder}
          initialSmsCoachMessages={user.smsCoachMessages}
          initialSmsCheckInFeedback={user.smsCheckInFeedback}
          initialSmsCheckInReminderTime={user.smsCheckInReminderTime}
          // The component expects all props regardless of role to satisfy typescript, pass defaults for coach only stuff
          initialSmsClientCheckIns={user.smsClientCheckIns}
          initialSmsMissedCheckInAlerts={user.smsMissedCheckInAlerts}
          initialSmsClientMessages={user.smsClientMessages}
          initialSmsNewClientSignups={user.smsNewClientSignups}
          initialSmsMissedCheckInAlertTime={user.smsMissedCheckInAlertTime}
        />
      </div>

      {coachAssignment && (
        <div className="animate-fade-in rounded-2xl border border-red-200/80 bg-white p-5 dark:border-red-900/50 dark:bg-[#121215]" style={{ animationDelay: "120ms" }}>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-red-500">
            Danger Zone
          </h2>
          <p className="mb-4 text-sm text-zinc-500">
            Leaving your coach disconnects you from their coaching roster. Your
            existing check-ins and meal plans are preserved.
          </p>
          <LeaveCoachButton
            coachClientId={coachAssignment.id}
            coachName={
              `${coachAssignment.coach.firstName ?? ""} ${coachAssignment.coach.lastName ?? ""}`.trim() ||
              "your coach"
            }
          />
        </div>
      )}
    </div>
  );
}
