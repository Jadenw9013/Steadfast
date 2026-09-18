"use client";

import { useState, useMemo, useTransition } from "react";
import { parsePlanExtras, SUPPLEMENT_TIMING_ORDER, getOverrideColor, type PlanExtras, type DayOverride, type MealAdjustment, type MealChange } from "@/types/meal-plan-extras";
import { toggleMealCheckoff } from "@/app/actions/adherence";
import { MacroPlanView } from "./macro-plan-view";
import type { MacroMealTarget } from "@/types/meal-plan";
import { resolveDisplayPlanMode } from "@/lib/meal-plans/display-mode";

// ── Types ────────────────────────────────────────────────────────────────────

type MealPlanItem = {
  id: string;
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
};

type MealPlan = {
  publishedAt: Date | null;
  planMode?: "MEAL_PLAN" | "MACROS";
  planExtras?: unknown;

  supportContent?: string | null;
  items: MealPlanItem[];
  macroTargets?: MacroMealTarget[];
};

type MealAdherenceProps = {
  date: string;             // YYYY-MM-DD
  completedMeals: string[]; // mealNameSnapshots already completed
  todayWeekday: string;     // e.g. "Monday" — matches WEEKDAYS constant
};

/** A resolved meal item after applying day overrides */
type ResolvedItem = MealPlanItem & {
  overridden?: {
    originalServing: string | null;
    overrideLabel: string;
    overrideColor: string;
    changeType: MealChange["type"];
  };
  /** Items flagged for removal are filtered out */
  _removed?: boolean;
};

// ── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type Weekday = typeof WEEKDAYS[number];

/** Flow palette for meal card atmospheric tinting (mirrors iOS sfFlowPalette) */
const MEAL_FLOW = [
  { highlight: "rgba(139, 92, 246, 0.10)" },   // purple
  { highlight: "rgba(99, 102, 241, 0.10)" },    // indigo
  { highlight: "rgba(59, 130, 246, 0.10)" },     // blue
  { highlight: "rgba(8, 145, 178, 0.10)" },      // cyan
  { highlight: "rgba(16, 185, 129, 0.10)" },     // emerald
  { highlight: "rgba(245, 158, 11, 0.10)" },     // amber
] as const;

function getCurrentWeekday(): Weekday {
  const jsDay = new Date().getDay();
  const mapped = jsDay === 0 ? 6 : jsDay - 1;
  return WEEKDAYS[mapped];
}

// ── Quantity display (matches iOS quantityLabel) ─────────────────────────────

function formatQuantityUnit(quantity: string, unit: string): string {
  const num = parseFloat(quantity);
  const formattedQty = isNaN(num) || num === 0
    ? ""
    : Number.isInteger(num)
      ? String(Math.round(num))
      : num.toFixed(1);

  if (unit && unit.trim()) {
    return formattedQty ? `${formattedQty} ${unit}` : unit;
  }
  return formattedQty || "Serving";
}

// ── Override Resolution ──────────────────────────────────────────────────────

function foodMatchesOverride(itemFoodName: string, overrideFood: string): boolean {
  if (!overrideFood) return false;
  const normItem = itemFoodName.toLowerCase().trim();
  const normOverride = overrideFood.toLowerCase().trim();
  if (normItem.includes(normOverride) || normOverride.includes(normItem)) return true;
  const overrideWords = normOverride.split(/\s+/);
  return overrideWords.length > 0 && overrideWords.every((w) => normItem.includes(w));
}

/**
 * Resolve the meal plan for a specific weekday by applying meal-level overrides.
 * Supports new `mealAdjustments` model and legacy flat `items` model.
 */
