"use client";

import { useState } from "react";
import {
  createDraftMealPlan,
  saveDraftMealPlan,
  publishMealPlan,
} from "@/app/actions/meal-plans";
import { useRouter } from "next/navigation";

type MealPlanItem = {
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
};

type DraftPlan = {
  id: string;
  items: MealPlanItem[];
};

export function MealPlanEditor({
  clientId,
  weekStartDate,
  draft,
  hasPublished,
}: {
  clientId: string;
  weekStartDate: string;
  draft: DraftPlan | null;
  hasPublished: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<DraftPlan | null>(draft);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleCreate(copyFromPublished: boolean) {
    setCreating(true);
    try {
      const result = await createDraftMealPlan({
        clientId,
        weekStartDate,
        // Foods-only editor: never let the draft's mode fall through to
        // `CoachClient.planMode` (T-102a).
        planMode: "MEAL_PLAN",
        // Copy-forward is the default now; `startBlank` is the only opt-out.
        startBlank: !copyFromPublished,
      });
      if ("mealPlanId" in result) {
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to create draft:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    if (!plan) return;
    setSaving(true);
    try {
      await saveDraftMealPlan({
        mealPlanId: plan.id,
        items: plan.items.map((item, i) => ({ ...item, sortOrder: i })),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to save draft:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!plan) return;
    setPublishing(true);
    try {
      await saveDraftMealPlan({
        mealPlanId: plan.id,
        items: plan.items.map((item, i) => ({ ...item, sortOrder: i })),
      });
      await publishMealPlan({ mealPlanId: plan.id });
      router.refresh();
    } catch (err) {
      console.error("Failed to publish:", err);
    } finally {
      setPublishing(false);
    }
  }

  function addItem() {
    if (!plan) return;
    setPlan({
      ...plan,
      items: [
        ...plan.items,
        {
          mealName: "",
          foodName: "",
          quantity: "1",
          unit: "serving",
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0,
        },
      ],
    });
  }

  function removeItem(index: number) {
    if (!plan) return;
    setPlan({
      ...plan,
      items: plan.items.filter((_, i) => i !== index),
    });
  }

  function updateItem(index: number, field: keyof MealPlanItem, value: string) {
    if (!plan) return;
    const items = [...plan.items];
    const numFields = ["calories", "protein", "carbs", "fats"] as const;
    if ((numFields as readonly string[]).includes(field)) {
      (items[index] as Record<string, unknown>)[field] =
        value === "" ? 0 : Number(value);
    } else {
      (items[index] as Record<string, unknown>)[field] = value;
    }
    setPlan({ ...plan, items });
  }

  // No draft — show create button
  if (!plan) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
        <h3 className="mb-3 text-sm font-semibold">Meal Plan</h3>
        <p className="mb-3 text-sm text-zinc-500">No draft for this week.</p>
        <div className="space-y-2">
          <button
            onClick={() => handleCreate(false)}
            disabled={creating}
            className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {creating ? "Creating..." : "New Draft"}
          </button>
          {hasPublished && (
            <button
              onClick={() => handleCreate(true)}
              disabled={creating}
              className="w-full rounded-md border border-white/[0.1] px-3 py-2 text-sm font-medium transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Copy from last published
            </button>
          )}
        </div>
      </div>
    );
  }

  // Totals
  const totals = plan.items.reduce(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      protein: acc.protein + item.protein,
      carbs: acc.carbs + item.carbs,
      fats: acc.fats + item.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.04]">
      <div className="border-b border-white/[0.08] px-4 py-3">
        <h3 className="text-sm font-semibold">Meal Plan (Draft)</h3>
      </div>

      <div className="max-h-[400px] overflow-y-auto p-4">
        {plan.items.length === 0 ? (
          <p className="text-center text-sm text-zinc-400">
            No items yet. Add a row below.
          </p>
        ) : (
          <div className="space-y-3">
            {plan.items.map((item, i) => (
              <fieldset
                key={i}
                className="space-y-1.5 rounded-md border border-white/[0.06] p-2"
              >
                <legend className="sr-only">Meal item {i + 1}</legend>
                <div className="flex gap-2">
                  <input
                    placeholder="Meal (e.g. Breakfast)"
                    value={item.mealName}
                    onChange={(e) => updateItem(i, "mealName", e.target.value)}
                    aria-label={`Meal name for item ${i + 1}`}
                    className="w-1/3 rounded-md border border-white/[0.1] px-2 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <input
                    placeholder="Food name"
                    value={item.foodName}
                    onChange={(e) => updateItem(i, "foodName", e.target.value)}
                    aria-label={`Food name for item ${i + 1}`}
                    className="flex-1 rounded-md border border-white/[0.1] px-2 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <button
                    onClick={() => removeItem(i)}
                    aria-label={`Remove item ${i + 1}`}
                    className="text-xs text-red-500 transition-colors hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-6 gap-1">
                  <input
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateItem(i, "quantity", e.target.value)}
                    aria-label={`Quantity for item ${i + 1}`}
                    className="rounded-md border border-white/[0.1] px-1.5 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <input
                    placeholder="Unit"
                    value={item.unit}
                    onChange={(e) => updateItem(i, "unit", e.target.value)}
                    aria-label={`Unit for item ${i + 1}`}
                    className="rounded-md border border-white/[0.1] px-1.5 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <input
                    type="number"
                    placeholder="Cal"
                    value={item.calories || ""}
                    onChange={(e) => updateItem(i, "calories", e.target.value)}
                    aria-label={`Calories for item ${i + 1}`}
                    className="rounded-md border border-white/[0.1] px-1.5 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <input
                    type="number"
                    placeholder="P"
                    value={item.protein || ""}
                    onChange={(e) => updateItem(i, "protein", e.target.value)}
                    aria-label={`Protein for item ${i + 1}`}
                    className="rounded-md border border-white/[0.1] px-1.5 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <input
                    type="number"
                    placeholder="C"
                    value={item.carbs || ""}
                    onChange={(e) => updateItem(i, "carbs", e.target.value)}
                    aria-label={`Carbs for item ${i + 1}`}
                    className="rounded-md border border-white/[0.1] px-1.5 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                  <input
                    type="number"
                    placeholder="F"
                    value={item.fats || ""}
                    onChange={(e) => updateItem(i, "fats", e.target.value)}
                    aria-label={`Fats for item ${i + 1}`}
                    className="rounded-md border border-white/[0.1] px-1.5 py-1 text-xs transition-colors focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      {plan.items.length > 0 && (
        <div className="border-t border-white/[0.08] px-4 py-2">
          <div className="flex gap-4 text-xs text-zinc-500">
            <span>Total: {totals.calories} kcal</span>
            <span>P: {totals.protein}g</span>
            <span>C: {totals.carbs}g</span>
            <span>F: {totals.fats}g</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 border-t border-white/[0.08] p-3">
        <button
          onClick={addItem}
          className="rounded-md border border-white/[0.1] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
        >
          + Add Row
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Draft"}
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing || plan.items.length === 0}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {publishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
