"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MealCard } from "./meal-card";
import { MacroToggle } from "./macro-toggle";
import { MealPlanActions } from "./meal-plan-actions";
import { PlanExtrasEditor } from "./plan-extras-display";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";
import {
  createDraftMealPlan,
  saveDraftMealPlan,
  publishMealPlan,
} from "@/app/actions/meal-plans";
import {
  groupItemsToMeals,
  flattenMeals,
  type MealGroup,
  type MealPlanFoodItem,
  type FoodLibraryEntry,
} from "@/types/meal-plan";
import type { PlanExtras } from "@/types/meal-plan-extras";
import type { EffectiveMealPlan } from "@/lib/queries/meal-plans";

export function MealPlanEditorV2({
  clientId,
  weekStartDate,
  effectivePlan,
  foods,
  coachDefaultNotify,
  publishedMealPlanId,
}: {
  clientId: string;
  weekStartDate: string;
  effectivePlan: EffectiveMealPlan;
  foods: FoodLibraryEntry[];
  coachDefaultNotify?: boolean;
  publishedMealPlanId?: string | null;
}) {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string | null>(effectivePlan.draftId);
  const [meals, setMeals] = useState<MealGroup[]>(
    groupItemsToMeals(effectivePlan.items)
  );
  const [planExtras, setPlanExtras] = useState<PlanExtras | null>(effectivePlan.planExtras);
  const [previousMeals, setPreviousMeals] = useState<MealGroup[] | null>(null);
  const [showMacros, setShowMacros] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notifyClient, setNotifyClient] = useState(coachDefaultNotify ?? true);

  const isUnsaved = draftId === null;
  const totalItems = meals.reduce((sum, m) => sum + m.items.length, 0);

  const dailyTotals = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        acc.calories += item.calories;
        acc.protein += item.protein;
        acc.carbs += item.carbs;
        acc.fats += item.fats;
      }
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  function saveSnapshot() {
    setPreviousMeals(
      meals.map((m) => ({ ...m, items: [...m.items] }))
    );
  }

  function undo() {
    if (previousMeals) {
      setMeals(previousMeals);
      setPreviousMeals(null);
    }
  }

  /** Create a DB draft (with current items) and return its ID. */
  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId;
    const result = await createDraftMealPlan({
      clientId,
      weekStartDate,
      items: flattenMeals(meals),
      planExtras: planExtras ?? undefined,
    });
    if ("mealPlanId" in result) {
      setDraftId(result.mealPlanId);
      return result.mealPlanId;
    }
    return null;
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (draftId) {
        await saveDraftMealPlan({
          mealPlanId: draftId,
          items: flattenMeals(meals),
          planExtras: planExtras ?? undefined,
        });
      } else {
        await ensureDraft();
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const id = draftId ?? (await ensureDraft());
      if (!id) return;
      // Save latest items before publishing
      await saveDraftMealPlan({
        mealPlanId: id,
        items: flattenMeals(meals),
        planExtras: planExtras ?? undefined,
      });
      await publishMealPlan({ mealPlanId: id, notifyClient });
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }

  const updateMealName = useCallback((index: number, name: string) => {
    setMeals((prev) =>
      prev.map((m, i) => (i === index ? { ...m, mealName: name } : m))
    );
  }, []);

  const updateItem = useCallback((mealIndex: number, itemId: string, updated: MealPlanFoodItem) => {
    setMeals((prev) =>
      prev.map((m, i) =>
        i === mealIndex
          ? {
              ...m,
              items: m.items.map((item) =>
                item.id === itemId ? updated : item
              ),
            }
          : m
      )
    );
  }, []);

  const removeItem = useCallback((mealIndex: number, itemId: string) => {
    setMeals((prev) => {
      setPreviousMeals(prev.map((m) => ({ ...m, items: [...m.items] })));
      const updated = prev.map((m, i) =>
        i === mealIndex
          ? { ...m, items: m.items.filter((item) => item.id !== itemId) }
          : m
      );
      return updated.filter((m) => m.items.length > 0);
    });
  }, []);

  const addItemToMeal = useCallback((mealIndex: number, item: MealPlanFoodItem) => {
    setMeals((prev) =>
      prev.map((m, i) =>
        i === mealIndex ? { ...m, items: [...m.items, item] } : m
      )
    );
  }, []);

  function removeMeal(mealIndex: number) {
    saveSnapshot();
    setMeals((prev) => prev.filter((_, i) => i !== mealIndex));
  }

  function addMeal() {
    setMeals((prev) => [
      ...prev,
      { mealName: `Meal ${prev.length + 1}`, items: [] },
    ]);
  }

  function duplicateMeal(index: number) {
    saveSnapshot();
    setMeals((prev) => {
      const original = prev[index];
      const copy: MealGroup = {
        mealName: `${original.mealName} (Copy)`,
        items: original.items.map((item) => ({
          ...item,
          id: crypto.randomUUID(),
        })),
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function moveMeal(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= meals.length) return;
    saveSnapshot();
    setMeals((prev) => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  const statusLabel =
    effectivePlan.source === "empty" && isUnsaved
      ? "Meal Plan"
      : isUnsaved
        ? "Unsaved"
        : "Draft";

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{statusLabel}</h3>
          {effectivePlan.source === "published" && isUnsaved && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              from published
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {(publishedMealPlanId || draftId) && (
            <ExportPdfButton
              mealPlanId={(publishedMealPlanId ?? draftId)!}
              variant="small"
            />
          )}
          <button
            type="button"
            onClick={undo}
            disabled={!previousMeals}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
            aria-label="Undo last change"
          >
            Undo
          </button>
          <MacroToggle enabled={showMacros} onToggle={setShowMacros} />
        </div>
      </div>

      {/* Meal cards */}
      <div className="space-y-2">
        {meals.map((meal, i) => (
          <MealCard
            key={`${meal.mealName}-${i}`}
            meal={meal}
            showMacros={showMacros}
            foods={foods}
            isFirst={i === 0}
            isLast={i === meals.length - 1}
            onUpdateMealName={(name) => updateMealName(i, name)}
            onUpdateItem={(itemId, updated) => updateItem(i, itemId, updated)}
            onRemoveItem={(itemId) => removeItem(i, itemId)}
            onAddItem={(item) => addItemToMeal(i, item)}
            onRemoveMeal={() => removeMeal(i)}
            onDuplicateMeal={() => duplicateMeal(i)}
            onMoveMealUp={() => moveMeal(i, "up")}
            onMoveMealDown={() => moveMeal(i, "down")}
          />
        ))}
      </div>

      {/* Add meal button */}
      <button
        type="button"
        onClick={addMeal}
        className="w-full rounded-lg border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
      >
        + Add Meal
      </button>

      {/* Plan extras (editable) */}
      {planExtras && (
        <PlanExtrasEditor
          extras={planExtras}
          onChange={setPlanExtras}
          mealNames={meals.map((m) => m.mealName)}
        />
      )}

      {/* Daily totals (only when macros visible) */}
      {showMacros && totalItems > 0 && (
        <div className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Daily Totals
            </span>
            <div className="flex gap-3 text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
              <span>{dailyTotals.calories} cal</span>
              <span>{dailyTotals.protein}p</span>
              <span>{dailyTotals.carbs}c</span>
              <span>{dailyTotals.fats}f</span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <MealPlanActions
        saving={saving}
        publishing={publishing}
        itemCount={totalItems}
        isUnsaved={isUnsaved}
        notifyClient={notifyClient}
        onNotifyChange={setNotifyClient}
        onSave={handleSave}
        onPublish={handlePublish}
      />
    </div>
  );
}