function resolveForDay(
  items: MealPlanItem[],
  overrides: DayOverride[],
  day: Weekday
): { resolvedItems: ResolvedItem[]; activeOverrides: DayOverride[] } {
  const activeOverrides = overrides.filter((o) =>
    o.weekdays?.some((wd) => wd.toLowerCase() === day.toLowerCase())
  );

  if (activeOverrides.length === 0) {
    return {
      resolvedItems: items.map((item) => ({ ...item })),
      activeOverrides: [],
    };
  }

  // Collect all meal adjustments from active overrides
  const adjustmentsByMeal = new Map<string, { adj: MealAdjustment; overrideLabel: string; overrideColor: string }[]>();

  for (const override of activeOverrides) {
    // New model: mealAdjustments
    if (override.mealAdjustments?.length) {
      for (const adj of override.mealAdjustments) {
        const key = adj.mealName.toLowerCase().trim();
        if (!adjustmentsByMeal.has(key)) adjustmentsByMeal.set(key, []);
        adjustmentsByMeal.get(key)!.push({
          adj,
          overrideLabel: override.label,
          overrideColor: override.color ?? "blue",
        });
      }
    }

    // Legacy model: flat items (backward compat)
    if (override.items?.length && !override.mealAdjustments?.length) {
      for (const item of override.items) {
        const syntheticAdj: MealAdjustment = {
          mealName: "__ALL__",
          changes: [{
            type: item.replaces ? "replace" as const : "update" as const,
            food: item.replaces || item.food,
            newPortion: item.portion,
            ...(item.replaces ? { replacementFood: item.food, replacementPortion: item.portion } : {}),
          }],
        };
        if (!adjustmentsByMeal.has("__all__")) adjustmentsByMeal.set("__all__", []);
        adjustmentsByMeal.get("__all__")!.push({
          adj: syntheticAdj,
          overrideLabel: override.label,
          overrideColor: override.color ?? "blue",
        });
      }
    }
  }

  // Apply changes to items
  const resolvedItems: ResolvedItem[] = [];

  for (const item of items) {
    const mealKey = item.mealName.toLowerCase().trim();
    const relevantAdjs = [
      ...(adjustmentsByMeal.get(mealKey) ?? []),
      ...(adjustmentsByMeal.get("__all__") ?? []),
    ];

    let resolved: ResolvedItem = { ...item };
    let wasModified = false;

    for (const { adj, overrideLabel, overrideColor } of relevantAdjs) {
      for (const change of adj.changes) {
        if (change.type === "update" && foodMatchesOverride(item.foodName, change.food)) {
          resolved = {
            ...resolved,
            quantity: change.newPortion ? "0" : item.quantity,
            unit: change.newPortion || item.unit,
            servingDescription: change.newPortion || item.servingDescription,
            overridden: {
              originalServing: item.servingDescription?.trim() || formatQuantityUnit(item.quantity, item.unit),
              overrideLabel,
              overrideColor,
              changeType: "update",
            },
          };
          wasModified = true;
          break;
        }

        if (change.type === "remove" && foodMatchesOverride(item.foodName, change.food)) {
          resolved = { ...resolved, _removed: true };
          wasModified = true;
          break;
        }

        if (change.type === "replace" && foodMatchesOverride(item.foodName, change.food)) {
          resolved = {
            ...resolved,
            foodName: change.replacementFood || item.foodName,
            quantity: change.replacementPortion ? "0" : item.quantity,
            unit: change.replacementPortion || item.unit,
            servingDescription: change.replacementPortion || item.servingDescription,
            calories: 0,
            protein: 0,
            carbs: 0,
            fats: 0,
            overridden: {
              originalServing: `${item.foodName}`,
              overrideLabel,
              overrideColor,
              changeType: "replace",
            },
          };
          wasModified = true;
          break;
        }
      }
      if (wasModified) break;
    }

    if (!resolved._removed) {
      resolvedItems.push(resolved);
    }
  }

  // Handle "add" changes
  const addedItems: ResolvedItem[] = [];
  for (const [mealKey, adjs] of adjustmentsByMeal) {
    for (const { adj, overrideLabel, overrideColor } of adjs) {
      for (const change of adj.changes) {
        if (change.type === "add") {
          const targetMeal = mealKey === "__all__"
            ? items[0]?.mealName ?? "Meal 1"
            : adj.mealName;

          addedItems.push({
            id: `added-${overrideLabel}-${change.food}-${Math.random().toString(36).slice(2, 6)}`,
            mealName: targetMeal,
            foodName: change.food,
            quantity: "0",
            unit: change.newPortion || "",
            servingDescription: change.newPortion || null,
            calories: 0,
            protein: 0,
            carbs: 0,
            fats: 0,
            overridden: {
              originalServing: null,
              overrideLabel,
              overrideColor,
              changeType: "add",
            },
          });
        }
      }
    }
  }

  const finalItems = [...resolvedItems];
  for (const added of addedItems) {
    const key = added.mealName.toLowerCase().trim();
    const lastIdx = finalItems.findLastIndex((i) => i.mealName.toLowerCase().trim() === key);
    if (lastIdx >= 0) {
      finalItems.splice(lastIdx + 1, 0, added);
    } else {
      finalItems.push(added);
    }
  }

  return { resolvedItems: finalItems, activeOverrides };
}

