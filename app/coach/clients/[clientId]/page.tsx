import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { getClientProfile } from "@/lib/queries/client-profile";
import { getEffectiveMealPlanForReview } from "@/lib/queries/meal-plans";
import { getFoodLibrary } from "@/lib/queries/food-library";
import { getMessages } from "@/lib/queries/messages";
import { getTrainingProgramForReview } from "@/lib/queries/training-programs";
import { getCoachTemplatesForPicker } from "@/lib/queries/training-templates";
import { getWeightHistory } from "@/lib/queries/weight-history";
import { getClientIntake } from "@/lib/queries/client-intake";
import { getIntakePacketForClient } from "@/lib/queries/intake";
import { IntakeSummaryPanel } from "@/components/coach/clients/intake-summary-panel";
import { formatDateUTC, getLocalDate } from "@/lib/utils/date";
import { getCoachClientForAdherence, getAdherenceSummary } from "@/lib/queries/adherence";
import { getRecentExerciseProgress } from "@/lib/queries/exercise-results";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { CoachNotesEditor } from "@/components/coach/coach-notes-editor";
import { WeightProgress } from "@/components/charts/weight-progress";
import { RemoveClientButton } from "@/components/coach/remove-client-button";
import { ClientSchedule } from "@/components/coach/client-schedule";
import { MessageThread } from "@/components/messages/message-thread";
import { PlanTabs } from "@/components/coach/client-workspace/plan-tabs";
import { SendIntakeButton } from "@/components/coach/send-intake-button";
import { DismissibleIntakeBanner } from "@/components/coach/dismissible-intake-banner";
import { AdherenceCard } from "@/components/coach/adherence-card";
import { ExerciseProgress } from "@/components/coach/exercise-progress";

const weekStatusConfig = {
  submitted: {
    label: "Submitted",
    bg: "bg-blue-500/20 text-blue-400",
  },
  reviewed: {
    label: "Reviewed",
    bg: "bg-emerald-500/20 text-emerald-400",
  },
  missing: {
    label: "Missing",
    bg: "bg-zinc-700 text-zinc-400",
  },
} as const;

