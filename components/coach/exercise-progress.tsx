type ExerciseProgressResult = {
  exerciseName: string;
  programDay: string;
  weight: number;
  reps: number;
  weekOf: Date;
};

/**
 * Lightweight table showing recent weekly exercise results grouped by day/exercise.
 * Read-only — for coach view only.
 */
export function ExerciseProgress({ results }: { results: ExerciseProgressResult[] }) {
  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center dark:border-zinc-700 dark:bg-[#0a1224]">
        <p className="text-sm font-medium text-zinc-500">No exercise results yet</p>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          Results will appear here once the client logs their workouts.
        </p>
      </div>
    );
  }

  // Group results by "programDay::exerciseName"
  const grouped = new Map<string, { programDay: string; exerciseName: string; entries: { weekOf: Date; weight: number; reps: number }[] }>();

  for (const r of results) {
    const key = `${r.programDay}::${r.exerciseName}`;
    if (!grouped.has(key)) {
      grouped.set(key, { programDay: r.programDay, exerciseName: r.exerciseName, entries: [] });
    }
    grouped.get(key)!.entries.push({ weekOf: r.weekOf, weight: r.weight, reps: r.reps });
  }

  // Sort entries newest first within each group
  for (const group of grouped.values()) {
    group.entries.sort((a, b) => b.weekOf.getTime() - a.weekOf.getTime());
  }

  return (
    <div className="space-y-3">
      {Array.from(grouped.values()).map((group) => (
        <div
          key={`${group.programDay}::${group.exerciseName}`}
          className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-[#0a1224]"
        >
          <div className="mb-2">
            <span className="text-sm font-semibold">{group.exerciseName}</span>
            <span className="ml-2 text-[11px] text-zinc-400 dark:text-zinc-500">{group.programDay}</span>
          </div>
          <div className="space-y-1">
            {group.entries.map((entry) => {
              const weekLabel = entry.weekOf.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
              return (
                <div
                  key={entry.weekOf.toISOString()}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    Week of {weekLabel}
                  </span>
                  <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                    {entry.weight} × {entry.reps}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
