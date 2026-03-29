import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { LeaveCoachButton } from "@/components/client/leave-coach-button";
import { ClientEmailSettings } from "@/components/client/client-email-settings";

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
      <h1 className="animate-fade-in text-2xl font-black tracking-tight text-white">
        Settings
      </h1>

      <div className="animate-fade-in sf-glass-card p-5" style={{ animationDelay: "60ms" }}>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Email Notifications
        </h2>
        <ClientEmailSettings
          initialEmailCheckInReminders={user.emailCheckInReminders}
          initialEmailMealPlanUpdates={user.emailMealPlanUpdates}
          initialEmailCoachMessages={user.emailCoachMessages}
        />
      </div>

      {coachAssignment && (
        <div className="animate-fade-in sf-glass-card p-5" style={{ animationDelay: "120ms", borderColor: "rgba(239, 68, 68, 0.2)" }}>
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