// ── Visual helpers ───────────────────────────────────────────────────────────

function getChangeTypeLabel(type: MealChange["type"]): string {
  switch (type) {
    case "update": return "Adjusted";
    case "add": return "Added";
    case "remove": return "Removed";
    case "replace": return "Replaced";
  }
}

// ── Extras sub-components ────────────────────────────────────────────────────

function MetadataSection({ extras }: { extras: PlanExtras }) {
  const m = extras.metadata;
  if (!m) return null;
  const items = [
    m.phase && { label: "Phase", value: m.phase },
    m.startDate && { label: "Start", value: m.startDate },
    m.bodyweight && { label: "Weight", value: m.bodyweight },
  ].filter(Boolean) as { label: string; value: string }[];
  if (!items.length && !m.coachNotes && !m.highlightedChanges) return null;
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {items.map(({ label, value }) => (
            <div key={label} className="rounded-2xl bg-white/[0.04] border border-zinc-800/50 px-4 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
              <p className="mt-0.5 text-sm font-bold text-zinc-200">{value}</p>
            </div>
          ))}
        </div>
      )}
      {m.highlightedChanges && (
        <p className="text-xs text-amber-400/80">
          <span className="font-semibold">Changes:</span> {m.highlightedChanges}
        </p>
      )}
      {m.coachNotes && <p className="text-xs text-zinc-500">{m.coachNotes}</p>}
    </div>
  );
}

// ── Macro Summary ────────────────────────────────────────────────────────────

function MacroSummary({ items }: { items: ResolvedItem[] }) {
  const totals = useMemo(() => {
    let cal = 0, pro = 0, carb = 0, fat = 0;
    for (const item of items) {
      cal += item.calories || 0;
      pro += item.protein || 0;
      carb += item.carbs || 0;
      fat += item.fats || 0;
    }
    return { calories: cal, protein: pro, carbs: carb, fats: fat };
  }, [items]);

  // Don't show if no macro data at all
  if (totals.calories === 0 && totals.protein === 0 && totals.carbs === 0 && totals.fats === 0) return null;

  const macros = [
    { label: "Cal", value: `${totals.calories}` },
    { label: "P", value: `${totals.protein}g` },
    { label: "C", value: `${totals.carbs}g` },
    { label: "F", value: `${totals.fats}g` },
  ];

  return (
    <div className="flex items-center gap-4 rounded-xl bg-white/[0.03] px-4 py-2.5 text-xs">
      {macros.map(({ label, value }) => (
        <span key={label} className="tabular-nums">
          <span className="font-bold text-zinc-300">{value}</span>
          <span className="ml-0.5 text-zinc-600">{label}</span>
        </span>
      ))}
    </div>
  );
}

// ── Per-meal macro subtotal ──────────────────────────────────────────────────

function MealMacroBar({ items }: { items: ResolvedItem[] }) {
  const totals = useMemo(() => {
    let cal = 0, pro = 0, carb = 0, fat = 0;
    for (const item of items) {
      cal += item.calories || 0;
      pro += item.protein || 0;
      carb += item.carbs || 0;
      fat += item.fats || 0;
    }
    return { calories: cal, protein: pro, carbs: carb, fats: fat };
  }, [items]);

  if (totals.calories === 0 && totals.protein === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-zinc-500">
      {totals.calories > 0 && <span>{totals.calories} cal</span>}
      {totals.protein > 0 && <span className="text-emerald-500/70">{totals.protein}g P</span>}
      {totals.carbs > 0 && <span className="text-amber-500/70">{totals.carbs}g C</span>}
      {totals.fats > 0 && <span className="text-rose-500/70">{totals.fats}g F</span>}
    </div>
  );
}

// ── Day Selector ─────────────────────────────────────────────────────────────

