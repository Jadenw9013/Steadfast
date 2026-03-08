import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { getClientProfile } from "@/lib/queries/client-profile";
import { getEffectiveMealPlanForReview } from "@/lib/queries/meal-plans";
import { getFoodLibrary } from "@/lib/queries/food-library";
import { getMessages } from "@/lib/queries/messages";
import { getTrainingProgramForReview } from "@/lib/queries/training-programs";
import { getCoachTemplatesForPicker } from "@/lib/queries/training-templates";
import { getWeightHistory } from "@/lib/queries/weight-history";
import { formatDateUTC } from "@/lib/utils/date";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { CoachNotesEditor } from "@/components/coach/coach-notes-editor";
import { WeightProgress } from "@/components/charts/weight-progress";
import { RemoveClientButton } from "@/components/coach/remove-client-button";
import { ClientSchedule } from "@/components/coach/client-schedule";
import { MessageThread } from "@/components/messages/message-thread";
import { PlanTabs } from "@/components/coach/client-workspace/plan-tabs";

const weekStatusConfig = {
  submitted: {
    label: "Submitted",
    bg: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  reviewed: {
    label: "Reviewed",
    bg: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  missing: {
    label: "Missing",
    bg: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400",
  },
} as const;

const checkInStatusConfig = {
  SUBMITTED: {
    label: "Submitted",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
  },
  REVIEWED: {
    label: "Reviewed",
    dot: "bg-green-500",
    text: "text-green-600 dark:text-green-400",
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

  const [effectivePlan, messages, foodLibrary, trainingData, templates, weightHistory, onboardingResponse] =
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
    ]);

  const {
    client,
    latestCheckIn,
    previousCheckIn,
    weightDelta,
    checkIns,
    currentWeekStatus,
    lastMessageAt,
    coachScheduleDays,
    clientScheduleOverride,
    effectiveScheduleDays,
  } = profile;

  const statusBadge = weekStatusConfig[currentWeekStatus];

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
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Back to dashboard"
          >
            &larr;
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold dark:bg-zinc-800">
            {client.firstName?.[0] ?? "?"}
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
                  <span className="text-zinc-300 dark:text-zinc-700">&middot;</span>
                  <span>Last msg {timeAgo(lastMessageAt)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        {latestCheckIn && (
          <Link
            href={`/coach/clients/${clientId}/check-ins/${latestCheckIn.id}`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            View Latest Check-in
          </Link>
        )}
        <Link
          href={`/coach/clients/${clientId}/import-meal-plan`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Import Meal Plan
        </Link>
        <Link
          href={`/coach/clients/${clientId}/import-training`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Import Training
        </Link>
      </div>

      {/* Client snapshot */}
      <section aria-labelledby="snapshot-heading">
        <h2
          id="snapshot-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Client Snapshot
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Current"
            value={latestCheckIn?.weight}
            suffix="lbs"
            subtext={latestCheckIn?.submittedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          />

          <MetricCard
            label="Previous"
            value={previousCheckIn?.weight}
            suffix="lbs"
            subtext={previousCheckIn?.submittedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          />

          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Change
            </p>
            {weightDelta != null ? (
              <div className="mt-1 flex items-baseline gap-1">
                <span
                  className={`text-2xl font-bold tabular-nums ${weightDelta > 0
                    ? "text-red-500"
                    : weightDelta < 0
                      ? "text-green-600"
                      : ""
                    }`}
                >
                  {weightDelta > 0 ? "+" : ""}
                  {weightDelta}
                </span>
                <span className="text-xs text-zinc-400">lbs</span>
              </div>
            ) : (
              <p className="mt-1 text-2xl font-bold text-zinc-300 dark:text-zinc-600">
                &mdash;
              </p>
            )}
          </div>

          {latestCheckIn?.dietCompliance != null && (
            <MetricCard label="Diet" value={latestCheckIn.dietCompliance} suffix="/10" />
          )}

          {latestCheckIn?.energyLevel != null && (
            <MetricCard label="Energy" value={latestCheckIn.energyLevel} suffix="/10" />
          )}
        </div>

        <div className="mt-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
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
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <MessageThread
            messages={serializedMessages}
            clientId={clientId}
            weekStartDate={weekDateStr}
            currentUserId={coach.id}
          />
        </div>
      </section>

      {/* Intake Questionnaire */}
      {onboardingResponse && (
        <section aria-labelledby="onboarding-heading">
          <h2 id="onboarding-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Intake Questionnaire
          </h2>
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#121215] space-y-4">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(onboardingResponse.form.questions as any[]).map((q) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const answerObj = (onboardingResponse.answers as any[]).find((a) => a.questionId === q.id);
              const answer = answerObj?.answer;

              let displayAnswer = answer;
              if (typeof answer === "boolean") {
                displayAnswer = answer ? "Yes" : "No";
              } else if (Array.isArray(answer)) {
                displayAnswer = answer.join(", ");
              } else if (answer === "" || answer === null || answer === undefined) {
                displayAnswer = "—";
              }

              return (
                <div key={q.id}>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{q.label}</p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{displayAnswer}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Check-in Schedule */}
      <section aria-labelledby="schedule-heading">
        <h2
          id="schedule-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Check-in Schedule
        </h2>

        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900 space-y-3">

          <ClientSchedule
            clientId={clientId}
            coachDays={coachScheduleDays}
            clientOverride={clientScheduleOverride}
            effectiveDays={effectiveScheduleDays}
          />

          <p className="text-xs text-zinc-500 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            Check-in preferences managed in{" "}
            <Link
              href="/coach/settings"
              className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              Settings →
            </Link>
          </p>

        </div>
      </section>

      {/* Plans — Meal Plan | Training Plan tabs */}
      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Plans
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#121215]">
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

      {/* Notes */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Notes
        </h2>
        <CoachNotesEditor
          clientId={clientId}
          initial={profile.coachNotes ?? ""}
        />
      </section>

      {/* Check-in History */}
      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Check-in History
        </h2>
        {checkIns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
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
                  className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {checkIn.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>

                  {/* Weight */}
                  {checkIn.weight != null && (
                    <span className="text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
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
      <section className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900/50 dark:bg-zinc-900/50">
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
}: {
  label: string;
  value: number | null | undefined;
  suffix: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
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
        <p className="mt-1 text-2xl font-bold text-zinc-300 dark:text-zinc-600">&mdash;</p>
      )}
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
