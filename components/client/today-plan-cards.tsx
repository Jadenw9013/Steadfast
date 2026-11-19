import Link from "next/link";

export function TodayPlanCards({
  hasMealPlan, totalMeals, loggedMeals, trainingDays, totalExercises,
}: {
  hasMealPlan: boolean;
  totalMeals: number;
  loggedMeals: number;
  trainingDays: number;
  totalExercises: number;
}) {
  const completed = Math.min(totalMeals, Math.max(0, loggedMeals));
  const remaining = Math.max(0, totalMeals - completed);
  const progress = totalMeals > 0 ? completed / totalMeals : 0;
  const tileClass = "group grid aspect-square min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-3 transition-colors hover:border-white/20 focus-visible:ring-2 focus-visible:ring-blue-500";
  if (!hasMealPlan && trainingDays === 0) return null;
  return (
    <section aria-label="Today's plan">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">Today&apos;s plan</h2>
      <div className="grid grid-cols-2 gap-3">
        {hasMealPlan && (
          <Link href="/client/meal-plan" aria-label="View your meal plan" className={tileClass}>
            <div className="flex items-center justify-between gap-1">
              <h3 className="text-[14px] font-semibold tracking-tight text-zinc-100">Meal plan</h3>
              <span className="text-emerald-400/80" aria-hidden="true">↗</span>
            </div>
            <div className="relative place-self-center" role="progressbar" aria-label="Meals completed today" aria-valuemin={0} aria-valuemax={totalMeals || 1} aria-valuenow={completed} aria-valuetext={totalMeals ? `${completed} of ${totalMeals} meals completed` : "No meals scheduled"}>
              <svg viewBox="0 0 100 100" className="h-16 w-16" aria-hidden="true">
                <circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/[0.08]" />
                <circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" strokeWidth="6" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progress * 100} strokeLinecap="round" transform="rotate(-90 50 50)" className="text-emerald-400" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
                <span className="text-[24px] font-semibold leading-none tabular-nums text-zinc-100">{remaining}</span>
                <span className="mt-1 text-[10px] leading-none text-zinc-400">remaining</span>
              </div>
            </div>
            <span className="text-center text-[11px] leading-4 text-zinc-400">{totalMeals === 0 ? "No meals scheduled" : remaining === 0 ? "All meals complete" : `${completed} of ${totalMeals} complete`}</span>
          </Link>
        )}
        {trainingDays > 0 && (
          <Link href="/client/training" aria-label="View your training program" className={tileClass}>
            <div className="flex items-center justify-between gap-1">
              <h3 className="text-[14px] font-semibold tracking-tight text-zinc-100">Workout</h3>
              <span className="text-blue-400/80" aria-hidden="true">↗</span>
            </div>
            <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 place-self-center rounded-2xl border border-blue-400/10 bg-blue-500/[0.06] text-blue-400">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12M3 12h3M18 12h3" /></svg>
              <span className="text-[10px] leading-none tabular-nums text-blue-300">{trainingDays}-day plan</span>
            </div>
            <span className="text-center text-[11px] font-medium leading-4 text-blue-300">Choose a day<span className="sr-only"> · {totalExercises} exercises</span></span>
          </Link>
        )}
      </div>
    </section>
  );
}

export function CardioSummary({ modality, frequency, duration, intensity, notes }: {
  modality: string; frequency: string; duration: string; intensity: string; notes: string;
}) {
  const details = [
    { label: "Frequency", value: frequency.trim() },
    { label: "Duration", value: duration.trim() },
    { label: "Intensity", value: intensity.trim() },
  ].filter((detail) => detail.value);
  return (
    <section aria-label="Cardio prescription" className="rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-4">
      <div className="flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="shrink-0 text-emerald-400" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7z" /></svg>
        <div className="min-w-0">
          <p className="text-xs text-zinc-400">Cardio</p>
          <h2 className="break-words text-sm font-semibold text-zinc-100">{modality.trim() || "Your prescription"}</h2>
        </div>
      </div>
      {details.length > 0 && <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-3">
        {details.map(({ label, value }) => <div key={label} className="min-w-0">
          <dt className="text-xs text-zinc-400">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-zinc-100">{value}</dd>
        </div>)}
      </dl>}
      {notes && <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{notes}</p>}
    </section>
  );
}
