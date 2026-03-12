"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MealCard } from "./meal-card";
import { MealPlanActions } from "./meal-plan-actions";
import { PlanExtrasEditor } from "./plan-extras-display";
import { AiPlanAssistant } from "./ai-plan-assistant";
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
  const [previousExtras, setPreviousExtras] = useState<PlanExtras | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notifyClient, setNotifyClient] = useState(coachDefaultNotify ?? true);
  const [highlightedMeals, setHighlightedMeals] = useState<Set<string>>(new Set());

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
    setPreviousExtras(planExtras);
  }

  function undo() {
    if (previousMeals) {
      setMeals(previousMeals);
      setPreviousMeals(null);
    }
    if (previousExtras !== null) {
      setPlanExtras(previousExtras);
      setPreviousExtras(null);
    }
    setHighlightedMeals(new Set());
  }

  /** Apply AI-generated changes */
  function applyAiChanges(newMeals: MealGroup[], newExtras: PlanExtras | null) {
    saveSnapshot();
    setMeals(newMeals);
    if (newExtras) setPlanExtras(newExtras);
    // Flash highlight on changed meals
    const changedNames = new Set(
      newMeals
        .filter((nm) => {
          const original = meals.find((m) => m.mealName === nm.mealName);
          if (!original) return true; // new meal
          if (original.items.length !== nm.items.length) return true;
          return original.items.some(
            (oi, idx) =>
              nm.items[idx]?.foodName !== oi.foodName ||
              nm.items[idx]?.servingDescription !== oi.servingDescription
          );
        })
        .map((m) => m.mealName)
    );
    setHighlightedMeals(changedNames);
    setTimeout(() => setHighlightedMeals(new Set()), 3000);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{statusLabel}</h3>
          {effectivePlan.source === "published" && isUnsaved && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              from published
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="group flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-600 transition-all hover:bg-blue-100 hover:border-blue-400 hover:shadow-sm active:scale-[0.97] sm:px-3 dark:border-blue-500/30 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50 dark:hover:border-blue-500/50"
            aria-label="Modify plan with AI"
          >
            <svg className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z" fill="currentColor" />
              <path d="M12 9l.75 1.75L14.5 11.5l-1.75.75L12 14l-.75-1.75-1.75-.75 1.75-.75L12 9z" fill="currentColor" opacity="0.6" />
              <path d="M4 10l.5 1.5L6 12l-1.5.5L4 14l-.5-1.5L2 12l1.5-.5L4 10z" fill="currentColor" opacity="0.4" />
            </svg>
            <span className="hidden sm:inline">Modify with AI</span>
            <span className="sm:hidden">AI</span>
          </button>
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
        </div>
      </div>

      {/* Meal cards */}
      <div className="space-y-2">
        {meals.map((meal, i) => (
          <div
            key={`${meal.mealName}-${i}`}
            className={`transition-all duration-700 ${
              highlightedMeals.has(meal.mealName)
                ? "ring-2 ring-blue-400/50 rounded-lg shadow-md shadow-blue-500/10 dark:ring-blue-500/40"
                : ""
            }`}
          >
            <MealCard
              meal={meal}
              showMacros={false}
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
          </div>
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

      {/* AI Plan Assistant drawer */}
      <AiPlanAssistant
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        currentMeals={meals}
        currentExtras={planExtras}
        onApply={applyAiChanges}
      />
    </div>
  );
}
