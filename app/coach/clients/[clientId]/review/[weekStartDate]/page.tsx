import { notFound } from "next/navigation";
import Link from "next/link";
import {
  verifyCoachAccessToClient,
  getCheckInByClientAndWeek,
  getPreviousBodyweight,
} from "@/lib/queries/check-ins";
import { getMessages } from "@/lib/queries/messages";
import { getEffectiveMealPlanForReview } from "@/lib/queries/meal-plans";
import { getFoodLibrary } from "@/lib/queries/food-library";
import { parseWeekStartDate, formatDateUTC } from "@/lib/utils/date";
import { db } from "@/lib/db";
import { CheckInSummary } from "@/components/coach/review/check-in-summary";
import { MessageThread } from "@/components/messages/message-thread";
import { PlanTabs } from "@/components/coach/client-workspace/plan-tabs";
import { getTrainingProgramForReview } from "@/lib/queries/training-programs";
import { getCoachTemplatesForPicker } from "@/lib/queries/training-templates";

/**
 * Standalone review workspace for a client + week.
 * Works with or without a check-in — coaches can assign
 * meal plans and send messages to brand-new clients.
 */
export default async function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ clientId: string; weekStartDate: string }>;
}) {
  const { clientId, weekStartDate } = await params;

  const coach = await verifyCoachAccessToClient(clientId);

  let weekOf: Date;
  try {
    weekOf = parseWeekStartDate(weekStartDate);
  } catch {
    notFound();
  }

  // Check-in may be null for new clients
  const checkIn = await getCheckInByClientAndWeek(clientId, weekOf);

  // If no check-in, fetch client record separately for header info
  const client = checkIn
    ? checkIn.client
    : await db.user.findUniqueOrThrow({ where: { id: clientId } });

  const [effectivePlan, messages, foodLibrary, previousWeight, trainingData, templates] =
    await Promise.all([
      getEffectiveMealPlanForReview(clientId, weekOf),
      getMessages(clientId, weekOf),
      getFoodLibrary(coach.id),
      getPreviousBodyweight(clientId, weekOf),
      getTrainingProgramForReview(clientId, weekOf),
      getCoachTemplatesForPicker(coach.id),
    ]);

  const weightDelta =
    checkIn?.weight != null && previousWeight?.weight != null
      ? +(checkIn.weight - previousWeight.weight).toFixed(1)
      : null;

  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const weekLabel = weekOf.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/coach/dashboard"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            aria-label="Back to inbox"
          >
            &larr;
          </Link>
          <Link
            href={`/coach/clients/${clientId}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.07] text-sm font-semibold transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            aria-label="View client profile"
          >
            {client.firstName?.[0] ?? "?"}
          </Link>
          <div>
            <h1 className="text-base font-bold tracking-tight sm:text-lg">
              {client.firstName} {client.lastName}
            </h1>
            <p className="text-xs text-zinc-500">Week of {weekLabel}</p>
          </div>
        </div>
      </div>

      {/* 2-column layout */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left column: check-in data + messages */}
        <div className="space-y-5">
          <CheckInSummary checkIn={checkIn} weightDelta={weightDelta} />
          <MessageThread
            messages={serializedMessages}
            clientId={clientId}
            weekStartDate={formatDateUTC(weekOf)}
            currentUserId={coach.id}
          />
        </div>

        {/* Right column: plans (toggle between Meal Plan / Training Plan) */}
        <div className="sf-glass-card p-5">
          <PlanTabs
            mealPlan={{
              clientId,
              weekStartDate: formatDateUTC(weekOf),
              effectivePlan,
              foods,
              coachDefaultNotify: coach.defaultNotifyOnPublish,
              publishedMealPlanId: effectivePlan.publishedId,
            }}
            training={{
              clientId,
              weekStartDate: formatDateUTC(weekOf),
              templates: mappedTemplates,
              initialProgram,
            }}
          />
        </div>
      </div>
    </div>
  );
}
