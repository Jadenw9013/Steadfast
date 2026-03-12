"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { AiThinkingAnimation } from "./ai-thinking-animation";
import { diffMealPlans, type ChangeEntry } from "@/lib/utils/diff-meal-plan";
import {
  groupItemsToMeals,
  type MealGroup,
  type MealPlanFoodItem,
} from "@/types/meal-plan";
import {
  splitPortion,
  extractPlanExtras,
  type ParsedMealPlan,
} from "@/lib/validations/meal-plan-import";
import type { PlanExtras } from "@/types/meal-plan-extras";

// ── Quick Actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Increase carbs", icon: "🍚", prompt: "Increase carb portions across all meals" },
  { label: "Add high-carb day", icon: "📈", prompt: "Create a high carb day override for" },
  { label: "Replace ingredient", icon: "🔄", prompt: "Replace " },
  { label: "Add food to meal", icon: "➕", prompt: "Add " },
  { label: "Remove ingredient", icon: "🗑️", prompt: "Remove " },
  { label: "Adjust portions", icon: "📏", prompt: "Change the portion of " },
  { label: "Add supplement", icon: "💊", prompt: "Add a supplement: " },
  { label: "Create day override", icon: "📅", prompt: "Create a day override for " },
  { label: "Custom instruction", icon: "✏️", prompt: "" },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

type AiState =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "preview"; changes: ChangeEntry[]; newMeals: MealGroup[]; newExtras: PlanExtras | null; summary: string }
  | { phase: "error"; message: string };

