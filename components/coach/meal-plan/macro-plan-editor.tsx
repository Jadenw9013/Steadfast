"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createDraftMealPlan, saveDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import { MealPlanActions } from "./meal-plan-actions";
import {
  macroTargetsToEditable,
  flattenMacroMeals,
  type EditableMacroMeal,
} from "@/types/meal-plan";
import type { EffectiveMealPlan } from "@/lib/queries/meal-plans";
import { emptyPlanMessage } from "@/lib/meal-plans/publish-messages";
import { macroEditorSignature } from "@/lib/meal-plans/editor-state";

const MACRO_FIELDS = [
  { key: "calories" as const, label: "Calories", short: "Cal", accent: "text-blue-300", ring: "focus:border-blue-400/60 focus:ring-blue-400/20" },
  { key: "protein" as const, label: "Protein", short: "P", accent: "text-emerald-300", ring: "focus:border-emerald-400/60 focus:ring-emerald-400/20" },
  { key: "carbs" as const, label: "Carbs", short: "C", accent: "text-amber-300", ring: "focus:border-amber-400/60 focus:ring-amber-400/20" },
  { key: "fats" as const, label: "Fats", short: "F", accent: "text-rose-300", ring: "focus:border-rose-400/60 focus:ring-rose-400/20" },
];

