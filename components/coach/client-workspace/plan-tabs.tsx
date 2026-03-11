"use client";

import { useState } from "react";
import { MealPlanEditorV2 } from "@/components/coach/meal-plan/meal-plan-editor-v2";
import { TrainingProgramEditor } from "@/components/coach/training/training-program-editor";

type Tab = "meal" | "training";

type Props = {
  mealPlan: React.ComponentProps<typeof MealPlanEditorV2>;
  training: React.ComponentProps<typeof TrainingProgramEditor>;
  defaultTab?: Tab;
};

export function PlanTabs({ mealPlan, training, defaultTab = "meal" }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab);

  return (
    <div>
      {/* Toggle bar */}
      <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {(["meal", "training"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`plan-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`plan-panel-${t}`}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${
              tab === t
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t === "meal" ? "Meal Plan" : "Training Plan"}
          </button>
        ))}
      </div>

      {/* Panels — both mounted to preserve editor state; hidden via attribute */}
      <div
        id="plan-panel-meal"
        role="tabpanel"
        aria-labelledby="plan-tab-meal"
        className="pt-5"
        hidden={tab !== "meal"}
      >
        <MealPlanEditorV2 {...mealPlan} />
      </div>
      <div
        id="plan-panel-training"
        role="tabpanel"
        aria-labelledby="plan-tab-training"
        className="pt-5"
        hidden={tab !== "training"}
      >
        <TrainingProgramEditor {...training} />
      </div>
    </div>
  );
}
