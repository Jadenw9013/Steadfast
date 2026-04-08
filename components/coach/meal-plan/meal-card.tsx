"use client";

import { memo, useState } from "react";
import { FoodRow } from "./food-row";
import { FoodSearchDropdown } from "./food-search-dropdown";
import type { MealGroup, MealPlanFoodItem, FoodLibraryEntry } from "@/types/meal-plan";

export const MealCard = memo(function MealCard({
  meal,
  mealIndex,
  showMacros,
  foods,
  isFirst,
  isLast,
  onUpdateMealName,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  onRemoveMeal,
  onDuplicateMeal,
  onMoveMealUp,
  onMoveMealDown,
}: {
  meal: MealGroup;
  mealIndex: number;
  showMacros: boolean;
  foods: FoodLibraryEntry[];
  isFirst: boolean;
  isLast: boolean;
  onUpdateMealName: (name: string) => void;
  onUpdateItem: (itemId: string, item: MealPlanFoodItem) => void;
  onRemoveItem: (itemId: string) => void;
  onAddItem: (item: MealPlanFoodItem) => void;
  onRemoveMeal: () => void;
  onDuplicateMeal: () => void;
  onMoveMealUp: () => void;
  onMoveMealDown: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(meal.mealName);
  const [addingFood, setAddingFood] = useState(false);

  const mealTotals = meal.items.reduce(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      protein: acc.protein + item.protein,
      carbs: acc.carbs + item.carbs,
      fats: acc.fats + item.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  const formattedIndex = String(mealIndex + 1).padStart(2, "0");

  return (
    <div className="group/card overflow-hidden sf-glass-card transition-all hover:shadow-lg hover:shadow-blue-500/[0.05] hover:border-white/[0.14]">
      {/* Meal header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          {/* Meal number badge */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-[10px] font-bold tabular-nums text-blue-300">
            {formattedIndex}
          </span>

          {editingName ? (
            <input
              autoFocus
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={() => {
                onUpdateMealName(tempName || "Untitled Meal");
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onUpdateMealName(tempName || "Untitled Meal");
                  setEditingName(false);
                }
                if (e.key === "Escape") {
                  setTempName(meal.mealName);
                  setEditingName(false);
                }
              }}
              className="rounded-lg border border-blue-400/40 bg-white/[0.08] px-2.5 py-1.5 text-sm font-semibold text-white focus:border-blue-400/60 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTempName(meal.mealName);
                setEditingName(true);
              }}
              className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:text-blue-100"
            >
              {meal.mealName}
              {/* Edit pencil hint */}
              <svg className="h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover/card:opacity-100" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}

          {/* Item count */}
          <span className="hidden text-[10px] font-medium text-zinc-400 sm:inline">
            {meal.items.length} {meal.items.length === 1 ? "item" : "items"}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {showMacros && (
            <span className="mr-2 hidden text-xs text-zinc-300 tabular-nums sm:inline">
              {mealTotals.calories} cal | {mealTotals.protein}p {mealTotals.carbs}c {mealTotals.fats}f
            </span>
          )}

          {/* Move up */}
          <button
            type="button"
            onClick={onMoveMealUp}
            disabled={isFirst}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label={`Move ${meal.mealName} up`}
            title="Move up"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m18 15-6-6-6 6"/>
            </svg>
          </button>
          {/* Move down */}
          <button
            type="button"
            onClick={onMoveMealDown}
            disabled={isLast}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label={`Move ${meal.mealName} down`}
            title="Move down"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {/* Separator */}
          <span className="mx-0.5 h-4 w-px bg-white/[0.06]" aria-hidden />

          {/* Duplicate */}
          <button
            type="button"
            onClick={onDuplicateMeal}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-blue-400"
            aria-label={`Duplicate ${meal.mealName}`}
            title="Duplicate"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          {/* Remove meal */}
          <button
            type="button"
            onClick={onRemoveMeal}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            aria-label={`Remove ${meal.mealName}`}
            title="Remove meal"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Food rows */}
      <div className="divide-y divide-white/[0.06]">
        {meal.items.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            showMacros={showMacros}
            foods={foods}
            onUpdate={(updated) => onUpdateItem(item.id, updated)}
            onRemove={() => onRemoveItem(item.id)}
          />
        ))}
      </div>

      {/* Add food */}
      <div className="relative border-t border-white/[0.08] px-5 py-3">
        <button
          type="button"
          onClick={() => setAddingFood(true)}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Food
        </button>
        {addingFood && (
          <FoodSearchDropdown
            foods={foods}
            onSelect={(name, unit) => {
              onAddItem({
                id: crypto.randomUUID(),
                foodName: name,
                quantity: "1",
                unit,
                servingDescription: "",
                calories: 0,
                protein: 0,
                carbs: 0,
                fats: 0,
              });
              setAddingFood(false);
            }}
            onClose={() => setAddingFood(false)}
          />
        )}
      </div>
    </div>
  );
});