type AiPlanAssistantProps = {
  open: boolean;
  onClose: () => void;
  currentMeals: MealGroup[];
  currentExtras: PlanExtras | null;
  onApply: (meals: MealGroup[], extras: PlanExtras | null) => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsedPlanToMealGroups(plan: ParsedMealPlan): MealGroup[] {
  const items = plan.meals.flatMap((meal) =>
    meal.items.map((item) => {
      const { quantity, unit } = splitPortion(item.portion);
      return {
        mealName: meal.name,
        foodName: item.food,
        quantity,
        unit,
        servingDescription: item.portion || "",
        calories: 0,
        protein: 0,
        carbs: 0,
        fats: 0,
      };
    })
  );
  return groupItemsToMeals(items);
}

function mealsToApiFormat(meals: MealGroup[]) {
  return meals.map((m) => ({
    name: m.mealName,
    items: m.items.map((i) => ({
      food: i.foodName,
      portion: i.servingDescription || `${i.quantity} ${i.unit}`,
    })),
  }));
}

// ── Change Preview Icons ─────────────────────────────────────────────────────

function ChangeIcon({ type }: { type: ChangeEntry["type"] }) {
  switch (type) {
    case "added":
      return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">+</span>;
    case "removed":
      return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/15 text-[10px] text-red-500 dark:text-red-400">−</span>;
    case "modified":
      return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/15 text-[10px] text-blue-600 dark:text-blue-400">~</span>;
    case "info":
      return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">i</span>;
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AiPlanAssistant({
  open,
  onClose,
  currentMeals,
  currentExtras,
  onApply,
}: AiPlanAssistantProps) {
  const [instruction, setInstruction] = useState("");
  const [aiState, setAiState] = useState<AiState>({ phase: "idle" });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus input when opening
  useEffect(() => {
    if (open && aiState.phase === "idle") {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open, aiState.phase]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed || aiState.phase === "thinking") return;

    setAiState({ phase: "thinking" });

    try {
      const response = await fetch("/api/mealplans/modify-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPlan: {
            title: "Meal Plan",
            meals: mealsToApiFormat(currentMeals),
            extras: currentExtras,
          },
          instruction: trimmed,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      const data = await response.json();
      const plan = data.plan as ParsedMealPlan;

      // Convert to MealGroups
      const newMeals = parsedPlanToMealGroups(plan);
      const newExtras = extractPlanExtras(plan) as PlanExtras | null;

      // Diff
      const changes = diffMealPlans(currentMeals, newMeals, currentExtras, newExtras);

      const summary =
        plan.metadata?.highlightedChanges ||
        (changes.length > 0
          ? `${changes.length} change${changes.length !== 1 ? "s" : ""} detected`
          : "No changes detected");

      setAiState({ phase: "preview", changes, newMeals, newExtras, summary });
    } catch (error) {
      setAiState({
        phase: "error",
        message: error instanceof Error ? error.message : "Something went wrong",
      });
    }
  }, [instruction, aiState.phase, currentMeals, currentExtras]);

  function handleApply() {
    if (aiState.phase !== "preview") return;
    onApply(aiState.newMeals, aiState.newExtras);
    setAiState({ phase: "idle" });
    setInstruction("");
    onClose();
  }

  function handleQuickAction(prompt: string) {
    setInstruction(prompt);
    if (prompt === "") {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function resetToIdle() {
    setAiState({ phase: "idle" });
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl transition-transform duration-300 sm:w-[420px] sm:rounded-l-2xl dark:bg-zinc-900 dark:shadow-blue-500/5"
        role="dialog"
        aria-modal="true"
        aria-label="AI Plan Assistant"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 sm:px-5 sm:py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-sm text-white shadow-lg shadow-blue-500/25">
              ✦
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                AI Plan Editor
              </h2>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Modify your plan with natural language
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close AI assistant"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* ── Idle: Quick actions + input ── */}
          {aiState.phase === "idle" && (
            <div className="space-y-5">
              {/* Quick actions */}
              <div>
                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Quick Actions
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => handleQuickAction(action.prompt)}
                      className="flex flex-col items-center gap-1 rounded-xl border border-zinc-100 bg-zinc-50/50 px-2 py-2.5 text-center transition-all hover:border-blue-200 hover:bg-blue-50/50 hover:shadow-sm active:scale-[0.97] dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-blue-500/30 dark:hover:bg-blue-950/20"
                    >
                      <span className="text-base">{action.icon}</span>
                      <span className="text-[11px] font-medium leading-tight text-zinc-600 dark:text-zinc-300">
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Instruction input */}
              <div>
                <label
                  htmlFor="ai-instruction"
                  className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
                >
                  Instruction
                </label>
                <textarea
                  ref={inputRef}
                  id="ai-instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="e.g., Add a bagel to meal 2 on Mondays and Fridays"
                  rows={3}
                  className="block w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base leading-relaxed text-zinc-800 placeholder:text-zinc-400 transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 sm:px-4 sm:text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
                />
                <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  Press Enter to submit · Shift+Enter for new line
                </p>
              </div>
            </div>
          )}

          {/* ── Thinking ── */}
          {aiState.phase === "thinking" && <AiThinkingAnimation />}

          {/* ── Preview ── */}
          {aiState.phase === "preview" && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-3 dark:border-blue-500/20 dark:from-blue-950/30 dark:to-indigo-950/20">
                <p className="text-xs font-bold text-blue-700 dark:text-blue-300">
                  {aiState.summary}
                </p>
                <p className="mt-0.5 text-[11px] text-blue-600/70 dark:text-blue-400/60">
                  Review the changes below before applying
                </p>
              </div>

              {/* Change list */}
              {aiState.changes.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Changes ({aiState.changes.length})
                  </p>
                  {aiState.changes.map((change, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 rounded-lg border border-zinc-100 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50"
                    >
                      <ChangeIcon type={change.type} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          {change.label}
                        </p>
                        {change.detail && (
                          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                            {change.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    No changes detected
                  </p>
                  <p className="mt-0.5 text-xs text-amber-600/70 dark:text-amber-400/60">
                    Try a more specific instruction
                  </p>
                </div>
              )}

              {/* Edit instruction */}
              <div>
                <p className="mb-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  Not right? Update your instruction:
                </p>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={2}
                  className="block w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {aiState.phase === "error" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-950/20">
                <p className="text-sm font-bold text-red-700 dark:text-red-300">
                  Something went wrong
                </p>
                <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/70">
                  {aiState.message}
                </p>
              </div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                className="block w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 transition-all focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
              />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-zinc-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4 dark:border-zinc-800">
          {aiState.phase === "idle" && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!instruction.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100 dark:shadow-blue-500/10"
            >
              ✦ Apply AI Edit
            </button>
          )}

          {aiState.phase === "thinking" && (
            <button
              type="button"
              onClick={() => setAiState({ phase: "idle" })}
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}

          {aiState.phase === "preview" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={resetToIdle}
                className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 sm:flex-1 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 sm:flex-1 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                ↻ Retry
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={aiState.changes.length === 0}
                className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:shadow-emerald-500/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none sm:flex-[2]"
              >
                Apply Changes
              </button>
            </div>
          )}

          {aiState.phase === "error" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetToIdle}
                className="flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="flex-[2] rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/30 hover:brightness-110 active:scale-[0.98]"
              >
                ↻ Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
