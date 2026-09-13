"use client";

import { useMemo, useState, useTransition } from "react";
import { toggleMealCheckoff } from "@/app/actions/adherence";
import type { MacroMealTarget } from "@/types/meal-plan";

type MacroAdherenceProps = {
  date: string;             // YYYY-MM-DD
  completedMeals: string[]; // mealNameSnapshots already completed
};

/** Proportional macro split by calories (protein/carbs = 4 cal/g, fat = 9 cal/g). */
function macroSplit(m: { protein: number; carbs: number; fats: number }) {
  const p = m.protein * 4, c = m.carbs * 4, f = m.fats * 9;
  const total = p + c + f;
  if (total === 0) return { p: 0, c: 0, f: 0 };
  return { p: (p / total) * 100, c: (c / total) * 100, f: (f / total) * 100 };
}

function MacroStackedBar({ target }: { target: { protein: number; carbs: number; fats: number } }) {
  const split = macroSplit(target);
  const hasAny = target.protein + target.carbs + target.fats > 0;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      {hasAny ? (
        <>
          <div className="bg-emerald-500/80" style={{ width: `${split.p}%` }} />
          <div className="bg-amber-500/80" style={{ width: `${split.c}%` }} />
          <div className="bg-rose-500/80" style={{ width: `${split.f}%` }} />
        </>
      ) : null}
    </div>
  );
}

function DailyMacroSummary({ meals }: { meals: MacroMealTarget[] }) {
  const totals = useMemo(
    () =>
      meals.reduce(
        (acc, m) => ({
          calories: acc.calories + m.calories,
          protein: acc.protein + m.protein,
          carbs: acc.carbs + m.carbs,
          fats: acc.fats + m.fats,
        }),
        { calories: 0, protein: 0, carbs: 0, fats: 0 }
      ),
    [meals]
  );

  if (totals.calories === 0 && totals.protein === 0 && totals.carbs === 0 && totals.fats === 0) return null;

  return (
    <div className="sf-glass-card p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">Today&rsquo;s Targets</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-black tabular-nums text-white">{totals.calories}</span>
        <span className="text-sm font-semibold text-zinc-500">calories</span>
      </div>
      <div className="mt-3">
        <MacroStackedBar target={totals} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-base font-bold tabular-nums text-emerald-400">{totals.protein}g</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Protein</p>
        </div>
        <div>
          <p className="text-base font-bold tabular-nums text-amber-400">{totals.carbs}g</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Carbs</p>
        </div>
        <div>
          <p className="text-base font-bold tabular-nums text-rose-400">{totals.fats}g</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Fats</p>
        </div>
      </div>
    </div>
  );
}

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
            className="relative flex shrink-0 cursor-pointer items-center justify-center"
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
          <span className="text-lg font-black tabular-nums text-white">{meal.calories}</span>
          <span className="ml-1 text-[11px] font-semibold text-zinc-500">cal</span>
        </div>
      </div>

      {hasAny && (
        <div className="px-4 pb-4">
          <MacroStackedBar target={meal} />
          <div className="mt-2.5 flex items-center justify-between text-xs font-semibold tabular-nums">
            <span className="text-emerald-400">{meal.protein}g protein</span>
            <span className="text-amber-400">{meal.carbs}g carbs</span>
            <span className="text-rose-400">{meal.fats}g fats</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MacroPlanView({
  meals,
  supportContent,
  adherence,
}: {
  meals: MacroMealTarget[];
  supportContent?: string | null;
  adherence?: MacroAdherenceProps;
}) {
  const [completedMeals, setCompletedMeals] = useState<Set<string>>(() => new Set(adherence?.completedMeals ?? []));
  const [isPending, startTransition] = useTransition();

  function handleToggle(mealName: string, index: number) {
    if (!adherence?.date) return;
    const wasDone = completedMeals.has(mealName);
    const next = !wasDone;
    setCompletedMeals((prev) => {
      const s = new Set(prev);
      if (next) s.add(mealName); else s.delete(mealName);
      return s;
    });
    startTransition(async () => {
      const result = await toggleMealCheckoff({ date: adherence.date, mealNameSnapshot: mealName, displayOrder: index, completed: next });
      if (result?.error) {
        setCompletedMeals((prev) => {
          const s = new Set(prev);
          if (wasDone) s.add(mealName); else s.delete(mealName);
          return s;
        });
      }
    });
  }

  if (meals.length === 0) {
    return (
      <div className="sf-glass-card px-6 py-10 text-center">
        <p className="text-sm font-bold text-white">No macro targets yet</p>
        <p className="mt-1 text-xs text-zinc-500">Your coach hasn&rsquo;t set macro targets for this week yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DailyMacroSummary meals={meals} />

      {meals.map((meal, i) => (
        <MacroMealCard
          key={`${meal.mealName}-${i}`}
          meal={meal}
          isDone={completedMeals.has(meal.mealName)}
          showCheckoff={Boolean(adherence)}
          onToggle={() => handleToggle(meal.mealName, i)}
          pending={isPending}
        />
      ))}

      {supportContent && (
        <div className="sf-glass-card p-5">
          <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">Guidance & Support</h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300/90">{supportContent}</div>
        </div>
      )}
    </div>
  );
}
