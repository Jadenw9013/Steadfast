import {
  verifyCoachAccessToClient,
  getCheckInById,
} from "@/lib/queries/check-ins";
import { getMessages } from "@/lib/queries/messages";
import { formatDateUTC } from "@/lib/utils/date";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MessageThread } from "@/components/messages/message-thread";
import { MealPlanEditorV2 } from "@/components/coach/meal-plan/meal-plan-editor-v2";
import { CheckInSummary } from "@/components/coach/review/check-in-summary";
import { getFoodLibrary } from "@/lib/queries/food-library";
import { getEffectiveMealPlanForReview } from "@/lib/queries/meal-plans";
import { getPreviousBodyweight } from "@/lib/queries/check-ins";

export default async function CheckInReviewPage({
  params,
}: {
  params: Promise<{ clientId: string; checkInId: string }>;
}) {
  const { clientId, checkInId } = await params;

  const coach = await verifyCoachAccessToClient(clientId);

  const checkIn = await getCheckInById(checkInId);
  if (!checkIn || checkIn.clientId !== clientId) notFound();

  const client = checkIn.client;
  const weekOf = checkIn.weekOf;

  const [effectivePlan, messages, foodLibrary, previousWeight] =
    await Promise.all([
      getEffectiveMealPlanForReview(clientId, weekOf),
      getMessages(clientId, weekOf),
      getFoodLibrary(coach.id),
      getPreviousBodyweight(clientId, weekOf),
    ]);

  const weightDelta =
    checkIn.weight != null && previousWeight?.weight != null
      ? +(checkIn.weight - previousWeight.weight).toFixed(1)
      : null;

  const serializedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));

  const weekLabel = checkIn.submittedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const foods = foodLibrary.map((f) => ({
    id: f.id,
    name: f.name,
    defaultUnit: f.defaultUnit,
  }));

  return (
    <div className="space-y-5">
      {/* Header — compact breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/coach/dashboard"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Back to inbox"
          >
            &larr;
          </Link>
          <Link
            href={`/coach/clients/${clientId}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            aria-label="View client profile"
          >
            {client.firstName?.[0] ?? "?"}
          </Link>
          <div>
            <h1 className="text-base font-bold tracking-tight sm:text-lg">
              {client.firstName} {client.lastName}
            </h1>
            <p className="text-xs text-zinc-500">{weekLabel}</p>
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

        {/* Right column: meal plan editor */}
        <div>
          <MealPlanEditorV2
            clientId={clientId}
            weekStartDate={formatDateUTC(weekOf)}
            effectivePlan={effectivePlan}
            foods={foods}
            coachDefaultNotify={coach.defaultNotifyOnPublish}
            publishedMealPlanId={effectivePlan.publishedId}
          />
        </div>
      </div>
    </div>
  );
}
