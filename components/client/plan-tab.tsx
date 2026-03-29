"use client";

import { useState } from "react";

export function PlanTab({
  mealPlanContent,
  trainingContent,
}: {
  mealPlanContent: React.ReactNode;
  trainingContent: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<"meal" | "training">("meal");

  return (
    <div className="space-y-6">
      {/* Segmented control — iOS style */}
      <div className="flex rounded-xl bg-white/[0.04] p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("meal")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
            activeTab === "meal"
              ? "bg-white/[0.08] text-white"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Meal Plan
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("training")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
            activeTab === "training"
              ? "bg-white/[0.08] text-white"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Training
        </button>
      </div>

      {/* Tab content */}
      <div className={activeTab === "meal" ? "block" : "hidden"}>
        {mealPlanContent}
      </div>
      <div className={activeTab === "training" ? "block" : "hidden"}>
        {trainingContent}
      </div>
    </div>
  );
}
