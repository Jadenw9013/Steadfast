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
  { label: "Increase carbs", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>, prompt: "Increase carb portions across all meals" },
  { label: "Add high-carb day", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>, prompt: "Create a high carb day override for" },
  { label: "Replace ingredient", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>, prompt: "Replace " },
  { label: "Add food to meal", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>, prompt: "Add " },
  { label: "Remove ingredient", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>, prompt: "Remove " },
  { label: "Adjust portions", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>, prompt: "Change the portion of " },
  { label: "Add supplement", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>, prompt: "Add a supplement: " },
  { label: "Create day override", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, prompt: "Create a day override for " },
  { label: "Custom instruction", icon: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, prompt: "" },
] satisfies { label: string; icon: React.ReactNode; prompt: string }[];

// ── Types ────────────────────────────────────────────────────────────────────

type AiState =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "preview"; changes: ChangeEntry[]; newMeals: MealGroup[]; newExtras: PlanExtras | null; newSupportContent: string | null; summary: string }
  | { phase: "error"; message: string };

type AiPlanAssistantProps = {
  open: boolean;
  onClose: () => void;
  currentMeals: MealGroup[];
  currentExtras: PlanExtras | null;
  onApply: (meals: MealGroup[], extras: PlanExtras | null, newSupport: string | null) => void;
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

const CHANGE_STYLES = {
  added: { bg: "bg-emerald-500/15", border: "border-emerald-500/20", text: "text-emerald-400", icon: "+" },
  removed: { bg: "bg-red-500/15", border: "border-red-500/20", text: "text-red-400", icon: "−" },
  modified: { bg: "bg-blue-500/15", border: "border-blue-500/20", text: "text-blue-400", icon: "~" },
  info: { bg: "bg-amber-500/15", border: "border-amber-500/20", text: "text-amber-400", icon: "i" },
} as const;

function ChangeIcon({ type }: { type: ChangeEntry["type"] }) {
  const style = CHANGE_STYLES[type];
  return (
    <span className={`flex h-5 w-5 items-center justify-center rounded-full ${style.bg} text-[10px] font-bold ${style.text}`}>
      {style.icon}
    </span>
  );
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

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [instruction]);

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

      const newMeals = parsedPlanToMealGroups(plan);
      const newExtras = extractPlanExtras(plan) as PlanExtras | null;
      const newSupportContent = plan.supportContent ?? null;

      const changes = diffMealPlans(currentMeals, newMeals, currentExtras, newExtras, newSupportContent);

      const summary =
        plan.metadata?.highlightedChanges ||
        (changes.length > 0
          ? `${changes.length} change${changes.length !== 1 ? "s" : ""} detected`
          : "No changes detected");

      setAiState({ phase: "preview", changes, newMeals, newExtras, summary, newSupportContent });
    } catch (error) {
      setAiState({
        phase: "error",
        message: error instanceof Error ? error.message : "Something went wrong",
      });
    }
  }, [instruction, aiState.phase, currentMeals, currentExtras]);

  function handleApply() {
    if (aiState.phase !== "preview") return;
    onApply(aiState.newMeals, aiState.newExtras, aiState.newSupportContent);
    setAiState({ phase: "idle" });
    setInstruction("");
    onClose();
  }

  function handleQuickAction(prompt: string) {
    setInstruction(prompt);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function resetToIdle() {
    setAiState({ phase: "idle" });
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm ai-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel — responsive: full screen on mobile, side drawer on sm+ */}
      <div
        ref={panelRef}
        className="fixed z-50 flex flex-col border-white/[0.08] bg-[#0a0e18]/[0.98] shadow-2xl shadow-black/50 backdrop-blur-2xl ai-drawer-panel inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[480px] sm:max-w-[90vw] sm:border-l sm:rounded-l-2xl"
        style={{ WebkitBackdropFilter: "blur(40px) saturate(180%)", backdropFilter: "blur(40px) saturate(180%)" }}
        role="dialog"
        aria-modal="true"
        aria-label="AI Plan Assistant"
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/25">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              {/* Subtle glow (slower, less intrusive) */}
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500/40 to-purple-600/40 opacity-0 animate-pulse" style={{ animationDuration: "4s" }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">
                AI Plan Editor
              </h2>
              <p className="text-[11px] text-zinc-500">
                Modify your plan with natural language
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
            aria-label="Close AI assistant"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* ── Idle: Quick actions + input ── */}
          {aiState.phase === "idle" && (
            <div className="space-y-6">
              {/* Quick actions */}
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Quick Actions
                </p>
                <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
                  {QUICK_ACTIONS.map((action, idx) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => handleQuickAction(action.prompt)}
                      className="group flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2 py-3 text-center transition-all duration-200 hover:border-blue-500/30 hover:bg-blue-500/[0.08] hover:shadow-lg hover:shadow-blue-500/5 active:scale-[0.96]"
                      style={{ animationDelay: `${idx * 30}ms` }}
                    >
                      <span className="text-zinc-400 transition-colors group-hover:text-blue-400">{action.icon}</span>
                      <span className="text-[10px] font-medium leading-tight text-zinc-400 transition-colors group-hover:text-zinc-200">
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
                  className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                >
                  Instruction
                </label>
                <div className="relative">
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
                    className="block w-full resize-none rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 transition-all focus:border-blue-500/40 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:shadow-[0_0_20px_rgba(59,130,246,0.1)]"
                    style={{ maxHeight: "180px" }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-600">
                  Press Enter to submit · Shift+Enter for new line
                </p>
              </div>
            </div>
          )}

          {/* ── Thinking ── */}
          {aiState.phase === "thinking" && <AiThinkingAnimation />}

          {/* ── Preview ── */}
          {aiState.phase === "preview" && (
            <div className="space-y-5">
              {/* Summary banner */}
              <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-blue-300">
                      {aiState.summary}
                    </p>
                    <p className="mt-0.5 text-[11px] text-blue-400/60">
                      Review the changes below before applying
                    </p>
                  </div>
                </div>
              </div>

              {/* Change list */}
              {aiState.changes.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Changes ({aiState.changes.length})
                  </p>
                  {aiState.changes.map((change, i) => {
                    const style = CHANGE_STYLES[change.type];
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-2.5 rounded-xl border ${style.border} ${style.bg} px-3.5 py-3 transition-colors hover:brightness-110`}
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        <ChangeIcon type={change.type} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-200">
                            {change.label}
                          </p>
                          {change.detail && (
                            <p className="mt-0.5 text-xs text-zinc-500">
                              {change.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-amber-300">
                    No changes detected
                  </p>
                  <p className="mt-0.5 text-xs text-amber-400/60">
                    Try a more specific instruction
                  </p>
                </div>
              )}

              {/* Edit instruction */}
              <div>
                <p className="mb-1.5 text-[11px] text-zinc-500">
                  Not right? Update your instruction:
                </p>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={2}
                  className="block w-full resize-none rounded-xl border border-white/[0.10] bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-200 transition-all focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {aiState.phase === "error" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-red-500/20 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-300">
                      Something went wrong
                    </p>
                    <p className="mt-1 text-xs text-red-400/80">
                      {aiState.message}
                    </p>
                  </div>
                </div>
              </div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                className="block w-full resize-none rounded-xl border border-white/[0.10] bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-200 transition-all focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div className="shrink-0 border-t border-white/[0.08] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {aiState.phase === "idle" && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!instruction.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-30 disabled:shadow-none disabled:hover:brightness-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Apply AI Edit
            </button>
          )}

          {aiState.phase === "thinking" && (
            <button
              type="button"
              onClick={() => setAiState({ phase: "idle" })}
              className="w-full rounded-xl border border-white/[0.10] px-4 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
            >
              Cancel
            </button>
          )}

          {aiState.phase === "preview" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={resetToIdle}
                className="rounded-xl border border-white/[0.10] px-4 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 sm:flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] px-4 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 sm:flex-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                Retry
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={aiState.changes.length === 0}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:shadow-emerald-500/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-30 disabled:shadow-none sm:flex-[2]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Apply Changes
              </button>
            </div>
          )}

          {aiState.phase === "error" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetToIdle}
                className="flex-1 rounded-xl border border-white/[0.10] px-4 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:shadow-blue-500/30 hover:brightness-110 active:scale-[0.98]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
