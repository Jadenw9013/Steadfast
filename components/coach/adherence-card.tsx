import { AdherenceToggle } from "./adherence-toggle";
import type { AdherenceSummary } from "@/lib/queries/adherence";

interface Props {
  clientId: string;
  adherenceEnabled: boolean;
  summary: AdherenceSummary;
}

export function AdherenceCard({ clientId, adherenceEnabled, summary }: Props) {
  const { today, last7Days } = summary;

  // 7-day rolled-up stats
  const daysWithMeals = last7Days.filter((d) => d.mealsTotal > 0);
  const totalMealsCompleted = last7Days.reduce((s, d) => s + d.mealsCompleted, 0);
  const totalMealsTracked = last7Days.reduce((s, d) => s + d.mealsTotal, 0);
  const mealCompletionPct =
    totalMealsTracked > 0
      ? Math.round((totalMealsCompleted / totalMealsTracked) * 100)
      : null;
  const workoutsCompleted = last7Days.filter((d) => d.workoutCompleted).length;

  return (
    <section
      aria-labelledby="adherence-heading"
      className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white shadow-sm dark:border-white/[0.06] dark:bg-[#0a1224] dark:shadow-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.06]">
        <h2 id="adherence-heading" className="text-sm font-semibold tracking-tight">
          Daily Adherence
        </h2>
      </div>

      <div className="space-y-5 p-5">
        {/* Toggle */}
        <AdherenceToggle clientId={clientId} initialEnabled={adherenceEnabled} />

        {adherenceEnabled && (
          <>
            {/* Today snapshot */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                Today
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCell
                  label="Meals"
                  value={
                    today.mealsTotal === 0
                      ? "—"
                      : `${today.mealsCompleted}/${today.mealsTotal}`
                  }
                  sub={today.mealsTotal > 0 ? (today.mealsCompleted === today.mealsTotal ? "All done" : "in progress") : "No plan"}
                />
                <StatCell
                  label="Workout"
                  value={today.workoutCompleted ? "Done" : "—"}
                  completed={today.workoutCompleted}
                />
              </div>
            </div>

            {/* 7-day summary */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                Last 7 Days
              </p>
              <div className="grid grid-cols-2 gap-3">
                <StatCell
                  label="Meal adherence"
                  value={mealCompletionPct !== null ? `${mealCompletionPct}%` : "—"}
                  sub={
                    daysWithMeals.length > 0
                      ? `${totalMealsCompleted}/${totalMealsTracked} meals`
                      : "No data"
                  }
                />
                <StatCell
                  label="Workouts"
                  value={`${workoutsCompleted}/7`}
                  sub="days completed"
                />
              </div>

              {/* Day-by-day mini bar */}
              {last7Days.some((d) => d.mealsTotal > 0 || d.workoutCompleted) && (
                <DayBar days={last7Days} />
              )}
            </div>
          </>
        )}

        {!adherenceEnabled && (
          <p className="text-sm text-gray-400 dark:text-zinc-500">
            Enable to let this client track daily meals and workouts.
          </p>
        )}
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  sub,
  completed,
}: {
  label: string;
  value: string;
  sub?: string;
  completed?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-3 dark:border-white/[0.06]">
      <p className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">{label}</p>
      <p
        className={`mt-1 text-lg font-bold tabular-nums ${
          completed ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-zinc-100"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

function DayBar({ days }: { days: { date: string; mealsCompleted: number; mealsTotal: number; workoutCompleted: boolean }[] }) {
  return (
    <div className="mt-3 flex gap-1" aria-label="7-day adherence overview">
      {days.map((d) => {
        const hasData = d.mealsTotal > 0 || d.workoutCompleted;
        const allMealsDone = d.mealsTotal > 0 && d.mealsCompleted === d.mealsTotal;
        const dayLabel = new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow" });
        return (
          <div
            key={d.date}
            title={`${d.date}: meals ${d.mealsCompleted}/${d.mealsTotal}, workout ${d.workoutCompleted ? "done" : "—"}`}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div
              aria-hidden="true"
              className={`h-6 w-full rounded-md ${
                !hasData
                  ? "bg-gray-100 dark:bg-zinc-800"
                  : allMealsDone && d.workoutCompleted
                  ? "bg-emerald-500 dark:bg-emerald-600"
                  : d.mealsCompleted > 0 || d.workoutCompleted
                  ? "bg-emerald-200 dark:bg-emerald-900/50"
                  : "bg-gray-100 dark:bg-zinc-800"
              }`}
            />
            <span className="text-[10px] font-medium text-gray-400 dark:text-zinc-500">
              {dayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
