"use client";

import { MacroStackedBar, formatTotal } from "./daily-totals-card";
import type { MacroMealTarget } from "@/types/meal-plan";

/**
 * T-802a — demoted to a pure meal-list renderer. State (`completedMeals`,
 * pending, the checkoff write) now lives in the shell
 * (`components/client/simple-meal-plan.tsx`), which calls this with props
 * only. No `@/app/actions/adherence` import here any more — the shell owns
 * the one handler both lists call.
 */

function MacroMealCard({
  meal,
  isDone,
  showCheckoff,
  onToggle,
  pending,
}: {
  meal: MacroMealTarget;
  isDone: boolean;
  showCheckoff: boolean;
  onToggle: () => void;
  pending: boolean;
}) {
  const hasAny = meal.protein + meal.carbs + meal.fats > 0;

  return (
    <div className={`sf-glass-card overflow-hidden transition-all ${isDone ? "border-emerald-900/30" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {showCheckoff && (
          <label
            className="relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center"
            aria-label={`${meal.mealName}: ${isDone ? "mark incomplete" : "mark complete"}`}
          >
            <input type="checkbox" checked={isDone} onChange={onToggle} disabled={pending} className="peer sr-only" />
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
              isDone ? "border-emerald-500 bg-emerald-500" : "border-zinc-600 bg-transparent"
            } peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-disabled:opacity-50`}>
              {isDone && (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </span>
          </label>
        )}

        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-bold tracking-tight ${isDone ? "text-emerald-400 line-through decoration-emerald-500/30" : "text-white"}`}>
            {meal.mealName}
          </h3>
        </div>

        <div className="shrink-0 text-right">
          <span className="text-lg font-black tabular-nums text-white">{formatTotal(meal.calories)}</span>
          <span className="ml-1 text-[11px] font-semibold text-zinc-500">cal</span>
        </div>
      </div>

      {hasAny && (
        <div className="px-4 pb-4">
          <MacroStackedBar target={meal} />
          <div className="mt-2.5 flex items-center justify-between text-xs font-semibold tabular-nums">
            <span className="text-emerald-400">{formatTotal(meal.protein)}g protein</span>
            <span className="text-amber-400">{formatTotal(meal.carbs)}g carbs</span>
            <span className="text-rose-400">{formatTotal(meal.fats)}g fats</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MacroMealList({
  meals,
  showCheckoff,
  completedMeals,
  onToggle,
  pending,
}: {
  meals: MacroMealTarget[];
  showCheckoff: boolean;
  completedMeals: Set<string>;
  onToggle: (mealName: string, index: number) => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      {meals.map((meal, i) => (
        <MacroMealCard
          key={`${meal.mealName}-${i}`}
          meal={meal}
          isDone={showCheckoff && completedMeals.has(meal.mealName)}
          showCheckoff={showCheckoff}
          onToggle={() => onToggle(meal.mealName, i)}
          pending={pending}
        />
      ))}
    </div>
  );
}
