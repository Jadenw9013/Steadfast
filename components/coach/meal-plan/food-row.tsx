"use client";

import { memo } from "react";
import type { MealPlanFoodItem, FoodLibraryEntry } from "@/types/meal-plan";

export const FoodRow = memo(function FoodRow({
  item,
  showMacros,
  foods,
  onUpdate,
  onRemove,
}: {
  item: MealPlanFoodItem;
  showMacros: boolean;
  foods: FoodLibraryEntry[];
  onUpdate: (updated: MealPlanFoodItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.04]">
      {/* Portion input */}
      <div className="w-28 shrink-0 sm:w-36">
        <label className="sr-only" htmlFor={`portion-${item.id}`}>
          Portion for {item.foodName}
        </label>
        <input
          id={`portion-${item.id}`}
          type="text"
          value={item.servingDescription || ""}
          onChange={(e) =>
            onUpdate({ ...item, servingDescription: e.target.value })
          }
          placeholder="portion"
          aria-label={`Portion for ${item.foodName}`}
          className="w-full rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-sm font-medium text-white placeholder:text-zinc-500 transition-all focus:border-blue-400/60 focus:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-blue-400/30"
        />
      </div>

      {/* Food name — directly editable */}
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor={`food-${item.id}`}>
          Food name
        </label>
        <input
          id={`food-${item.id}`}
          type="text"
          value={item.foodName}
          onChange={(e) =>
            onUpdate({ ...item, foodName: e.target.value })
          }
          placeholder="food name"
          aria-label={`Food name for ${item.foodName}`}
          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm font-semibold text-white placeholder:text-zinc-500 transition-all hover:border-white/[0.10] hover:bg-white/[0.04] focus:border-blue-400/60 focus:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-blue-400/30"
        />

        {showMacros && (
          <div className="mt-1.5 flex gap-2 px-2">
            <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-300">
              {item.calories} cal
            </span>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-300">
              {item.protein}p
            </span>
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300">
              {item.carbs}c
            </span>
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-rose-300">
              {item.fats}f
            </span>
          </div>
        )}
      </div>

      {/* Remove button — icon only */}
      <button
        type="button"
        onClick={onRemove}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400"
        aria-label={`Remove ${item.foodName}`}
        title="Remove"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  );
});
