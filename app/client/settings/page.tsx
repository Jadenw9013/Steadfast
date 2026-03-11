import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
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

      <div className="animate-fade-in rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-white/[0.06] dark:bg-[#0a1224]" style={{ animationDelay: "60ms" }}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Notifications
        </h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Email and SMS notifications are coming soon.
        </p>
      </div>

      {coachAssignment && (
        <div className="animate-fade-in rounded-2xl border border-red-200/80 bg-white p-5 dark:border-red-900/50 dark:bg-[#0a1224]" style={{ animationDelay: "120ms" }}>
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
