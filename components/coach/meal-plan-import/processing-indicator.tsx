"use client";

import { useState, useEffect } from "react";

const STAGES = [
  { label: "Reading text input", duration: 3000 },
  { label: "Extracting meals & food items", duration: 8000 },
  { label: "Identifying supplements & rules", duration: 10000 },
  { label: "Structuring plan data", duration: 6000 },
  { label: "Finalizing extraction", duration: 5000 },
];

const UPLOAD_STAGES = [
  { label: "Uploading file", duration: 2000 },
  { label: "Running OCR on document", duration: 6000 },
  { label: "Extracting meals & food items", duration: 8000 },
  { label: "Identifying supplements & rules", duration: 10000 },
  { label: "Structuring plan data", duration: 6000 },
];

export function ProcessingIndicator({ mode = "paste" }: { mode?: "paste" | "upload" }) {
  const stages = mode === "upload" ? UPLOAD_STAGES : STAGES;
  const [stageIndex, setStageIndex] = useState(0);
  const [stageProgress, setStageProgress] = useState(0);

  useEffect(() => {
    const stage = stages[stageIndex];
    if (!stage) return;

    const tickInterval = 50; // ms between progress updates
    const totalTicks = stage.duration / tickInterval;
    let tick = 0;

    const interval = setInterval(() => {
      tick++;
      // Ease-out progress within each stage
      const rawProgress = tick / totalTicks;
      const easedProgress = Math.min(1, 1 - Math.pow(1 - rawProgress, 2));
      setStageProgress(easedProgress);

      if (tick >= totalTicks && stageIndex < stages.length - 1) {
        setStageIndex((prev) => prev + 1);
        setStageProgress(0);
      }
    }, tickInterval);

    return () => clearInterval(interval);
  }, [stageIndex, stages]);

  // Overall progress (0 to 1)
  const overallProgress = Math.min(
    0.98,
    (stageIndex + stageProgress) / stages.length
  );
  const percentDisplay = Math.round(overallProgress * 100);

  const currentStage = stages[stageIndex] ?? stages[stages.length - 1];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700/50 dark:bg-zinc-900">
      {/* Progress bar */}
      <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-r-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300 ease-out"
          style={{ width: `${overallProgress * 100}%` }}
        />
      </div>

      <div className="px-4 py-3.5">
        {/* Stage label + percentage */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-5 w-5 items-center justify-center">
              <div className="absolute h-5 w-5 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-500" />
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {currentStage.label}
            </span>
          </div>
          <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {percentDisplay}%
          </span>
        </div>

        {/* Stage dots */}
        <div className="mt-3 flex items-center gap-1.5">
          {stages.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  i < stageIndex
                    ? "bg-emerald-500"
                    : i === stageIndex
                      ? "bg-emerald-500 ring-2 ring-emerald-500/20"
                      : "bg-zinc-200 dark:bg-zinc-700"
                }`}
              />
              {i < stages.length - 1 && (
                <div
                  className={`h-px w-3 transition-colors duration-300 ${
                    i < stageIndex ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Sub-label */}
        <p className="mt-2 text-[11px] text-zinc-400">
          AI is analyzing your meal plan — this usually takes 15-30 seconds
        </p>
      </div>
    </div>
  );
}