function DaySelector({
  selectedDay,
  onSelect,
  overridesByDay,
}: {
  selectedDay: Weekday;
  onSelect: (day: Weekday) => void;
  overridesByDay: Map<string, DayOverride[]>;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {WEEKDAYS.map((day) => {
        const isSelected = day === selectedDay;
        const dayOverrides = overridesByDay.get(day.toLowerCase());
        const hasOverride = !!dayOverrides?.length;
        const dotColor = hasOverride ? getOverrideColor(dayOverrides![0].color).dot : "";
        return (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            className={`relative flex min-w-[40px] flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-xs font-bold tracking-wide transition-all cursor-pointer ${
              isSelected
                ? "bg-white/[0.10] text-white"
                : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            <span>{day.slice(0, 3).toUpperCase()}</span>
            <span className={`h-1.5 w-1.5 rounded-full ${
              hasOverride
                ? isSelected ? "bg-white/60" : dotColor
                : "bg-white/[0.08]"
            }`} />
          </button>
        );
      })}
    </div>
  );
}

// ── Active Override Banner ────────────────────────────────────────────────────

function ActiveOverrideBanner({ overrides }: { overrides: DayOverride[] }) {
  if (overrides.length === 0) return null;
  return (
    <div className="space-y-2">
      {overrides.map((o, i) => {
        const color = getOverrideColor(o.color);
        const mealCount = o.mealAdjustments?.length ?? 0;
        return (
          <div key={i} className={`rounded-2xl border ${color.border} bg-white/[0.02] px-4 py-3`}>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${color.dot}`} />
              <span className={`text-sm font-bold ${color.text}`}>{o.label}</span>
              {mealCount > 0 && (
                <span className="text-xs text-zinc-500">
                  {mealCount} {mealCount === 1 ? "meal" : "meals"} modified
                </span>
              )}
            </div>
            {o.notes && <p className={`mt-1.5 text-xs ${color.text} opacity-70`}>{o.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Plan Notes ────────────────────────────────────────────────────────────────



// ── Support Content ──────────────────────────────────────────────────────────

function SupportContentSection({ content }: { content?: string | null }) {
  if (!content) return null;
  return (
    <div className="sf-glass-card p-5">
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">Guidance & Support</h3>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300/90">
        {content}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

/** Dispatches to the macro-only view or the full food-based body — kept hook-free
 *  so switching planMode across a re-render never violates the Rules of Hooks
 *  (each branch below is its own component instance, not a conditional hook call). */
export function SimpleMealPlan({
  mealPlan,
  adherence,
}: {
  mealPlan: MealPlan;
  adherence?: MealAdherenceProps;
}) {
  // Defensive render rule (T-800): a plan can be stamped MACROS with zero
  // macro targets but non-empty items (a mislabeled foods plan). Never blank
  // the client when content exists — render the foods instead.
  const displayMode = resolveDisplayPlanMode(mealPlan.planMode ?? "MEAL_PLAN", {
    items: mealPlan.items.length,
    macroTargets: (mealPlan.macroTargets ?? []).length,
  });

  if (displayMode === "MACROS") {
    return (
      <MacroPlanView
        meals={mealPlan.macroTargets ?? []}
        supportContent={mealPlan.supportContent}
        adherence={adherence ? { date: adherence.date, completedMeals: adherence.completedMeals } : undefined}
      />
    );
  }

  return <MealPlanBody mealPlan={mealPlan} adherence={adherence} />;
}

function MealPlanBody({
  mealPlan,
  adherence,
}: {
  mealPlan: MealPlan;
  adherence?: MealAdherenceProps;
}) {
  const [selectedDay, setSelectedDay] = useState<Weekday>(getCurrentWeekday);
  const [completedMeals, setCompletedMeals] = useState<Set<string>>(
    () => new Set(adherence?.completedMeals ?? [])
  );
  const [isPending, startTransition] = useTransition();
  const extras = parsePlanExtras(mealPlan.planExtras);
  const hasOverrides = (extras?.dayOverrides?.length ?? 0) > 0;

  // Only show checkoff UI when viewing the tab that matches today
  const isViewingToday = adherence ? selectedDay === adherence.todayWeekday : false;

  const overridesByDay = useMemo(() => {
    const map = new Map<string, DayOverride[]>();
    if (!extras?.dayOverrides) return map;
    for (const o of extras.dayOverrides) {
      for (const wd of o.weekdays ?? []) {
        const key = wd.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(o);
      }
    }
    return map;
  }, [extras]);

  const { resolvedItems, activeOverrides } = useMemo(() => {
    if (!extras?.dayOverrides?.length) {
      return {
        resolvedItems: mealPlan.items.map((item) => ({ ...item })) as ResolvedItem[],
        activeOverrides: [] as DayOverride[],
      };
    }
    return resolveForDay(mealPlan.items, extras.dayOverrides, selectedDay);
  }, [mealPlan.items, extras, selectedDay]);

  const meals = useMemo(() => {
    const grouped = new Map<string, ResolvedItem[]>();
    for (const item of resolvedItems) {
      const key = item.mealName || "Untitled Meal";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }
    return Array.from(grouped);
  }, [resolvedItems]);

  function handleMealToggle(mealName: string, mealIndex: number) {
    if (!adherence?.date) return;
    const alreadyDone = completedMeals.has(mealName);
    const next = !alreadyDone;
    setCompletedMeals((prev) => {
      const s = new Set(prev);
      if (next) s.add(mealName); else s.delete(mealName);
      return s;
    });
    startTransition(async () => {
      const result = await toggleMealCheckoff({
        date: adherence.date,
        mealNameSnapshot: mealName,
        displayOrder: mealIndex,
        completed: next,
      });
      if (result?.error) {
        setCompletedMeals((prev) => {
          const s = new Set(prev);
          if (alreadyDone) s.add(mealName); else s.delete(mealName);
          return s;
        });
      }
    });
  }

  // Progress bar values
  const progressTotal = meals.length;
  const progressDone = meals.filter(([name]) => completedMeals.has(name)).length;

  return (
    <div className="space-y-3">
      {extras && <MetadataSection extras={extras} />}

      {/* Meal progress bar — only visible when viewing today's tab */}
      {adherence && isViewingToday && progressTotal > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              Today&rsquo;s Meals
            </span>
            <span className="text-xs font-semibold tabular-nums text-zinc-400">
              {progressDone} / {progressTotal}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800/60">
            <div
              className="h-full rounded-full bg-emerald-500/70 transition-all duration-500 ease-out"
              style={{ width: progressTotal > 0 ? `${Math.round((progressDone / progressTotal) * 100)}%` : "0%" }}
              role="progressbar"
              aria-valuenow={progressDone}
              aria-valuemin={0}
              aria-valuemax={progressTotal}
              aria-label={`Meals completed: ${progressDone} of ${progressTotal}`}
            />
          </div>
        </div>
      )}

      {hasOverrides && (
        <DaySelector selectedDay={selectedDay} onSelect={setSelectedDay} overridesByDay={overridesByDay} />
      )}

      {activeOverrides.length > 0 && <ActiveOverrideBanner overrides={activeOverrides} />}

      {/* Macro summary — compact bar below day selector */}
      <MacroSummary items={resolvedItems} />

      {/* Meal cards */}
      {meals.map(([mealName, items], mealIndex) => {
        const overriddenItems = items.filter((i) => i.overridden);
        const hasOverriddenItems = overriddenItems.length > 0;
        const overrideLabels = [...new Set(overriddenItems.map((i) => i.overridden!.overrideLabel))];
        const isMealDone = isViewingToday ? completedMeals.has(mealName) : false;

        return (
          <div key={mealName} className={`sf-glass-card overflow-hidden transition-all ${isMealDone ? "border-emerald-900/30" : ""}`}>
            {/* Meal header — compact */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/40">
              {/* Adherence checkbox — circle style */}
              {isViewingToday && (
                <label
                  className="relative flex shrink-0 cursor-pointer items-center justify-center"
                  aria-label={`${mealName}: ${isMealDone ? "mark incomplete" : "mark complete"}`}
                >
                  <input
                    type="checkbox"
                    checked={isMealDone}
                    onChange={() => handleMealToggle(mealName, mealIndex)}
                    disabled={isPending}
                    className="peer sr-only"
                  />
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                    isMealDone
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-zinc-600 bg-transparent"
                  } peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-disabled:opacity-50`}>
                    {isMealDone && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </span>
                </label>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-bold tracking-tight ${isMealDone ? "text-emerald-400 line-through decoration-emerald-500/30" : "text-white"}`}>
                    {mealName}
                  </h3>
                  <span className="text-[11px] text-zinc-600">
                    {items.length} {items.length === 1 ? "item" : "items"}
                  </span>
                  {hasOverriddenItems && overrideLabels.map((label) => {
                    const colorId = overriddenItems.find((i) => i.overridden?.overrideLabel === label)?.overridden?.overrideColor;
                    const color = getOverrideColor(colorId);
                    return (
                      <span key={label} className={`rounded-md ${color.bg} px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${color.text}`}>
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <MealMacroBar items={items} />
            </div>

            {/* Food items — tight rows */}
            <ul>
              {items.map((item) => {
                const color = item.overridden ? getOverrideColor(item.overridden.overrideColor) : null;
                const changeLabel = item.overridden ? getChangeTypeLabel(item.overridden.changeType) : null;
                const servingLabel = item.servingDescription?.trim()
                  ? item.servingDescription.trim()
                  : formatQuantityUnit(item.quantity, item.unit);

                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 border-b border-zinc-800/20 last:border-0 px-4 py-3"
                  >
                    {/* Bullet dot */}
                    <span className={`h-1 w-1 shrink-0 rounded-full ${
                      color ? color.dot : "bg-zinc-600"
                    }`} />

                    <div className="min-w-0 flex-1">
                      <span className={`text-sm font-semibold ${isMealDone ? "text-zinc-500" : "text-zinc-200"}`}>{item.foodName}</span>
                      {item.overridden && (
                        <p className={`text-[10px] font-medium ${color?.text ?? "text-zinc-500"}`}>
                          {changeLabel}
                          {item.overridden.originalServing && ` from ${item.overridden.originalServing}`}
                        </p>
                      )}
                    </div>

                    {/* Serving — plain text */}
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${
                      color ? `${color.text}` : "text-zinc-300"
                    }`}>
                      {servingLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Plan notes & guidance */}
      {mealPlan.supportContent && (
        <SupportContentSection content={mealPlan.supportContent} />
      )}

      {/* Day overrides reference (collapsed) */}
      {extras?.dayOverrides && extras.dayOverrides.length > 0 && (
        <details className="group sf-glass-card">
          <summary className="cursor-pointer px-5 py-3 text-xs font-bold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300">
            Day Override Reference
          </summary>
          <div className="space-y-2 px-5 pb-4">
            {extras.dayOverrides.map((override, i) => {
              const color = getOverrideColor(override.color);
              return (
                <div key={i} className={`rounded-xl border ${color.border} px-3.5 py-3`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                    <span className={`text-sm font-semibold ${color.text}`}>{override.label}</span>
                    {override.weekdays?.map((day) => (
                      <span key={day} className={`rounded-full ${color.bg} px-2 py-0.5 text-[10px] font-bold ${color.text}`}>{day}</span>
                    ))}
                  </div>
                  {override.mealAdjustments?.map((adj, j) => (
                    <div key={j} className="mt-1.5 pl-3 border-l-2 border-zinc-700">
                      <p className="text-xs font-semibold text-zinc-300">{adj.mealName}</p>
                      {adj.changes.map((ch, k) => (
                        <p key={k} className="text-xs text-zinc-400">
                          <span className="font-medium capitalize">{ch.type}</span>
                          {": "}
                          {ch.food}
                          {ch.newPortion && ` → ${ch.newPortion}`}
                          {ch.replacementFood && ` → ${ch.replacementFood}`}
                          {ch.replacementPortion && ` (${ch.replacementPortion})`}
                        </p>
                      ))}
                      {adj.notes && <p className="text-[11px] text-zinc-400">{adj.notes}</p>}
                    </div>
                  ))}
                  {override.items?.map((item, j) => (
                    <p key={`leg-${j}`} className="mt-1 text-xs text-zinc-400">
                      {item.food} {item.portion && `— ${item.portion}`}
                      {item.replaces && <span className="text-zinc-400"> (replaces {item.replaces})</span>}
                    </p>
                  ))}
                  {override.notes && <p className="mt-1 text-xs text-zinc-500">{override.notes}</p>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
