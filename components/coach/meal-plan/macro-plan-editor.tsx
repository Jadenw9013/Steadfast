"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createDraftMealPlan, saveDraftMealPlan, publishMealPlan } from "@/app/actions/meal-plans";
import {
  applyMacroEstimates,
  buildAutofillRequest,
  buildMacroDraftInput,
  findMealNameProblem,
  macroCalorieMismatch,
  macroEditorSignature,
  mealNameProblemMessage,
  AUTOFILL_MISALIGNED_MESSAGE,
  AUTOFILL_NO_SOURCE_MESSAGE,
} from "@/lib/meal-plans/editor-state";
import { MealPlanActions } from "./meal-plan-actions";
import {
  macroTargetsToEditable,
  flattenMacroMeals,
  type EditableMacroMeal,
} from "@/types/meal-plan";
import type { EffectiveMealPlan } from "@/lib/queries/meal-plans";

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
  noFoodsForAutofill,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  meal: EditableMacroMeal;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  /** This row has no foods under its name, so autofill will leave it alone. */
  noFoodsForAutofill?: boolean;
  onUpdate: (patch: Partial<EditableMacroMeal>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(meal.mealName);
  const formattedIndex = String(index + 1).padStart(2, "0");
  // Advisory only — never blocks Publish, and stays silent on a calories-only
  // row (T-103).
  const mismatch = macroCalorieMismatch(meal);

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

      {noFoodsForAutofill && (
        <p className="px-4 pb-3 text-[11px] text-zinc-500">
          No foods in this meal — autofill will skip it.
        </p>
      )}

      {mismatch && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-2.5">
          <p className="min-w-0 text-[11px] text-amber-400">
            Calories don&rsquo;t match these macros (4×P + 4×C + 9×F = {mismatch.derived}).
          </p>
          <button
            type="button"
            onClick={() => onUpdate({ calories: mismatch.derived })}
            aria-label={`Set ${meal.mealName} calories to ${mismatch.derived}`}
            className="flex min-h-[48px] shrink-0 items-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-all hover:border-amber-500/40 hover:bg-amber-500/20 active:scale-[0.97]"
          >
            Use {mismatch.derived}
          </button>
        </div>
      )}
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
  // T-103 — `MealPlan.supportContent`, the same column and the same field the
  // foods editor authors. A macro week routinely inherits notes written in
  // foods mode (T-101 carry-forward) and the client's MacroPlanView renders
  // them, so the coach needs to be able to see and edit them here too.
  const [supportContent, setSupportContent] = useState<string>(effectivePlan.supportContent || "");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // T-102b — publishMealPlan throws on rejection (e.g. the server-side
  // empty-plan guard); without this the rejection was silent and the button
  // just reverted to "Publish". Mirrors the autofillError state below.
  // Holds a fixed sentence, never the thrown message — see handlePublish.
  // T-103 — it now also carries a locally-computed meal-name validation
  // sentence (`mealNameProblemMessage`), produced before any server call. The
  // *thrown* message is still never used.
  const [publishError, setPublishError] = useState<string | null>(null);
  const [notifyClient, setNotifyClient] = useState(coachDefaultNotify ?? true);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [privacyConsent, setPrivacyConsent] = useState(false);

  const isUnsaved = draftId === null;
  // Foods from a prior MEAL_PLAN-mode edit of this same plan (if any) — the source autofill estimates from.
  const hasExistingItems = effectivePlan.items.length > 0;

  // Which rows autofill can actually estimate, and which it must leave alone.
  // Rows with no foods under their name are excluded from the request entirely:
  // the model is instructed to return zeros for a foodless meal, so sending them
  // would wipe hand-typed targets (T-103).
  const autofill = useMemo(
    () => buildAutofillRequest(meals, effectivePlan.items),
    [meals, effectivePlan.items]
  );

  // Mirror of the foods editor: the plan-mode toggle above unmounts this editor
  // and everything typed into it, so report whether the current targets differ
  // from the ones this editor was seeded with (T-102a review, finding 1).
  const baselineSignature = useMemo(
    () => macroEditorSignature(effectivePlan.macroTargets, effectivePlan.supportContent || ""),
    [effectivePlan]
  );
  const hasUnsavedChanges =
    macroEditorSignature(meals, supportContent) !== baselineSignature;

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedChanges);
    return () => onUnsavedChange?.(false);
  }, [hasUnsavedChanges, onUnsavedChange]);

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
    // Payload shape (including the explicit `planMode: "MACROS"`) lives in
    // lib/meal-plans/editor-state.ts, under unit test — T-102a review, finding 2.
    const result = await createDraftMealPlan(
      buildMacroDraftInput({ clientId, weekStartDate, meals, supportContent })
    );
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
        // `|| undefined`, not `?? undefined`: an emptied box must not clear the
        // saved notes (that is T-732, and `supportContentInputSchema`
        // normalizes "" to undefined server-side anyway). The create path in
        // `buildMacroDraftInput` deliberately sends an explicit `null` instead
        // — on create, `undefined` means "carry the previous plan's notes
        // forward" (T-101). The asymmetry is intentional.
        const result = await saveDraftMealPlan({
          mealPlanId: draftId,
          macroTargets: flattenMacroMeals(meals),
          supportContent: supportContent || undefined,
        });
        // Someone else published/superseded this draft in the meantime —
        // the server forked a fresh one rather than corrupting the live
        // plan. Adopt its id.
        if ("forkedNewDraftId" in result && result.forkedNewDraftId) {
          setDraftId(result.forkedNewDraftId);
        }
      } else {
        await ensureDraft();
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    // Before `setPublishing(true)` and before any server call — including
    // `ensureDraft()` — so a rejected publish never creates a draft row (T-103).
    const problem = findMealNameProblem(meals.map((m) => m.mealName));
    if (problem) {
      setPublishError(mealNameProblemMessage(problem));
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      let id = draftId ?? (await ensureDraft());
      if (!id) {
        setPublishError("Publish failed. Please try again.");
        return;
      }
      // `supportContent: supportContent || undefined` — same T-732 semantics as
      // handleSave above.
      const saveResult = await saveDraftMealPlan({
        mealPlanId: id,
        macroTargets: flattenMacroMeals(meals),
        supportContent: supportContent || undefined,
      });
      if ("forkedNewDraftId" in saveResult && saveResult.forkedNewDraftId) {
        id = saveResult.forkedNewDraftId;
      }
      await publishMealPlan({ mealPlanId: id, notifyClient });
      setDraftId(null);
      router.refresh();
    } catch {
      // Deliberately ignores the thrown error's message. In a production build
      // Next.js redacts Server Action error messages, and React's flight client
      // replaces them with a real Error whose message is
      // "Minified React error #441; visit https://react.dev/errors/441 ..." —
      // so `err.message` would render minified React text and a react.dev URL
      // to the coach. Fixed sentence, mirroring
      // components/coach/training/training-program-editor.tsx's publish catch.
      // T-742 restores the mode-specific server wording by making
      // publishMealPlan return a result instead of throwing.
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
    if (autofill.sourceMeals.length === 0) {
      setAutofillError(AUTOFILL_NO_SOURCE_MESSAGE);
      return;
    }
    setAutofilling(true);
    setAutofillError(null);
    try {
      const response = await fetch("/api/mealplans/estimate-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacyConsent: true, meals: autofill.sourceMeals }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to estimate macros");

      const estimates: { name: string; calories: number; protein: number; carbs: number; fats: number }[] = body.meals;
      if (autofill.seeding) {
        setMeals(estimates.map((e) => ({ id: crypto.randomUUID(), mealName: e.name, calories: e.calories, protein: e.protein, carbs: e.carbs, fats: e.fats })));
      } else {
        // Applied to the `meals` render snapshot, deliberately NOT through a
        // `setMeals(prev => …)` updater: the index mapping is only valid against
        // the array the request was built from, and this matches how
        // handleSave/handlePublish already flatten the snapshot. A row added
        // during the round-trip is therefore discarded — the window is one
        // OpenAI call, during which the button reads "Estimating…".
        const next = applyMacroEstimates(meals, autofill.targetIndices, estimates);
        if (!next) {
          setAutofillError(AUTOFILL_MISALIGNED_MESSAGE);
          return;
        }
        setMeals(next);
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
              disabled={autofilling || !privacyConsent || autofill.sourceMeals.length === 0}
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
          {/* A precondition, not a failure — same muted treatment as the
              description above, not the red error styling below. */}
          {autofill.sourceMeals.length === 0 && (
            <p className="text-xs text-zinc-500">{AUTOFILL_NO_SOURCE_MESSAGE}</p>
          )}
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
            noFoodsForAutofill={hasExistingItems && autofill.skippedIndices.includes(i)}
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

      {/* Support Content (Guidelines, Extras, etc) — same field and markup as
          the foods editor (meal-plan-editor-v2.tsx). Distinct id so the two can
          never collide. No undo wiring: this editor has no undo stack. The
          inline `font-size` is defensive redundancy, not a specificity
          override — globals.css's unlayered `input, select, textarea {
          font-size: max(1rem, 16px) }` already beats `text-sm` regardless of
          specificity (Tailwind's utilities live in `@layer utilities`, and an
          unlayered rule always wins over a layered one). It's the same inline
          style the macro number inputs above already carry, kept for the same
          belt-and-braces reason: the design system requires 16px on every
          input and this makes that explicit at the call site. */}
      <div className="sf-glass-card p-6 shadow-xl shadow-black/40">
        <label htmlFor="macroSupportContent" className="mb-3 block text-xs font-bold uppercase tracking-wider text-zinc-500">
          Support Content & Guidelines
        </label>
        <textarea
          id="macroSupportContent"
          value={supportContent}
          onChange={(e) => setSupportContent(e.target.value)}
          className="w-full min-h-[160px] resize-y rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-blue-500/50 focus:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          style={{ fontSize: "max(1rem, 16px)" }}
          placeholder="Add unconstrained text here for supplements, allowances, rules, substitutions, coach notes, or whatever else formatting you need."
        />
      </div>

      {/* T-102b — publish rejection feedback, rendered next to the button that caused it. */}
      {publishError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-sm text-red-400"
        >
          <span className="min-w-0 py-2.5">{publishError}</span>
          <button
            type="button"
            onClick={() => setPublishError(null)}
            aria-label="Dismiss"
            className="-mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-red-400/70 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
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
