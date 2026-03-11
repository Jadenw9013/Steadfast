"use client";

import { useTransition, useState } from "react";
import { toggleMealCheckoff, toggleWorkoutComplete } from "@/app/actions/adherence";

type MealRow = {
  mealNameSnapshot: string;
  displayOrder: number;
  completed: boolean;
};

type WorkoutState = {
  completed: boolean;
};

type Props = {
  date: string; // YYYY-MM-DD
  /** Meal names derived from the published plan, in display order. */
  planMeals: { mealName: string; order: number }[];
  /** Today's existing adherence record (null = no record yet). */
  existingMeals: { mealNameSnapshot: string; displayOrder: number; completed: boolean }[];
  workoutCompleted: boolean;
};

export function TodayAdherence({ date, planMeals, existingMeals, workoutCompleted }: Props) {
  const [pending, startTransition] = useTransition();

  // Build initial meal state: merge plan meals with any existing completions
  const initialMeals: MealRow[] = planMeals.map((pm) => {
    const existing = existingMeals.find((e) => e.mealNameSnapshot === pm.mealName);
    return {
      mealNameSnapshot: pm.mealName,
      displayOrder: pm.order,
      completed: existing?.completed ?? false,
    };
  });

  const [meals, setMeals] = useState<MealRow[]>(initialMeals);
  const [workout, setWorkout] = useState<WorkoutState>({ completed: workoutCompleted });

  const hasMeals = planMeals.length > 0;
  const completedCount = meals.filter((m) => m.completed).length;

  function handleMealToggle(mealName: string, displayOrder: number, current: boolean) {
    const next = !current;
    // Optimistic update
    setMeals((prev) =>
      prev.map((m) => (m.mealNameSnapshot === mealName ? { ...m, completed: next } : m))
    );
    startTransition(async () => {
      const result = await toggleMealCheckoff({ date, mealNameSnapshot: mealName, displayOrder, completed: next });
      if (result?.error) {
        // Revert on error
        setMeals((prev) =>
          prev.map((m) => (m.mealNameSnapshot === mealName ? { ...m, completed: current } : m))
        );
      }
    });
  }

  function handleWorkoutToggle() {
    const next = !workout.completed;
    setWorkout({ completed: next });
    startTransition(async () => {
      const result = await toggleWorkoutComplete({ date, completed: next });
      if (result?.error) {
        setWorkout({ completed: !next });
      }
    });
  }

  return (
    <section
      aria-labelledby="today-adherence-heading"
      className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white shadow-sm dark:border-white/[0.06] dark:bg-[#0a1224] dark:shadow-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.06]">
        <h2 id="today-adherence-heading" className="text-sm font-semibold tracking-tight">
          Today
        </h2>
        {hasMeals && (
          <span className="text-xs font-medium text-gray-400 dark:text-zinc-500">
            {completedCount}/{meals.length} meals
          </span>
        )}
      </div>

      <ul role="list" className="divide-y divide-gray-100 dark:divide-white/[0.04]">
        {/* Meal rows */}
        {hasMeals ? (
          meals.map((meal) => (
            <MealRow
              key={meal.mealNameSnapshot}
              meal={meal}
              pending={pending}
              onToggle={() => handleMealToggle(meal.mealNameSnapshot, meal.displayOrder, meal.completed)}
            />
          ))
        ) : (
          <li className="px-5 py-4">
            <p className="text-sm text-gray-400 dark:text-zinc-500">
              No active meal plan to track today
            </p>
          </li>
        )}

        {/* Workout row */}
        <WorkoutRow workout={workout} pending={pending} onToggle={handleWorkoutToggle} />
      </ul>
    </section>
  );
}

function MealRow({
  meal,
  pending,
  onToggle,
}: {
  meal: MealRow;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={meal.completed}
        aria-label={`${meal.mealNameSnapshot} — ${meal.completed ? "Mark incomplete" : "Mark done"}`}
        className={`flex min-h-[44px] w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 disabled:opacity-60 ${
          meal.completed
            ? "bg-emerald-50/60 dark:bg-emerald-950/20"
            : "hover:bg-gray-50 dark:hover:bg-white/[0.02]"
        }`}
      >
        <span
          className={`text-sm font-medium ${
            meal.completed ? "text-emerald-700 dark:text-emerald-400" : "text-gray-700 dark:text-zinc-200"
          }`}
        >
          {meal.mealNameSnapshot}
        </span>
        <CompletionBadge completed={meal.completed} />
      </button>
    </li>
  );
}

function WorkoutRow({
  workout,
  pending,
  onToggle,
}: {
  workout: WorkoutState;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={workout.completed}
        aria-label={`Workout — ${workout.completed ? "Mark incomplete" : "Mark complete"}`}
        className={`flex min-h-[44px] w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 disabled:opacity-60 ${
          workout.completed
            ? "bg-emerald-50/60 dark:bg-emerald-950/20"
            : "hover:bg-gray-50 dark:hover:bg-white/[0.02]"
        }`}
      >
        <span
          className={`text-sm font-medium ${
            workout.completed ? "text-emerald-700 dark:text-emerald-400" : "text-gray-700 dark:text-zinc-200"
          }`}
        >
          Workout
        </span>
        <CompletionBadge completed={workout.completed} />
      </button>
    </li>
  );
}

function CompletionBadge({ completed }: { completed: boolean }) {
  if (completed) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        {/* Checkmark icon */}
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Done
      </span>
    );
  }
  return (
    <span className="shrink-0 text-xs font-medium text-gray-400 dark:text-zinc-500">
      Mark done
    </span>
  );
}
