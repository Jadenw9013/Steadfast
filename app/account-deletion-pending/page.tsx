import { redirect } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { CancelDeletionButton } from "./cancel-deletion-button";
import { SignOutButton } from "@clerk/nextjs";

export default async function AccountDeletionPendingPage() {
  const user = await getCurrentDbUser({ allowInactive: true });

  // If not deactivated, redirect to normal app
  if (!user.isDeactivated) {
    redirect(user.activeRole === "COACH" ? "/coach/dashboard" : "/client");
  }

  const request = await db.accountDeletionRequest.findUnique({
    where: { userId: user.id },
  });

  if (!request) {
    return <div className="p-8">Your account is unavailable. Please contact support.</div>;
  }

  const purgeDate = request.scheduledPurgeAt;
  const daysRemaining = Math.max(
    0,
    Math.ceil((purgeDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  const isCoach = user.isCoach;
  const isClient = user.isClient;

  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Account Deletion Scheduled</h1>
          <p className="text-sm text-zinc-400">
            Your account will be permanently deleted on{" "}
            <span className="text-zinc-200 font-medium">
              {purgeDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          </p>
        </div>

        {/* Days remaining */}
        <div
          className="rounded-xl p-4 text-center"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          <p className="text-3xl font-black text-red-400">{daysRemaining}</p>
          <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">
            {daysRemaining === 1 ? "day" : "days"} remaining
          </p>
        </div>

        {/* What will be deleted */}
        <div className="sf-glass-card p-5 space-y-3">
          {isCoach && <p className="text-sm text-zinc-400">Subscription renewal has been stopped. Restoring your account does not automatically restart billing.</p>}
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            What will be deleted
          </h2>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="text-red-400 mt-0.5">•</span>
              Your profile and all account information
            </li>
            {isCoach && (
              <>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  Your coaching marketplace profile
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  All client relationships (clients keep their own data)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  All meal plans and training programs you created
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  All leads and pipeline data
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  All uploaded files and photos
                </li>
              </>
            )}
            {isClient && (
              <>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  All check-ins and progress photos
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  Your meal plan and training program history
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  Your intake questionnaire responses
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  All uploaded photos
                </li>
              </>
            )}
            <li className="flex items-start gap-2">
              <span className="text-red-400 mt-0.5">•</span>
              All messages between you and your {isCoach ? "clients" : "coach"}
            </li>
          </ul>
        </div>

        {/* Cancel + Sign Out */}
        <div className="space-y-3">
          {request.status === "PENDING" && request.scheduledPurgeAt > new Date() && <CancelDeletionButton />}

          <div className="text-center">
            <SignOutButton>
              <button className="inline-flex min-h-[44px] items-center px-4 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                Sign Out
              </button>
            </SignOutButton>
          </div>
        </div>
      </div>
    </div>
  );
}
