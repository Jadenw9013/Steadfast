"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ParsedMealPlan } from "@/lib/validations/meal-plan-import";

// ── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value?: number }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color =
    pct >= 80
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : pct >= 50
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-red-500/10 text-red-600 dark:text-red-400";
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>
      {pct}% confident
    </span>
  );
}

// ── Section wrapper with collapse ────────────────────────────────────────────

function ReviewSection({
  title,
  confidence,
  children,
  defaultOpen = true,
  count,
}: {
  title: string;
  confidence?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLowConfidence = confidence != null && confidence < 0.5;

  return (
    <div
      className={`rounded-xl border bg-white dark:bg-zinc-900 ${
        isLowConfidence
          ? "border-amber-300 dark:border-amber-700"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span
          className="text-xs transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        {count != null && (
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">
            {count}
          </span>
        )}
        <ConfidenceBadge value={confidence} />
        {isLowConfidence && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
            Needs review
          </span>
        )}
      </button>
      {open && <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">{children}</div>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function DraftReview({
  uploadId,
  clientId,
  onBack,
}: {
  uploadId: string;
  clientId: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [plan, setPlan] = useState<ParsedMealPlan | null>(null);
  const [showExtracted, setShowExtracted] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/mealplans/draft?uploadId=${uploadId}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load draft");
        }
        const data = await res.json();
        setDraftId(data.draftId);
        setExtractedText(data.extractedText ?? "");
        setPlan(data.parsedJson as ParsedMealPlan);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load draft");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [uploadId]);

  const updateMealName = useCallback((mealIdx: number, name: string) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const meals = [...prev.meals];
      meals[mealIdx] = { ...meals[mealIdx], name };
      return { ...prev, meals };
    });
  }, []);

  const updateItem = useCallback(
    (mealIdx: number, itemIdx: number, field: "food" | "portion" | "notes", value: string) => {
      setPlan((prev) => {
        if (!prev) return prev;
        const meals = [...prev.meals];
        const items = [...meals[mealIdx].items];
        items[itemIdx] = { ...items[itemIdx], [field]: value };
        meals[mealIdx] = { ...meals[mealIdx], items };
        return { ...prev, meals };
      });
    },
    []
  );

  const removeItem = useCallback((mealIdx: number, itemIdx: number) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const meals = [...prev.meals];
      const items = meals[mealIdx].items.filter((_, i) => i !== itemIdx);
      if (items.length === 0) {
        return { ...prev, meals: meals.filter((_, i) => i !== mealIdx) };
      }
      meals[mealIdx] = { ...meals[mealIdx], items };
      return { ...prev, meals };
    });
  }, []);

  const addItem = useCallback((mealIdx: number) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const meals = [...prev.meals];
      meals[mealIdx] = {
        ...meals[mealIdx],
        items: [...meals[mealIdx].items, { food: "", portion: "" }],
      };
      return { ...prev, meals };
    });
  }, []);

  const addMeal = useCallback(() => {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        meals: [
          ...prev.meals,
          { name: `Meal ${prev.meals.length + 1}`, items: [{ food: "", portion: "" }] },
        ],
      };
    });
  }, []);

  const removeMeal = useCallback((mealIdx: number) => {
    setPlan((prev) => {
      if (!prev) return prev;
      return { ...prev, meals: prev.meals.filter((_, i) => i !== mealIdx) };
    });
  }, []);

  // ── Extended section editors ──────────────────────────────────────────────

  const removeSupplement = useCallback((idx: number) => {
    setPlan((prev) => {
      if (!prev?.supplements) return prev;
      return { ...prev, supplements: prev.supplements.filter((_, i) => i !== idx) };
    });
  }, []);

  const removeRule = useCallback((idx: number) => {
    setPlan((prev) => {
      if (!prev?.rules) return prev;
      return { ...prev, rules: prev.rules.filter((_, i) => i !== idx) };
    });
  }, []);

  const removeAllowance = useCallback((idx: number) => {
    setPlan((prev) => {
      if (!prev?.allowances) return prev;
      return { ...prev, allowances: prev.allowances.filter((_, i) => i !== idx) };
    });
  }, []);

  const removeOverride = useCallback((idx: number) => {
    setPlan((prev) => {
      if (!prev?.dayOverrides) return prev;
      return { ...prev, dayOverrides: prev.dayOverrides.filter((_, i) => i !== idx) };
    });
  }, []);

  async function handleImport() {
    if (!draftId || !plan) return;

    for (const meal of plan.meals) {
      for (const item of meal.items) {
        if (!item.food.trim()) {
          setError("All items must have a food name.");
          return;
        }
      }
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/mealplans/import-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, parsedJson: plan }),
      });

      if (!res.ok) {
        const text = await res.text();
        let message = `Import failed (${res.status})`;
        try {
          const data = JSON.parse(text);
          if (data.error) message = data.error;
        } catch {
          if (res.status === 404) message = "Import endpoint not found (404). Try redeploying.";
        }
        throw new Error(message);
      }

      const data = await res.json();
      router.push(
        `/coach/clients/${clientId}/review/${data.weekStartDate}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        <span className="text-sm text-zinc-500">Loading draft...</span>
      </div>
    );
  }

  if (!plan || !draftId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{error || "Draft not found."}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Back
        </button>
      </div>
    );
  }

  const hasExtras =
    plan.metadata || plan.dayOverrides?.length || plan.supplements?.length ||
    plan.allowances?.length || plan.rules?.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold tracking-tight">Review Extracted Meal Plan</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Edit meals and items below, then import into the meal plan system.
        </p>
      </div>

      {/* Extracted text toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowExtracted(!showExtracted)}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:text-zinc-300"
          aria-expanded={showExtracted}
        >
          <span className="inline-block transition-transform" style={{ transform: showExtracted ? "rotate(90deg)" : "rotate(0deg)" }}>
            &#9654;
          </span>
          {showExtracted ? "Hide" : "Show"} extracted text
        </button>
        {showExtracted && (
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {extractedText || "No extracted text"}
          </pre>
        )}
      </div>

      {/* Plan title */}
      <div>
        <label htmlFor="plan-title" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Plan Title
        </label>
        <input
          id="plan-title"
          type="text"
          value={plan.title}
          onChange={(e) => setPlan({ ...plan, title: e.target.value })}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {/* ── Metadata ── */}
      {plan.metadata && (
        <ReviewSection title="Plan Metadata">
          <div className="grid gap-3 sm:grid-cols-2">
            {plan.metadata.phase && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Phase</span>
                <input
                  type="text"
                  value={plan.metadata.phase}
                  onChange={(e) => setPlan({ ...plan, metadata: { ...plan.metadata, phase: e.target.value } })}
                  className="mt-0.5 w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
            )}
            {plan.metadata.bodyweight && (
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Weight</span>
                <input
                  type="text"
                  value={plan.metadata.bodyweight}
                  onChange={(e) => setPlan({ ...plan, metadata: { ...plan.metadata, bodyweight: e.target.value } })}
                  className="mt-0.5 w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
            )}
            {plan.metadata.coachNotes && (
              <div className="sm:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Coach Notes</span>
                <textarea
                  value={plan.metadata.coachNotes}
                  onChange={(e) => setPlan({ ...plan, metadata: { ...plan.metadata, coachNotes: e.target.value } })}
                  rows={2}
                  className="mt-0.5 w-full rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
            )}
            {plan.metadata.highlightedChanges && (
              <div className="sm:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Highlighted Changes</span>
                <p className="mt-0.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  {plan.metadata.highlightedChanges}
                </p>
              </div>
            )}
          </div>
        </ReviewSection>
      )}

      {/* ── Meals ── */}
      <ReviewSection
        title="Meals"
        confidence={plan.confidence?.meals}
        count={plan.meals.length}
      >
        <div className="space-y-3">
          {plan.meals.map((meal, mealIdx) => (
            <div
              key={mealIdx}
              className="rounded-lg border border-zinc-100 dark:border-zinc-800"
            >
              <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <input
                  type="text"
                  value={meal.name}
                  onChange={(e) => updateMealName(mealIdx, e.target.value)}
                  className="flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  aria-label={`Meal name for meal ${mealIdx + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeMeal(mealIdx)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  aria-label={`Remove ${meal.name}`}
                >
                  &times;
                </button>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {meal.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="flex items-start gap-2 px-3 py-2">
                    <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:gap-2">
                      <input
                        type="text"
                        value={item.food}
                        onChange={(e) => updateItem(mealIdx, itemIdx, "food", e.target.value)}
                        placeholder="Food name"
                        className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                        aria-label={`Food name, meal ${mealIdx + 1}, item ${itemIdx + 1}`}
                      />
                      <input
                        type="text"
                        value={item.portion}
                        onChange={(e) => updateItem(mealIdx, itemIdx, "portion", e.target.value)}
                        placeholder="Portion not detected"
                        className={`w-full rounded-lg border px-2.5 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 sm:w-40 ${
                          !item.portion.trim()
                            ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30"
                            : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800"
                        }`}
                        aria-label={`Portion, meal ${mealIdx + 1}, item ${itemIdx + 1}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(mealIdx, itemIdx)}
                      className="mt-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                      aria-label={`Remove ${item.food || "item"}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => addItem(mealIdx)}
                  className="w-full rounded-lg py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                >
                  + Add Item
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addMeal}
          className="mt-3 w-full rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
        >
          + Add Meal
        </button>
      </ReviewSection>

      {/* ── Day Overrides ── */}
      {plan.dayOverrides && plan.dayOverrides.length > 0 && (
        <ReviewSection
          title="Day Overrides"
          confidence={plan.confidence?.overrides}
          count={plan.dayOverrides.length}
        >
          <div className="space-y-2">
            {plan.dayOverrides.map((override, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800/50">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{override.label}</span>
                    {override.weekdays?.map((day) => (
                      <span key={day} className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                        {day}
                      </span>
                    ))}
                  </div>
                  {override.notes && <p className="mt-1 text-xs text-zinc-500">{override.notes}</p>}
                  {override.items?.map((item, i) => (
                    <div key={i} className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {item.food} {item.portion && `— ${item.portion}`}
                      {item.replaces && <span className="text-zinc-400"> (replaces {item.replaces})</span>}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => removeOverride(idx)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  aria-label="Remove override"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </ReviewSection>
      )}

      {/* ── Supplements ── */}
      {plan.supplements && plan.supplements.length > 0 && (
        <ReviewSection
          title="Supplements"
          confidence={plan.confidence?.supplements}
          count={plan.supplements.length}
        >
          <div className="space-y-1.5">
            {plan.supplements.map((supp, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/50">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{supp.name}</span>
                  {supp.dosage && <span className="ml-1 text-xs text-zinc-500">({supp.dosage})</span>}
                  <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {supp.timing}
                  </span>
                  {supp.notes && <span className="ml-1 text-xs text-zinc-400">— {supp.notes}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => removeSupplement(idx)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  aria-label={`Remove ${supp.name}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </ReviewSection>
      )}

      {/* ── Allowances ── */}
      {plan.allowances && plan.allowances.length > 0 && (
        <ReviewSection
          title="Allowances"
          confidence={plan.confidence?.allowances}
          count={plan.allowances.length}
        >
          <div className="space-y-2">
            {plan.allowances.map((allow, idx) => (
              <div key={idx} className="rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{allow.category}</span>
                  <button
                    type="button"
                    onClick={() => removeAllowance(idx)}
                    className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                    aria-label={`Remove ${allow.category}`}
                  >
                    &times;
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {allow.items.map((item, i) => (
                    <span key={i} className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-700">
                      {item}
                    </span>
                  ))}
                </div>
                {allow.restriction && (
                  <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">{allow.restriction}</p>
                )}
              </div>
            ))}
          </div>
        </ReviewSection>
      )}

      {/* ── Rules ── */}
      {plan.rules && plan.rules.length > 0 && (
        <ReviewSection
          title="Rules"
          confidence={plan.confidence?.rules}
          count={plan.rules.length}
        >
          <div className="space-y-1.5">
            {plan.rules.map((rule, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/50">
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                  {rule.category}
                </span>
                <span className="flex-1 text-sm">{rule.text}</span>
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  aria-label="Remove rule"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </ReviewSection>
      )}

      {/* Notes */}
      {plan.notes && (
        <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/50">
          <span className="font-medium">Notes:</span> {plan.notes}
        </div>
      )}

      {/* Extended sections summary */}
      {hasExtras && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-400">
          Extended sections detected (overrides, supplements, allowances, rules). These will be preserved when imported.
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          disabled={importing}
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || plan.meals.length === 0}
          className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          {importing ? "Importing..." : "Import Meal Plan"}
        </button>
      </div>
    </div>
  );
}
