"use client";

import { useState, useMemo } from "react";
import { MealPlanEditorV2 } from "@/components/coach/meal-plan/meal-plan-editor-v2";
import { TrainingProgramEditor } from "@/components/coach/training/training-program-editor";

type Tab = "meal" | "training";

const CARDIO_DAY_NAME = "__CARDIO__";

type CardioPrescription = {
  modality: string;
  frequency: string;
  duration: string;
  intensity: string;
  notes: string;
} | null;

// Extract cardio from training plan days (same format as training-program-editor)
function extractCardio(training: React.ComponentProps<typeof TrainingProgramEditor>): CardioPrescription {
  const program = training.initialProgram;
  if (!program) return null;
  const cardioDay = program.days.find((d) => d.dayName === CARDIO_DAY_NAME);
  if (!cardioDay || cardioDay.blocks.length === 0) return null;
  const b = cardioDay.blocks[0];
  const [modality = "", frequency = "", duration = "", intensity = ""] = (b.title ?? "").split("|");
  return {
    modality: modality.trim(),
    frequency: frequency.trim(),
    duration: duration.trim(),
    intensity: intensity.trim(),
    notes: b.content ?? "",
  };
}

type Props = {
  mealPlan: React.ComponentProps<typeof MealPlanEditorV2>;
  training: React.ComponentProps<typeof TrainingProgramEditor>;
  defaultTab?: Tab;
};

export function PlanTabs({ mealPlan, training, defaultTab = "meal" }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const cardioPrescription = useMemo(() => extractCardio(training), [training]);

  return (
    <div>
      {/* Toggle bar — dark glass theme */}
      <div className="flex items-center gap-1 rounded-xl bg-white/[0.04] border border-white/[0.06] p-1">
        {(["meal", "training"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`plan-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`plan-panel-${t}`}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
              tab === t
                ? "bg-white/[0.10] text-zinc-100 shadow-sm shadow-black/20"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
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
        <MealPlanEditorV2 {...mealPlan} cardioPrescription={cardioPrescription} />
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