const checkInStatusConfig = {
  SUBMITTED: {
    label: "Submitted",
    dot: "bg-blue-500",
    text: "text-blue-400",
  },
  REVIEWED: {
    label: "Reviewed",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
  },
} as const;

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const coach = await verifyCoachAccessToClient(clientId);
  const profile = await getClientProfile(coach.id, clientId);
  if (!profile) notFound();

  const weekOf = profile.currentWeekOf;
  const weekDateStr = formatDateUTC(weekOf);

  // Derive client's "today" in their timezone for adherence summary
  const clientTz = profile.client.timezone || "America/New_York";
  const clientTodayDate = getLocalDate(new Date(), clientTz);

  const [effectivePlan, messages, foodLibrary, trainingData, templates, weightHistory, onboardingResponse, clientIntake, coachClientAdherence, adherenceSummary, exerciseProgress, intakePacket] =
    await Promise.all([
      getEffectiveMealPlanForReview(clientId, weekOf),
      getMessages(clientId, weekOf),
      getFoodLibrary(coach.id),
      getTrainingProgramForReview(clientId, weekOf),
      getCoachTemplatesForPicker(coach.id),
      getWeightHistory(clientId),
      db.onboardingResponse.findUnique({
        where: { clientId },
        include: { form: true },
      }),
      getClientIntake(clientId),
      getCoachClientForAdherence(coach.id, clientId),
      getAdherenceSummary(clientId, clientTodayDate),
      getRecentExerciseProgress(clientId),
      getIntakePacketForClient(coach.id, clientId),
    ]);

  const {
    client,
    profilePhotoUrl,
    latestCheckIn,
    previousCheckIn,
    weightDelta,
    checkIns,
    currentWeekStatus,
    lastMessageAt,
    coachScheduleDays,
    clientScheduleOverride,
    effectiveScheduleDays,
    coachCadence,
    clientCadenceOverride,
  } = profile;

  const statusBadge = weekStatusConfig[currentWeekStatus];



  // Intake status display config
  const intakeStatusConfig = {
    PENDING: {
      label: "Intake Sent",
      bg: "bg-amber-500/20 text-amber-400",
      dot: "bg-amber-400",
    },
    IN_PROGRESS: {
      label: "Intake In Progress",
      bg: "bg-blue-500/20 text-blue-400",
      dot: "bg-blue-500",
    },
    COMPLETED: {
      label: "Intake Completed",
      bg: "bg-emerald-500/20 text-emerald-400",
      dot: "bg-emerald-500",
    },
  } as const;

  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const foods = foodLibrary.map((f) => ({
    id: f.id,
    name: f.name,
    defaultUnit: f.defaultUnit,
  }));

  const mappedTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    days: t.days.map((d) => ({
      dayName: d.dayName,
      blocks: d.blocks.map((b) => ({
        type: b.type,
        title: b.title,
        content: b.content,
      })),
    })),
  }));

  const initialProgram = trainingData.program
    ? {
      id: trainingData.program.id,
      status: trainingData.program.status,
      templateSourceId: trainingData.program.templateSourceId,
      weeklyFrequency: trainingData.program.weeklyFrequency,
      clientNotes: trainingData.program.clientNotes,
      injuries: trainingData.program.injuries,
      equipment: trainingData.program.equipment,
      days: trainingData.program.days.map((d) => ({
        dayName: d.dayName,
        blocks: d.blocks.map((b) => ({
          type: b.type,
          title: b.title,
          content: b.content,
        })),
      })),
    }
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/coach/dashboard"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            aria-label="Back to dashboard"
          >
            &larr;
          </Link>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-[2px]" style={{ background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #06b6d4 100%)" }}>
            {profilePhotoUrl ? (
              <img
                src={profilePhotoUrl}
                alt={`${client.firstName ?? ""} ${client.lastName ?? ""}`}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#111c30] text-sm font-bold text-zinc-100">
                {client.firstName?.[0] ?? "?"}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">
                {client.firstName} {client.lastName}
              </h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.bg}`}
              >
                {statusBadge.label}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{client.email}</span>
              {lastMessageAt && (
                <>
                  <span className="text-zinc-500">&middot;</span>
                  <span>Last msg {timeAgo(lastMessageAt)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 xs:flex xs:flex-wrap sm:flex sm:flex-wrap">
        {latestCheckIn && (
          <Link
            href={`/coach/clients/${clientId}/check-ins/${latestCheckIn.id}`}
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-md transition-all hover:shadow-lg active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:justify-start ${
              currentWeekStatus === "submitted"
                ? "bg-amber-400 text-zinc-900 shadow-amber-400/30 hover:bg-amber-300 focus-visible:ring-amber-400"
                : "bg-zinc-800 text-zinc-100 shadow-black/20 hover:bg-zinc-700 focus-visible:ring-zinc-500"
            }`}
          >
            {currentWeekStatus === "submitted" && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-900 opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-900 opacity-60" />
              </span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            {currentWeekStatus === "submitted" ? "Review Check-in" : "View Latest Check-in"}
          </Link>
        )}
        <Link
          href={`/coach/clients/${clientId}/import-meal-plan`}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 sm:justify-start"
        >
          Import Meal Plan
        </Link>
        <Link
          href={`/coach/clients/${clientId}/import-training`}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 sm:justify-start"
        >
          Import Training
        </Link>
      </div>

      {/* Send Intake CTA — always visible when no intake exists */}
      {!clientIntake && (
        <DismissibleIntakeBanner clientId={clientId} />
      )}

      {/* Intake status badge (PENDING or IN_PROGRESS) */}
      {clientIntake && clientIntake.status !== "COMPLETED" && (
        <div className="flex items-center gap-2">
          {(() => {
            const cfg = intakeStatusConfig[clientIntake.status];
            return (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            );
          })()}
          <SendIntakeButton clientId={clientId} isResend />
        </div>
      )}

      {/* Client snapshot */}
      <section aria-labelledby="snapshot-heading">
        <h2
          id="snapshot-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Client Snapshot
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {/* Show intake baseline weight when no real check-ins exist */}
          {latestCheckIn?.weight == null && clientIntake?.status === "COMPLETED" && clientIntake.bodyweightLbs != null ? (
            <MetricCard
              label="Baseline (Intake)"
              value={clientIntake.bodyweightLbs}
              suffix="lbs"
              accent="border-t-blue-500/50"
              subtext={clientIntake.completedAt?.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            />
          ) : (
            <MetricCard
              label="Current"
              value={latestCheckIn?.weight}
              suffix="lbs"
              accent="border-t-blue-500/50"
              subtext={latestCheckIn?.submittedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            />
          )}

          <MetricCard
            label="Previous"
            value={previousCheckIn?.weight}
            suffix="lbs"
            accent="border-t-zinc-600/50"
            subtext={previousCheckIn?.submittedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          />

          <div className="sf-glass-card px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Change
            </p>
            {weightDelta != null ? (
              <div className="mt-1 flex items-baseline gap-1">
                <span
                  className={`text-2xl font-bold tabular-nums ${weightDelta > 0
                    ? "text-red-400"
                    : weightDelta < 0
                      ? "text-emerald-400"
                      : ""
                    }`}
                >
                  {weightDelta > 0 ? "+" : ""}
                  {weightDelta}
                </span>
                <span className="text-xs text-zinc-400">lbs</span>
              </div>
            ) : (
              <p className="mt-1 text-2xl font-bold text-zinc-600">
                &mdash;
              </p>
            )}
          </div>

          {latestCheckIn?.dietCompliance != null && (
            <MetricCard label="Diet" value={latestCheckIn.dietCompliance} suffix="/10" accent="border-t-emerald-500/50" />
          )}

          {latestCheckIn?.energyLevel != null && (
            <MetricCard label="Energy" value={latestCheckIn.energyLevel} suffix="/10" accent="border-t-amber-500/50" />
          )}
        </div>

        <div className="mt-3 sf-glass-card px-4 py-3">
          <WeightProgress data={weightHistory} clientId={clientId} />
        </div>
      </section>

      {/* Messages */}
      <section aria-labelledby="messages-heading" className="space-y-2">
        <h2
          id="messages-heading"
          className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Messages
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Send quick updates and keep communication in one place.
        </p>
        <div className="sf-glass-card">
          <MessageThread
            messages={serializedMessages}
            clientId={clientId}
            weekStartDate={weekDateStr}
            currentUserId={coach.id}
          />
        </div>
      </section>


      {/* Intake status banner (sent/in-progress, not yet completed) */}
      {clientIntake && clientIntake.status !== "COMPLETED" && (
        <section aria-labelledby="intake-pending-heading">
          <h2 id="intake-pending-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Intake Questionnaire
          </h2>
          <div className="sf-glass-card flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              {(() => {
                const cfg = intakeStatusConfig[clientIntake.status];
                return (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                );
              })()}
              <p className="text-sm text-zinc-500">
                {clientIntake.status === "PENDING"
                  ? "Waiting for client to begin"
                  : "Client has started the questionnaire"}
              </p>
            </div>
            <SendIntakeButton clientId={clientId} isResend />
          </div>
        </section>
      )}



      {/* Daily Adherence — summary only, shown when adherence is enabled */}
      {coachClientAdherence?.adherenceEnabled && (
        <AdherenceCard
          clientId={clientId}
          adherenceEnabled={coachClientAdherence.adherenceEnabled}
          summary={adherenceSummary}
        />
      )}

      {/* Plans — Meal Plan | Training Plan tabs */}
      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Plans
        </h2>
        <div className="sf-glass-card p-5" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.06)" } as React.CSSProperties}>
          <PlanTabs
            mealPlan={{
              clientId,
              weekStartDate: weekDateStr,
              effectivePlan,
              foods,
              coachDefaultNotify: coach.defaultNotifyOnPublish ?? true,
              publishedMealPlanId: effectivePlan.publishedId,
            }}
            training={{
              clientId,
              weekStartDate: weekDateStr,
              templates: mappedTemplates,
              initialProgram,
            }}
          />
        </div>
      </section>

      {/* Intake Summary — IntakePacket / legacy / manual coach notes */}
      <section aria-labelledby="intake-summary-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="intake-summary-heading" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Intake Summary
            </h2>
          </div>
          <IntakeSummaryPanel
            intakePacketId={intakePacket?.id ?? null}
            formAnswers={
              intakePacket?.formAnswers &&
              typeof intakePacket.formAnswers === "object" &&
              "sections" in (intakePacket.formAnswers as object)
                ? (intakePacket.formAnswers as { sections: { sectionId: string; sectionTitle: string; answers: { questionId: string; label: string; value: string }[] }[] })
                : null
            }
            submittedAt={intakePacket?.submittedAt?.toISOString() ?? null}
            coachNotes={intakePacket?.coachNotes ?? null}
            legacyResponses={
              onboardingResponse
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (onboardingResponse.form.questions as any[]).map((q) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const answerObj = (onboardingResponse.answers as any[]).find((a: any) => a.questionId === q.id);
                    const raw = answerObj?.answer;
                    const answer =
                      typeof raw === "boolean" ? (raw ? "Yes" : "No")
                      : Array.isArray(raw) ? raw.join(", ")
                      : (raw ?? "");
                    return { questionLabel: q.label as string, answer };
                  })
                : null
            }
            clientName={`${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() || "the client"}
            clientId={clientId}
            manualNotes={profile.coachNotes ?? null}
          />
        </section>

      {/* Legacy structured intake (completed via old system) — shown only when no IntakePacket */}
      {!intakePacket && clientIntake?.status === "COMPLETED" && (
        <section aria-labelledby="intake-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="intake-heading" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Intake Baseline
            </h2>
            <div className="flex items-center gap-2">
              {(() => {
                const cfg = intakeStatusConfig.COMPLETED;
                return (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                );
              })()}
              <SendIntakeButton clientId={clientId} isResend />
            </div>
          </div>
          <div className="sf-glass-card" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.05)" } as React.CSSProperties}>
            {/* Key stats row */}
            <div className="grid grid-cols-2 divide-x divide-zinc-800 border-b border-zinc-800 sm:grid-cols-4">
              <IntakeStatCell label="Bodyweight" value={clientIntake.bodyweightLbs ? `${clientIntake.bodyweightLbs} lbs` : "—"} />
              <IntakeStatCell label="Height" value={clientIntake.heightInches ? `${clientIntake.heightInches} in` : "—"} />
              <IntakeStatCell label="Age" value={clientIntake.ageYears ? `${clientIntake.ageYears} yrs` : "—"} />
              <IntakeStatCell label="Gender" value={clientIntake.gender ?? "—"} />
            </div>
            {/* Detail rows */}
            <div className="divide-y divide-zinc-800 p-5">
              <IntakeRow label="Primary Goal" value={clientIntake.primaryGoal} />
              <IntakeRow label="Training Experience" value={clientIntake.trainingExperience} />
              <IntakeRow label="Training Days / Week" value={clientIntake.trainingDaysPerWeek?.toString()} />
              <IntakeRow label="Equipment Access" value={clientIntake.gymAccess} />
              <IntakeRow label="Injuries / Limitations" value={clientIntake.injuries} />
              <IntakeRow label="Dietary Restrictions" value={clientIntake.dietaryRestrictions} />
              <IntakeRow label="Food Preferences" value={clientIntake.dietaryPreferences} />
              <IntakeRow label="Current Diet" value={clientIntake.currentDiet} last />
            </div>
          </div>
        </section>
      )}


      {/* Check-in History */}
      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Check-in History
        </h2>
        {checkIns.length === 0 ? (
          <div className="sf-glass-card px-6 py-8 text-center">
            <p className="text-sm text-zinc-400">No check-ins yet.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {checkIns.map((checkIn) => {
              const cfg = checkInStatusConfig[checkIn.status];
              return (
                <Link
                  key={checkIn.id}
                  href={`/coach/clients/${clientId}/check-ins/${checkIn.id}`}
                  className={`flex items-center gap-3 rounded-lg border border-l-[3px] border-white/[0.08] bg-white/[0.04] px-4 py-2.5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-2 ${
                    checkIn.status === "REVIEWED" ? "border-l-emerald-500/60" : "border-l-blue-500/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {checkIn.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>

                  {/* Weight */}
                  {checkIn.weight != null && (
                    <span className="text-sm font-medium tabular-nums text-zinc-300">
                      {checkIn.weight}
                      <span className="ml-0.5 text-xs font-normal text-zinc-400">lbs</span>
                    </span>
                  )}

                  {/* Photo count */}
                  {checkIn._count.photos > 0 && (
                    <span className="text-xs text-zinc-400">
                      {checkIn._count.photos} photo{checkIn._count.photos > 1 ? "s" : ""}
                    </span>
                  )}

                  {/* Status badge */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot}`} aria-hidden="true" />
                    <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Danger Zone */}
      <section className="sf-glass-card p-5" style={{ borderColor: "rgba(239, 68, 68, 0.2)" }}>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-500">
          Danger Zone
        </h2>
        <p className="mb-4 text-sm text-zinc-500">
          Removing a client disconnects them from your roster. Historical data is preserved.
        </p>
        <RemoveClientButton
          clientId={clientId}
          clientName={`${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() || "this client"}
        />
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  subtext,
  accent = "border-t-zinc-700/50",
}: {
  label: string;
  value: number | null | undefined;
  suffix: string;
  subtext?: string;
  accent?: string;
}) {
  return (
    <div className={`sf-glass-card border-t-2 px-4 py-3 ${accent}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      {value != null ? (
        <div className="mt-1">
          <div className="flex items-baseline gap-0.5">
            <span className="text-2xl font-bold tabular-nums">{value}</span>
            <span className="text-xs text-zinc-400">{suffix}</span>
          </div>
          {subtext && <p className="text-xs text-zinc-400">{subtext}</p>}
        </div>
      ) : (
        <p className="mt-1 text-2xl font-bold text-zinc-500">&mdash;</p>
      )}
    </div>
  );
}

function IntakeStatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function IntakeRow({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  if (!value) return null;
  return (
    <div className={`py-3 ${last ? "" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-sm text-zinc-300 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
