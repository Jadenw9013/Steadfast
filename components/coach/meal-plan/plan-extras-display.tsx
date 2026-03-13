"use client";

import { useCallback, useState, useEffect } from "react";
import type { PlanExtras, Supplement, Rule, DayOverride, MealAdjustment, MealChange, Allowance } from "@/types/meal-plan-extras";
import { SUPPLEMENT_TIMING_ORDER, OVERRIDE_COLORS, getOverrideColor } from "@/types/meal-plan-extras";
import { copySection, pasteSection } from "@/lib/plan-clipboard";
import { savePlanSnippet, listPlanSnippets, getPlanSnippet, deletePlanSnippet, type SnippetType } from "@/app/actions/plan-snippets";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CHANGE_TYPES: { id: MealChange["type"]; label: string }[] = [
  { id: "update", label: "Update Amount" },
  { id: "add", label: "Add Item" },
  { id: "remove", label: "Remove Item" },
  { id: "replace", label: "Replace Item" },
];

/**
 * Editable plan extras panel for the coach editor.
 * Overrides are fully generic with meal-level granularity.
 * All sections support copy/paste and save/apply templates.
 */
export function PlanExtrasEditor({
  extras,
  onChange,
  mealNames,
}: {
  extras: PlanExtras;
  onChange: (updated: PlanExtras) => void;
  mealNames?: string[];
}) {
  // ── Toast state ───────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  // ── Metadata helpers ──────────────────────────────────────────────────────

  const updateMetadata = useCallback(
    (field: string, value: string) => {
      onChange({ ...extras, metadata: { ...extras.metadata, [field]: value } });
    },
    [extras, onChange]
  );

  // ── Override helpers ──────────────────────────────────────────────────────

  const updateOverride = useCallback(
    (idx: number, patch: Partial<DayOverride>) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      overrides[idx] = { ...overrides[idx], ...patch };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  const removeOverride = useCallback(
    (idx: number) => {
      onChange({ ...extras, dayOverrides: extras.dayOverrides?.filter((_, i) => i !== idx) });
    },
    [extras, onChange]
  );

  const addOverride = useCallback(() => {
    onChange({
      ...extras,
      dayOverrides: [
        ...(extras.dayOverrides ?? []),
        { label: "New Override", color: "blue", weekdays: [], mealAdjustments: [], notes: "" },
      ],
    });
  }, [extras, onChange]);

  const duplicateOverride = useCallback(
    (idx: number) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const copy = JSON.parse(JSON.stringify(overrides[idx])) as DayOverride;
      copy.label = `${copy.label} (Copy)`;
      overrides.splice(idx + 1, 0, copy);
      onChange({ ...extras, dayOverrides: overrides });
      showToast("Override duplicated");
    },
    [extras, onChange, showToast]
  );

  const toggleOverrideDay = useCallback(
    (idx: number, day: string) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const current = overrides[idx].weekdays ?? [];
      const has = current.includes(day);
      overrides[idx] = {
        ...overrides[idx],
        weekdays: has ? current.filter((d) => d !== day) : [...current, day],
      };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  // ── Meal Adjustment helpers ───────────────────────────────────────────────

  const addMealAdjustment = useCallback(
    (overrideIdx: number) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const adj: MealAdjustment = {
        mealName: mealNames?.[0] ?? "Meal 1",
        changes: [{ type: "update", food: "", newPortion: "" }],
      };
      overrides[overrideIdx] = {
        ...overrides[overrideIdx],
        mealAdjustments: [...(overrides[overrideIdx].mealAdjustments ?? []), adj],
      };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange, mealNames]
  );

  const removeMealAdjustment = useCallback(
    (overrideIdx: number, adjIdx: number) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      overrides[overrideIdx] = {
        ...overrides[overrideIdx],
        mealAdjustments: overrides[overrideIdx].mealAdjustments?.filter((_, i) => i !== adjIdx),
      };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  const updateMealAdjustment = useCallback(
    (overrideIdx: number, adjIdx: number, patch: Partial<MealAdjustment>) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const adjs = [...(overrides[overrideIdx].mealAdjustments ?? [])];
      adjs[adjIdx] = { ...adjs[adjIdx], ...patch };
      overrides[overrideIdx] = { ...overrides[overrideIdx], mealAdjustments: adjs };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  const addChange = useCallback(
    (overrideIdx: number, adjIdx: number) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const adjs = [...(overrides[overrideIdx].mealAdjustments ?? [])];
      adjs[adjIdx] = {
        ...adjs[adjIdx],
        changes: [...adjs[adjIdx].changes, { type: "update", food: "", newPortion: "" }],
      };
      overrides[overrideIdx] = { ...overrides[overrideIdx], mealAdjustments: adjs };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  const removeChange = useCallback(
    (overrideIdx: number, adjIdx: number, changeIdx: number) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const adjs = [...(overrides[overrideIdx].mealAdjustments ?? [])];
      adjs[adjIdx] = {
        ...adjs[adjIdx],
        changes: adjs[adjIdx].changes.filter((_, i) => i !== changeIdx),
      };
      overrides[overrideIdx] = { ...overrides[overrideIdx], mealAdjustments: adjs };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  const updateChange = useCallback(
    (overrideIdx: number, adjIdx: number, changeIdx: number, patch: Partial<MealChange>) => {
      const overrides = [...(extras.dayOverrides ?? [])];
      const adjs = [...(overrides[overrideIdx].mealAdjustments ?? [])];
      const changes = [...adjs[adjIdx].changes];
      changes[changeIdx] = { ...changes[changeIdx], ...patch };
      adjs[adjIdx] = { ...adjs[adjIdx], changes };
      overrides[overrideIdx] = { ...overrides[overrideIdx], mealAdjustments: adjs };
      onChange({ ...extras, dayOverrides: overrides });
    },
    [extras, onChange]
  );

  // ── Supplement helpers ────────────────────────────────────────────────────

  const updateSupplement = useCallback(
    (idx: number, field: keyof Supplement, value: string | boolean) => {
      const supps = [...(extras.supplements ?? [])];
      supps[idx] = { ...supps[idx], [field]: value };
      onChange({ ...extras, supplements: supps });
    },
    [extras, onChange]
  );

  const removeSupplement = useCallback(
    (idx: number) => {
      onChange({ ...extras, supplements: extras.supplements?.filter((_, i) => i !== idx) });
    },
    [extras, onChange]
  );

  const addSupplement = useCallback(() => {
    onChange({
      ...extras,
      supplements: [...(extras.supplements ?? []), { name: "", timing: "AM" }],
    });
  }, [extras, onChange]);

  // ── Rule helpers ──────────────────────────────────────────────────────────

  const updateRule = useCallback(
    (idx: number, field: keyof Rule, value: string) => {
      const rules = [...(extras.rules ?? [])];
      rules[idx] = { ...rules[idx], [field]: value };
      onChange({ ...extras, rules });
    },
    [extras, onChange]
  );

  const removeRule = useCallback(
    (idx: number) => {
      onChange({ ...extras, rules: extras.rules?.filter((_, i) => i !== idx) });
    },
    [extras, onChange]
  );

  const addRule = useCallback(() => {
    onChange({
      ...extras,
      rules: [...(extras.rules ?? []), { category: "Other", text: "" }],
    });
  }, [extras, onChange]);

  // ── Allowance helpers ─────────────────────────────────────────────────────

  const removeAllowanceItem = useCallback(
    (catIdx: number, itemIdx: number) => {
      const allowances = [...(extras.allowances ?? [])];
      const items = allowances[catIdx].items.filter((_, i) => i !== itemIdx);
      if (items.length === 0) allowances.splice(catIdx, 1);
      else allowances[catIdx] = { ...allowances[catIdx], items };
      onChange({ ...extras, allowances });
    },
    [extras, onChange]
  );

  const addAllowanceItem = useCallback(
    (catIdx: number) => {
      const allowances = [...(extras.allowances ?? [])];
      allowances[catIdx] = { ...allowances[catIdx], items: [...allowances[catIdx].items, ""] };
      onChange({ ...extras, allowances });
    },
    [extras, onChange]
  );

  const updateAllowanceItem = useCallback(
    (catIdx: number, itemIdx: number, value: string) => {
      const allowances = [...(extras.allowances ?? [])];
      const items = [...allowances[catIdx].items];
      items[itemIdx] = value;
      allowances[catIdx] = { ...allowances[catIdx], items };
      onChange({ ...extras, allowances });
    },
    [extras, onChange]
  );

  const addAllowanceCategory = useCallback(() => {
    onChange({
      ...extras,
      allowances: [...(extras.allowances ?? []), { category: "Other", items: [""] }],
    });
  }, [extras, onChange]);

  // ── Section copy/paste/template handlers ──────────────────────────────────

  const handleCopySupplements = useCallback(async () => {
    const ok = await copySection("supplements", extras.supplements ?? []);
    showToast(ok ? "Supplement stack copied" : "Copy failed");
  }, [extras.supplements, showToast]);

  const handlePasteSupplements = useCallback(async (mode: "replace" | "merge") => {
    const data = await pasteSection<Supplement[]>("supplements");
    if (!data) { showToast("No supplement stack in clipboard"); return; }
    if (mode === "replace") {
      onChange({ ...extras, supplements: data });
    } else {
      onChange({ ...extras, supplements: [...(extras.supplements ?? []), ...data] });
    }
    showToast(mode === "replace" ? "Stack replaced" : "Stack merged");
  }, [extras, onChange, showToast]);

  const handleCopyOverride = useCallback(async (idx: number) => {
    const override = extras.dayOverrides?.[idx];
    if (!override) return;
    const ok = await copySection("override", override);
    showToast(ok ? "Override copied" : "Copy failed");
  }, [extras.dayOverrides, showToast]);

  const handlePasteOverride = useCallback(async () => {
    const data = await pasteSection<DayOverride>("override");
    if (!data) { showToast("No override in clipboard"); return; }
    const copy = { ...data, label: `${data.label} (Pasted)` };
    onChange({ ...extras, dayOverrides: [...(extras.dayOverrides ?? []), copy] });
    showToast("Override pasted");
  }, [extras, onChange, showToast]);

  const handleCopyRules = useCallback(async () => {
    const ok = await copySection("rules", extras.rules ?? []);
    showToast(ok ? "Rules copied" : "Copy failed");
  }, [extras.rules, showToast]);

  const handlePasteRules = useCallback(async () => {
    const data = await pasteSection<Rule[]>("rules");
    if (!data) { showToast("No rules in clipboard"); return; }
    onChange({ ...extras, rules: [...(extras.rules ?? []), ...data] });
    showToast("Rules pasted");
  }, [extras, onChange, showToast]);

  const handleCopyAllowances = useCallback(async () => {
    const ok = await copySection("allowances", extras.allowances ?? []);
    showToast(ok ? "Allowances copied" : "Copy failed");
  }, [extras.allowances, showToast]);

  const handlePasteAllowances = useCallback(async () => {
    const data = await pasteSection<Allowance[]>("allowances");
    if (!data) { showToast("No allowances in clipboard"); return; }
    onChange({ ...extras, allowances: [...(extras.allowances ?? []), ...data] });
    showToast("Allowances pasted");
  }, [extras, onChange, showToast]);

  // ── Template handlers ─────────────────────────────────────────────────────

  const [templateModal, setTemplateModal] = useState<{
    type: SnippetType;
    mode: "save" | "apply";
    applyCallback?: (payload: unknown) => void;
  } | null>(null);

  const handleSaveTemplate = useCallback((type: SnippetType, data: unknown) => {
    setTemplateModal({
      type,
      mode: "save",
      applyCallback: () => {
        // The save modal handles the actual save
        void data; // data is passed via closure to the modal
      },
    });
  }, []);

  const handleApplyTemplate = useCallback((type: SnippetType, cb: (payload: unknown) => void) => {
    setTemplateModal({ type, mode: "apply", applyCallback: cb });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}

      {/* Template Modal */}
      {templateModal && (
        <TemplateModal
          type={templateModal.type}
          mode={templateModal.mode}
          saveData={
            templateModal.mode === "save"
              ? templateModal.type === "supplements" ? extras.supplements
              : templateModal.type === "rules" ? extras.rules
              : templateModal.type === "allowances" ? extras.allowances
              : null
              : undefined
          }
          onApply={(payload) => {
            templateModal.applyCallback?.(payload);
            setTemplateModal(null);
          }}
          onClose={() => setTemplateModal(null)}
        />
      )}

      {/* Section divider */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700/50" />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">Plan Details</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700/50" />
      </div>

      {/* ── Metadata ── */}
      {extras.metadata && (
        <ExtrasCard>
          <ExtrasCardHeader label="Overview" />
          <div className="grid gap-2 sm:grid-cols-3">
            <EditableField label="Phase" value={extras.metadata.phase ?? ""} onChange={(v) => updateMetadata("phase", v)} placeholder="e.g. bulking, cutting" />
            <EditableField label="Weight" value={extras.metadata.bodyweight ?? ""} onChange={(v) => updateMetadata("bodyweight", v)} placeholder="e.g. 173 lbs" />
            <EditableField label="Start Date" value={extras.metadata.startDate ?? ""} onChange={(v) => updateMetadata("startDate", v)} placeholder="e.g. 3/11/2026" />
          </div>
          <div className="mt-2">
            <EditableField label="Coach Notes" value={extras.metadata.coachNotes ?? ""} onChange={(v) => updateMetadata("coachNotes", v)} placeholder="Notes for the client" multiline />
          </div>
          {extras.metadata.highlightedChanges && (
            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Changes</span>
                <button
                  type="button"
                  onClick={() => {
                    const updated = { ...extras.metadata };
                    delete (updated as Record<string, unknown>).highlightedChanges;
                    onChange({ ...extras, metadata: updated });
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-amber-400 transition-colors hover:bg-amber-500/10 hover:text-red-500"
                  aria-label="Remove highlighted changes"
                >
                  &times;
                </button>
              </div>
              <EditableField value={extras.metadata.highlightedChanges} onChange={(v) => updateMetadata("highlightedChanges", v)} placeholder="Highlighted changes" />
            </div>
          )}
        </ExtrasCard>
      )}

      {/* ── Day Overrides ── */}
      <ExtrasCard>
        <div className="flex items-center justify-between mb-2.5">
          <ExtrasCardHeader label="Day Overrides" count={extras.dayOverrides?.length} />
          <SectionMenu
            actions={[
              { label: "Paste Override", onClick: handlePasteOverride },
              { label: "Apply Template…", onClick: () => handleApplyTemplate("override", (payload) => {
                const data = payload as DayOverride;
                onChange({ ...extras, dayOverrides: [...(extras.dayOverrides ?? []), { ...data, label: `${data.label}` }] });
                showToast("Template applied");
              })},
            ]}
          />
        </div>

        {(extras.dayOverrides ?? []).length === 0 && (
          <p className="text-xs text-zinc-400 mb-2">No overrides yet. Add one to customize meals for specific days.</p>
        )}

        <div className="space-y-3">
          {(extras.dayOverrides ?? []).map((override, oi) => {
            const color = getOverrideColor(override.color);
            const adjustments = override.mealAdjustments ?? [];

            return (
              <div key={oi} className={`rounded-xl border p-3 ${color.border} bg-white dark:bg-zinc-900/50`}>
                {/* Header */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-3 w-3 shrink-0 rounded-full ${color.dot}`} />
                  <input
                    type="text"
                    value={override.label}
                    onChange={(e) => updateOverride(oi, { label: e.target.value })}
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-bold text-zinc-800 focus:outline-none dark:text-zinc-100"
                    placeholder="Override name"
                  />
                  <div className="flex items-center gap-0.5 order-last w-full sm:order-none sm:w-auto">
                    {OVERRIDE_COLORS.map((c) => (
                      <button key={c.id} type="button" onClick={() => updateOverride(oi, { color: c.id })} className={`h-4 w-4 rounded-full transition-all ${c.dot} ${override.color === c.id ? "ring-2 ring-offset-1 ring-zinc-400 dark:ring-offset-zinc-900" : "opacity-40 hover:opacity-70"}`} aria-label={`Color: ${c.label}`} />
                    ))}
                  </div>
                  <SectionMenu
                    actions={[
                      { label: "Duplicate", onClick: () => duplicateOverride(oi) },
                      { label: "Copy", onClick: () => handleCopyOverride(oi) },
                      { label: "Save as Template…", onClick: () => {
                        setTemplateModal({
                          type: "override",
                          mode: "save",
                          applyCallback: () => {},
                        });
                        // We need to pass the specific override data to the modal.
                        // Store it temporarily:
                        setSaveOverrideData(override);
                      }},
                      { label: "Delete", onClick: () => removeOverride(oi), danger: true },
                    ]}
                  />
                </div>

                {/* Weekday selector */}
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {WEEKDAYS.map((day) => {
                    const active = override.weekdays?.includes(day);
                    return (
                      <button key={day} type="button" onClick={() => toggleOverrideDay(oi, day)} className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold transition-all ${active ? `${color.bg} ${color.text}` : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-700"}`}>
                        {day.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>

                {/* Meal Adjustments */}
                <div className="mt-3 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Meal Modifications</span>
                  {adjustments.length === 0 && <p className="text-[11px] text-zinc-400">No meal modifications yet</p>}
                  {adjustments.map((adj, ai) => (
                    <div key={ai} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-700/50 dark:bg-zinc-800/30">
                      <div className="flex items-center gap-2">
                        {mealNames && mealNames.length > 0 ? (
                          <select value={adj.mealName} onChange={(e) => updateMealAdjustment(oi, ai, { mealName: e.target.value })} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {mealNames.map((m) => (<option key={m} value={m}>{m}</option>))}
                          </select>
                        ) : (
                          <input type="text" value={adj.mealName} onChange={(e) => updateMealAdjustment(oi, ai, { mealName: e.target.value })} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-bold focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" placeholder="Meal name" />
                        )}
                        <input type="text" value={adj.notes ?? ""} onChange={(e) => updateMealAdjustment(oi, ai, { notes: e.target.value })} className="flex-1 border-0 bg-transparent p-0 text-[11px] text-zinc-400 focus:outline-none dark:text-zinc-500" placeholder="Meal notes" />
                        <button type="button" onClick={() => removeMealAdjustment(oi, ai)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950">&times;</button>
                      </div>
                      <div className="mt-2 space-y-1">
                        {adj.changes.map((change, ci) => (
                          <MealChangeRow key={ci} change={change} onUpdate={(patch) => updateChange(oi, ai, ci, patch)} onRemove={() => removeChange(oi, ai, ci)} />
                        ))}
                      </div>
                      <button type="button" onClick={() => addChange(oi, ai)} className="mt-1.5 rounded-md border border-dashed border-zinc-300 px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600">+ Add Change</button>
                    </div>
                  ))}
                </div>

                <button type="button" onClick={() => addMealAdjustment(oi)} className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 py-1.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300">+ Add Meal Modification</button>

                <div className="mt-2">
                  <input type="text" value={override.notes ?? ""} onChange={(e) => updateOverride(oi, { notes: e.target.value })} className="w-full border-0 bg-transparent p-0 text-[11px] text-zinc-500 focus:outline-none dark:text-zinc-400" placeholder="Override notes (optional)" />
                </div>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={addOverride} className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 py-2 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300">+ Add Day Override</button>
      </ExtrasCard>

      {/* ── Supplements ── */}
      {extras.supplements && extras.supplements.length > 0 && (
        <ExtrasCard>
          <div className="flex items-center justify-between mb-2.5">
            <ExtrasCardHeader label="Supplements" count={extras.supplements.length} />
            <SectionMenu
              actions={[
                { label: "Copy Stack", onClick: handleCopySupplements },
                { label: "Paste (Replace)", onClick: () => handlePasteSupplements("replace") },
                { label: "Paste (Merge)", onClick: () => handlePasteSupplements("merge") },
                { label: "Save as Template…", onClick: () => handleSaveTemplate("supplements", extras.supplements) },
                { label: "Apply Template…", onClick: () => handleApplyTemplate("supplements", (payload) => {
                  onChange({ ...extras, supplements: payload as Supplement[] });
                  showToast("Supplement template applied");
                })},
              ]}
            />
          </div>
          <SupplementEditor supplements={extras.supplements} onUpdate={updateSupplement} onRemove={removeSupplement} />
          <button type="button" onClick={addSupplement} className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 py-1.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300">+ Add Supplement</button>
        </ExtrasCard>
      )}

      {/* ── Allowances ── */}
      {extras.allowances && extras.allowances.length > 0 && (
        <ExtrasCard>
          <div className="flex items-center justify-between mb-2.5">
            <ExtrasCardHeader label="Approved Extras" count={extras.allowances.length} />
            <SectionMenu
              actions={[
                { label: "Copy Allowances", onClick: handleCopyAllowances },
                { label: "Paste Allowances", onClick: handlePasteAllowances },
                { label: "Save as Template…", onClick: () => handleSaveTemplate("allowances", extras.allowances) },
                { label: "Apply Template…", onClick: () => handleApplyTemplate("allowances", (payload) => {
                  onChange({ ...extras, allowances: payload as Allowance[] });
                  showToast("Allowances template applied");
                })},
              ]}
            />
          </div>
          <div className="space-y-3">
            {extras.allowances.map((allow, catIdx) => (
              <div key={catIdx}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{allow.category}</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {allow.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="group/chip flex items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-50 pr-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                      <input type="text" value={item} onChange={(e) => updateAllowanceItem(catIdx, itemIdx, e.target.value)} className="min-w-[3.5rem] max-w-[10rem] border-0 bg-transparent px-2 py-1 text-[11px] font-medium text-zinc-600 focus:outline-none dark:text-zinc-300" style={{ width: `${Math.max(3.5, item.length * 0.6)}em` }} />
                      <button type="button" onClick={() => removeAllowanceItem(catIdx, itemIdx)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-300 opacity-100 transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover/chip:opacity-100" aria-label={`Remove ${item}`}>&times;</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addAllowanceItem(catIdx)} className="shrink-0 rounded-md border border-dashed border-zinc-300 px-3 py-1 text-[10px] text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600">+</button>
                </div>
                {allow.restriction && <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">{allow.restriction}</p>}
              </div>
            ))}
          </div>
          <button type="button" onClick={addAllowanceCategory} className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 py-1.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300">+ Add Category</button>
        </ExtrasCard>
      )}

      {/* ── Rules ── */}
      {extras.rules && extras.rules.length > 0 && (
        <ExtrasCard>
          <div className="flex items-center justify-between mb-2.5">
            <ExtrasCardHeader label="Rules & Guidelines" count={extras.rules.length} />
            <SectionMenu
              actions={[
                { label: "Copy Rules", onClick: handleCopyRules },
                { label: "Paste Rules", onClick: handlePasteRules },
                { label: "Save as Template…", onClick: () => handleSaveTemplate("rules", extras.rules) },
                { label: "Apply Template…", onClick: () => handleApplyTemplate("rules", (payload) => {
                  onChange({ ...extras, rules: payload as Rule[] });
                  showToast("Rules template applied");
                })},
              ]}
            />
          </div>
          <div className="space-y-1.5">
            {extras.rules.map((rule, idx) => (
              <div key={idx} className="group flex items-start gap-2">
                <select value={rule.category} onChange={(e) => updateRule(idx, "category", e.target.value)} className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-[10px] font-bold uppercase text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {["Meal Timing", "Hydration", "Cardio", "Check-In", "Communication", "Cooking", "Other"].map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
                </select>
                <input type="text" value={rule.text} onChange={(e) => updateRule(idx, "text", e.target.value)} className="flex-1 border-0 bg-transparent p-0 text-xs leading-relaxed text-zinc-600 focus:outline-none dark:text-zinc-300" placeholder="Rule text" />
                <button type="button" onClick={() => removeRule(idx)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100">&times;</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRule} className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 py-1.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300">+ Add Rule</button>
        </ExtrasCard>
      )}
    </div>
  );

}

// ── Extra state for saving specific override ────────────────────────────────
// We use a module-level ref to pass override data to the template modal
let _pendingSaveOverrideData: DayOverride | null = null;
function setSaveOverrideData(d: DayOverride) { _pendingSaveOverrideData = d; }

// ── Section Menu Component ──────────────────────────────────────────────────

function SectionMenu({ actions }: { actions: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        aria-label="Section actions"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 min-w-[160px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {actions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setOpen(false); action.onClick(); }}
                className={`w-full px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                  action.danger
                    ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Template Modal ──────────────────────────────────────────────────────────

function TemplateModal({
  type,
  mode,
  saveData,
  onApply,
  onClose,
}: {
  type: SnippetType;
  mode: "save" | "apply";
  saveData?: unknown;
  onApply: (payload: unknown) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [snippets, setSnippets] = useState<{ id: string; name: string; createdAt: Date }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === "apply" || mode === "save") {
      setLoading(true);
      listPlanSnippets(type).then(setSnippets).finally(() => setLoading(false));
    }
  }, [type, mode]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // For overrides, use the pending data
      const data = type === "override" ? _pendingSaveOverrideData : saveData;
      await savePlanSnippet(type, name.trim(), data);
      _pendingSaveOverrideData = null;
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (snippetId: string) => {
    try {
      const snippet = await getPlanSnippet(snippetId);
      onApply(snippet.payload);
    } catch {
      // noop
    }
  };

  const handleDelete = async (snippetId: string) => {
    await deletePlanSnippet(snippetId);
    setSnippets((prev) => prev.filter((s) => s.id !== snippetId));
  };

  const typeLabel = type === "supplements" ? "Supplement Stack" : type === "override" ? "Override" : type === "rules" ? "Rules" : "Allowances";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
          {mode === "save" ? `Save ${typeLabel} Template` : `Apply ${typeLabel} Template`}
        </h3>

        {mode === "save" && (
          <div className="mt-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. Default ${typeLabel}`}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              autoFocus
            />
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                {saving ? "Saving…" : "Save Template"}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Cancel</button>
            </div>
          </div>
        )}

        {mode === "apply" && (
          <div className="mt-3">
            {loading && <p className="text-xs text-zinc-400">Loading templates…</p>}
            {!loading && snippets.length === 0 && (
              <p className="text-xs text-zinc-400">No saved templates yet. Save one first.</p>
            )}
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {snippets.map((s) => (
                <div key={s.id} className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <button type="button" onClick={() => handleApply(s.id)} className="flex-1 text-left text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    {s.name}
                  </button>
                  <button type="button" onClick={() => handleDelete(s.id)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100">&times;</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Close</button>
          </div>
        )}

        {/* Show existing templates in save mode too */}
        {mode === "save" && snippets.length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Existing Templates</p>
            <div className="max-h-32 space-y-0.5 overflow-y-auto">
              {snippets.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded px-2 py-1">
                  <span className="flex-1 text-[11px] text-zinc-500">{s.name}</span>
                  <button type="button" onClick={() => handleDelete(s.id)} className="text-[10px] text-zinc-300 hover:text-red-500">&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Meal Change Row ─────────────────────────────────────────────────────────

function MealChangeRow({ change, onUpdate, onRemove }: { change: MealChange; onUpdate: (patch: Partial<MealChange>) => void; onRemove: () => void }) {
  return (
    <div className="group flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-xs dark:bg-zinc-800/80">
      <select value={change.type} onChange={(e) => onUpdate({ type: e.target.value as MealChange["type"] })} className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[10px] font-bold uppercase focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        {CHANGE_TYPES.map((ct) => (<option key={ct.id} value={ct.id}>{ct.label}</option>))}
      </select>
      <input type="text" value={change.food} onChange={(e) => onUpdate({ food: e.target.value })} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-medium focus:outline-none dark:text-zinc-200" placeholder={change.type === "add" ? "New food" : "Food to modify"} />
      {(change.type === "update" || change.type === "add") && (
        <input type="text" value={change.newPortion ?? ""} onChange={(e) => onUpdate({ newPortion: e.target.value })} className="w-20 border-0 bg-transparent p-0 text-xs text-zinc-500 focus:outline-none dark:text-zinc-400" placeholder="Amount" />
      )}
      {change.type === "replace" && (
        <>
          <span className="text-[10px] text-zinc-400">→</span>
          <input type="text" value={change.replacementFood ?? ""} onChange={(e) => onUpdate({ replacementFood: e.target.value })} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-medium focus:outline-none dark:text-zinc-200" placeholder="Replacement" />
          <input type="text" value={change.replacementPortion ?? ""} onChange={(e) => onUpdate({ replacementPortion: e.target.value })} className="w-20 border-0 bg-transparent p-0 text-xs text-zinc-500 focus:outline-none dark:text-zinc-400" placeholder="Amount" />
        </>
      )}
      <button type="button" onClick={onRemove} className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100">&times;</button>
    </div>
  );
}

// ── Shared Sub-components ────────────────────────────────────────────────────

function ExtrasCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-700/50 dark:bg-zinc-900/80">{children}</div>;
}

function ExtrasCardHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</span>
      {count != null && count > 0 && (
        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{count}</span>
      )}
    </div>
  );
}

function EditableField({ label, value, onChange, placeholder, multiline }: { label?: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  const cls = "w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return (
    <div>
      {label && <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>}
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className={cls} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </div>
  );
}

function SupplementEditor({ supplements, onUpdate, onRemove }: { supplements: Supplement[]; onUpdate: (idx: number, field: keyof Supplement, value: string | boolean) => void; onRemove: (idx: number) => void }) {
  const grouped = new Map<string, { supp: Supplement; idx: number }[]>();
  supplements.forEach((supp, idx) => {
    const key = supp.timing;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ supp, idx });
  });
  const sorted = [...grouped.keys()].sort((a, b) => {
    const ia = SUPPLEMENT_TIMING_ORDER.indexOf(a as typeof SUPPLEMENT_TIMING_ORDER[number]);
    const ib = SUPPLEMENT_TIMING_ORDER.indexOf(b as typeof SUPPLEMENT_TIMING_ORDER[number]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <div className="space-y-2.5">
      {sorted.map((timing) => (
        <div key={timing}>
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{timing}</span>
          <div className="mt-1 space-y-1">
            {grouped.get(timing)!.map(({ supp, idx }) => (
              <div key={idx} className="group flex flex-col gap-1 rounded py-1 pl-3 sm:flex-row sm:items-center sm:gap-2 sm:py-0.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <input type="text" value={supp.name} onChange={(e) => onUpdate(idx, "name", e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-medium text-zinc-700 focus:outline-none dark:text-zinc-200" placeholder="Supplement name" />
                  <button type="button" onClick={() => onRemove(idx)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 opacity-100 transition-opacity hover:text-red-500 sm:hidden">&times;</button>
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" value={supp.dosage ?? ""} onChange={(e) => onUpdate(idx, "dosage", e.target.value)} className="w-20 shrink-0 border-0 bg-transparent p-0 text-xs text-zinc-400 focus:outline-none dark:text-zinc-500" placeholder="Dosage" />
                  <select value={supp.timing} onChange={(e) => onUpdate(idx, "timing", e.target.value)} className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {SUPPLEMENT_TIMING_ORDER.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <button type="button" onClick={() => onRemove(idx)} className="hidden sm:flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100">&times;</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
