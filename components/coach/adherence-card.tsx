import { AdherenceToggle } from "./adherence-toggle";
import type { AdherenceSummary } from "@/lib/queries/adherence";

interface Props {
  clientId: string;
  adherenceEnabled: boolean;
  summary: AdherenceSummary;
}

export function AdherenceCard({ clientId, adherenceEnabled, summary }: Props) {
  const { today, last7Days } = summary;

  // 7-day rolled-up stats. CB08: a day with no DailyAdherence record is
  // untracked, not verified nonadherence — it must not count as a missed
  // meal/workout in these totals or denominators.
  const trackedDays = last7Days.filter((d) => d.tracked);
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
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
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
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
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
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
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
                  value={trackedDays.length > 0 ? `${workoutsCompleted}/${trackedDays.length}` : "—"}
                  sub={trackedDays.length > 0 ? "days tracked" : "No data"}
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
          <p className="text-sm text-gray-400">
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
    <div className="rounded-xl border border-white/[0.06] p-3">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p
        className={`mt-1 text-lg font-bold tabular-nums ${
          completed ? "text-emerald-400" : "text-zinc-100"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}

function DayBar({ days }: { days: { date: string; mealsCompleted: number; mealsTotal: number; workoutCompleted: boolean; tracked: boolean }[] }) {
  return (
    <div className="mt-3 flex gap-1" aria-label="7-day adherence overview">
      {days.map((d) => {
        const allMealsDone = d.mealsTotal > 0 && d.mealsCompleted === d.mealsTotal;
        const dayLabel = new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow" });
        return (
          <div
            key={d.date}
            title={
              d.tracked
                ? `${d.date}: meals ${d.mealsCompleted}/${d.mealsTotal}, workout ${d.workoutCompleted ? "done" : "not done"}`
                : `${d.date}: not tracked`
            }
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div
              aria-hidden="true"
              className={`h-6 w-full rounded-md ${
                !d.tracked
                  ? "bg-white/[0.1]"
                  : allMealsDone && d.workoutCompleted
                  ? "bg-emerald-500"
                  : d.mealsCompleted > 0 || d.workoutCompleted
                  ? "bg-emerald-500/40"
                  : "bg-white/[0.1]"
              }`}
            />
            <span className="text-[10px] font-medium text-gray-400">
              {dayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