function MacroMealRow({
  meal,
  index,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  meal: EditableMacroMeal;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<EditableMacroMeal>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(meal.mealName);
  const formattedIndex = String(index + 1).padStart(2, "0");

  return (
    <div className="group/card overflow-hidden sf-glass-card">
      {/* Header — mirrors MealCard's header for visual consistency between modes */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 border-b border-white/[0.08] px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-[10px] font-bold tabular-nums text-blue-300">
            {formattedIndex}
          </span>
          {editingName ? (
            <input
              autoFocus
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={() => {
                onUpdate({ mealName: tempName || "Untitled Meal" });
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onUpdate({ mealName: tempName || "Untitled Meal" });
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
              className="flex items-center gap-2 whitespace-nowrap text-sm font-bold uppercase tracking-wider text-white transition-colors hover:text-blue-100"
            >
              {meal.mealName}
              <svg className="h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover/card:opacity-100" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button type="button" onClick={onMoveUp} disabled={isFirst} className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-20 disabled:cursor-not-allowed" aria-label={`Move ${meal.mealName} up`} title="Move up">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
          </button>
          <button type="button" onClick={onMoveDown} disabled={isLast} className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-20 disabled:cursor-not-allowed" aria-label={`Move ${meal.mealName} down`} title="Move down">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <span className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.06]" aria-hidden />
          <button type="button" onClick={onRemove} className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400" aria-label={`Remove ${meal.mealName}`} title="Remove meal">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      {/* Macro targets — 2x2 on phones (roomy tap targets), 4-across from sm up */}
      <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 sm:gap-3">
        {MACRO_FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className={`mb-1.5 block text-[10px] font-bold uppercase tracking-wider ${field.accent}`}>
              {field.label}
            </span>
            <div className="relative">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={meal[field.key] === 0 ? "" : meal[field.key]}
                placeholder="0"
                onChange={(e) => {
                  const n = e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value)));
                  onUpdate({ [field.key]: Number.isFinite(n) ? n : 0 });
                }}
                className={`w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-lg font-bold tabular-nums text-white placeholder:text-zinc-600 focus:bg-white/[0.05] focus:outline-none focus:ring-2 ${field.ring}`}
                style={{ fontSize: "max(1rem, 16px)" }}
                aria-label={`${meal.mealName} ${field.label}`}
              />
              {field.key !== "calories" && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-500">g</span>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

export function MacroPlanEditor({
  clientId,
  weekStartDate,
  effectivePlan,
  coachDefaultNotify,
  onUnsavedChange,
}: {
  clientId: string;
  weekStartDate: string;
  effectivePlan: EffectiveMealPlan;
  coachDefaultNotify?: boolean;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
}) {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string | null>(effectivePlan.draftId);
  const [meals, setMeals] = useState<EditableMacroMeal[]>(() => macroTargetsToEditable(effectivePlan.macroTargets));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notifyClient, setNotifyClient] = useState(coachDefaultNotify ?? true);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const isUnsaved = draftId === null;
  // Foods from a prior MEAL_PLAN-mode edit of this same plan (if any) — the source autofill estimates from.
  const hasExistingItems = effectivePlan.items.length > 0;

  // Mirror of the foods editor: the plan-mode toggle unmounts this editor and
  // everything typed into it, so report whether the current targets differ
  // from the ones this editor was seeded with (T-800 code-review r1, MAJOR-3).
  const baselineSignature = useMemo(
    () => macroEditorSignature(effectivePlan.macroTargets),
    [effectivePlan]
  );
  const hasUnsavedChanges = macroEditorSignature(meals) !== baselineSignature;

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedChanges);
    return () => onUnsavedChange?.(false);
  }, [hasUnsavedChanges, onUnsavedChange]);

  // NIT: clear the stale publish-refusal sentence as soon as the coach adds a
  // meal row, rather than leaving it on screen until the next publish attempt
  // (T-800 code-review r1, NIT-1). Adjusted during render, not in an effect —
  // same pattern as plan-mode-toggle.tsx's seeded-mode reset — so this can't
  // cascade an extra render.
  const [lastMealCountForError, setLastMealCountForError] = useState(meals.length);
  if (meals.length !== lastMealCountForError) {
    setLastMealCountForError(meals.length);
    if (meals.length > 0 && publishError) setPublishError(null);
  }

  const dailyTotals = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fats: acc.fats + m.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId;
    const result = await createDraftMealPlan({
      clientId,
      weekStartDate,
      // Must stay explicit — this is the one editor where the coach
      // deliberately chose MACROS. Omitting it (T-800) would let a new
      // version fall through to a stale default instead.
      planMode: "MACROS",
      macroTargets: flattenMacroMeals(meals),
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
        await saveDraftMealPlan({ mealPlanId: draftId, macroTargets: flattenMacroMeals(meals) });
      } else {
        await ensureDraft();
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    // Local pre-check with the exact sentence: production Next redacts
    // Server Action error messages into a minified React error, so the
    // server-side publish guard alone would turn "plan vanishes" into
    // "Publish button does nothing" (T-800).
    if (meals.length === 0) {
      setPublishError(emptyPlanMessage("MACROS"));
      return;
    }
    setPublishError(null);
    setPublishing(true);
    try {
      const id = draftId ?? (await ensureDraft());
      if (!id) return;
      await saveDraftMealPlan({ mealPlanId: id, macroTargets: flattenMacroMeals(meals) });
      const result = await publishMealPlan({ mealPlanId: id, notifyClient });
      if (!result.success) {
        setPublishError(result.message);
        return;
      }
      setDraftId(null);
      router.refresh();
    } catch {
      // Never render the thrown message — production Next redacts Server
      // Action errors into a minified React error string.
      setPublishError("Publish failed. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  const updateMeal = useCallback((index: number, patch: Partial<EditableMacroMeal>) => {
    setMeals((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }, []);

  function removeMeal(index: number) {
    setMeals((prev) => prev.filter((_, i) => i !== index));
  }

  function addMeal() {
    setMeals((prev) => [
      ...prev,
      { id: crypto.randomUUID(), mealName: `Meal ${prev.length + 1}`, calories: 0, protein: 0, carbs: 0, fats: 0 },
    ]);
  }

  function moveMeal(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= meals.length) return;
    setMeals((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleAutofill() {
    if (!privacyConsent) {
      setAutofillError("Check the box above to confirm before using AI.");
      return;
    }
    setAutofilling(true);
    setAutofillError(null);
    try {
      // Group existing food items (from a prior MEAL_PLAN-mode edit of this plan) by meal name.
      const grouped = new Map<string, { food: string; portion: string }[]>();
      for (const item of effectivePlan.items) {
        const list = grouped.get(item.mealName) ?? [];
        list.push({ food: item.foodName, portion: item.servingDescription || `${item.quantity} ${item.unit}`.trim() });
        grouped.set(item.mealName, list);
      }
      const sourceMeals = meals.length > 0
        ? meals.map((m) => ({ name: m.mealName, items: grouped.get(m.mealName) ?? [] }))
        : Array.from(grouped, ([name, items]) => ({ name, items }));

      const response = await fetch("/api/mealplans/estimate-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacyConsent: true, meals: sourceMeals }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to estimate macros");

      const estimates: { name: string; calories: number; protein: number; carbs: number; fats: number }[] = body.meals;
      if (meals.length > 0) {
        setMeals((prev) =>
          prev.map((m) => {
            const est = estimates.find((e) => e.name === m.mealName);
            return est ? { ...m, calories: est.calories, protein: est.protein, carbs: est.carbs, fats: est.fats } : m;
          })
        );
      } else {
        setMeals(estimates.map((e) => ({ id: crypto.randomUUID(), mealName: e.name, calories: e.calories, protein: e.protein, carbs: e.carbs, fats: e.fats })));
      }
    } catch (err) {
      setAutofillError(err instanceof Error ? err.message : "Failed to estimate macros");
    } finally {
      setAutofilling(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {isUnsaved ? "Unsaved Macro Plan" : "Macro Plan Draft"}
          </h3>
          <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-300">
            Macros only
          </span>
        </div>
        {/* Daily total pill */}
        {meals.length > 0 && (
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3.5 py-2 text-xs">
            <span className="font-bold tabular-nums text-white">{dailyTotals.calories}</span>
            <span className="text-zinc-500">cal/day</span>
            <span className="h-3 w-px bg-white/[0.08]" aria-hidden />
            <span className="tabular-nums text-emerald-400">{dailyTotals.protein}p</span>
            <span className="tabular-nums text-amber-400">{dailyTotals.carbs}c</span>
            <span className="tabular-nums text-rose-400">{dailyTotals.fats}f</span>
          </div>
        )}
      </div>

      {/* Autofill with AI */}
      {hasExistingItems && (
        <div className="sf-glass-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Autofill from this plan&rsquo;s foods</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Estimates macros per meal from the foods already entered for this client, so you don&rsquo;t have to guess.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAutofill}
              disabled={autofilling || !privacyConsent}
              className="group flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-400 transition-all hover:bg-blue-500/20 hover:border-blue-500/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z" fill="currentColor" />
              </svg>
              {autofilling ? "Estimating…" : "Autofill with AI"}
            </button>
          </div>
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
            <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/50" />
            <span>I agree to send this plan&rsquo;s foods to OpenAI to estimate macros. I have removed personal client information, or obtained the client&rsquo;s permission to share it. Review estimates before saving.</span>
          </label>
          {autofillError && <p className="text-xs text-red-400">{autofillError}</p>}
        </div>
      )}

      {/* Meal rows */}
      <div className="space-y-3">
        {meals.map((meal, i) => (
          <MacroMealRow
            key={meal.id}
            meal={meal}
            index={i}
            isFirst={i === 0}
            isLast={i === meals.length - 1}
            onUpdate={(patch) => updateMeal(i, patch)}
            onRemove={() => removeMeal(i)}
            onMoveUp={() => moveMeal(i, "up")}
            onMoveDown={() => moveMeal(i, "down")}
          />
        ))}
      </div>

      {meals.length === 0 && (
        <div className="sf-glass-card flex flex-col items-center gap-2 px-6 py-10 text-center">
          <p className="text-sm font-bold text-white">No meals yet</p>
          <p className="max-w-xs text-xs text-zinc-500">
            Add a meal and set the calorie/protein/carb/fat targets your client should hit — no foods required.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={addMeal}
        className="w-full mt-1 rounded-xl border border-dashed border-white/[0.1] bg-white/[0.01] py-3.5 text-xs font-bold uppercase tracking-wider text-zinc-400 transition-all hover:bg-white/[0.03] hover:text-white"
      >
        + Add New Meal
      </button>

      <p className="text-center text-[11px] text-zinc-600">
        Day overrides aren&rsquo;t supported in macro mode yet.
      </p>

      {publishError && (
        <p className="text-sm font-medium text-red-400" role="alert">
          {publishError}
        </p>
      )}
      <MealPlanActions
        saving={saving}
        publishing={publishing}
        itemCount={meals.length}
        isUnsaved={isUnsaved}
        notifyClient={notifyClient}
        onNotifyChange={setNotifyClient}
        onSave={handleSave}
        onPublish={handlePublish}
      />
    </div>
  );
}
