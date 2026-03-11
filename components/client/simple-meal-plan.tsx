"use client";

import { useState, useMemo, useTransition } from "react";
import { parsePlanExtras, SUPPLEMENT_TIMING_ORDER, getOverrideColor, type PlanExtras, type DayOverride, type MealAdjustment, type MealChange } from "@/types/meal-plan-extras";
import { toggleMealCheckoff } from "@/app/actions/adherence";

// ── Types ────────────────────────────────────────────────────────────────────

type MealPlanItem = {
  id: string;
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription: string | null;
};

type MealPlan = {
  publishedAt: Date | null;
  planExtras?: unknown;
  items: MealPlanItem[];
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

function getCurrentWeekday(): Weekday {
  const jsDay = new Date().getDay();
  const mapped = jsDay === 0 ? 6 : jsDay - 1;
  return WEEKDAYS[mapped];
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

    // Legacy model: flat items (backward compat) — apply globally across meals
    if (override.items?.length && !override.mealAdjustments?.length) {
      // Create a synthetic "all meals" adjustment for legacy overrides
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

    // Collect changes for this item's meal + any "__all__" adjustments
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
            servingDescription: change.newPortion || item.servingDescription,
            overridden: {
              originalServing: item.servingDescription,
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
            servingDescription: change.replacementPortion || item.servingDescription,
            overridden: {
              originalServing: `${item.foodName} (${item.servingDescription})`,
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

  // Now handle "add" changes — inject new items into the correct meal
  const addedItems: ResolvedItem[] = [];
  for (const [mealKey, adjs] of adjustmentsByMeal) {
    for (const { adj, overrideLabel, overrideColor } of adjs) {
      for (const change of adj.changes) {
        if (change.type === "add") {
          // Find the target meal name (use actual casing from items, or the adj mealName)
          const targetMeal = mealKey === "__all__"
            ? items[0]?.mealName ?? "Meal 1"
            : adj.mealName;

          addedItems.push({
            id: `added-${overrideLabel}-${change.food}-${Math.random().toString(36).slice(2, 6)}`,
            mealName: targetMeal,
            foodName: change.food,
            quantity: "",
            unit: "",
            servingDescription: change.newPortion || null,
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

  // Insert added items at end of their target meal
  const finalItems = [...resolvedItems];
  for (const added of addedItems) {
    const mealKey = added.mealName.toLowerCase().trim();
    const lastIdx = finalItems.findLastIndex((i) => i.mealName.toLowerCase().trim() === mealKey);
    if (lastIdx >= 0) {
      finalItems.splice(lastIdx + 1, 0, added);
    } else {
      finalItems.push(added);
    }
  }

  return { resolvedItems: finalItems, activeOverrides };
}

// ── Visual helpers ───────────────────────────────────────────────────────────

function getMealAccent(index: number) {
  const accents = [
    { border: "border-blue-500/20", badge: "bg-blue-500/10 text-blue-400" },
    { border: "border-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-400" },
    { border: "border-purple-500/20", badge: "bg-purple-500/10 text-purple-400" },
    { border: "border-amber-500/20", badge: "bg-amber-500/10 text-amber-400" },
    { border: "border-rose-500/20", badge: "bg-rose-500/10 text-rose-400" },
    { border: "border-teal-500/20", badge: "bg-teal-500/10 text-teal-400" },
  ];
  return accents[index % accents.length];
}

function getChangeTypeLabel(type: MealChange["type"]): string {
  switch (type) {
    case "update": return "Changed";
    case "add": return "Added";
    case "remove": return "Removed";
    case "replace": return "Replaced";
  }
}

// ── Extras sub-components ────────────────────────────────────────────────────

function ExtrasSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-white/[0.04] dark:bg-[#0a1224]">
      <div className="border-b border-zinc-100 px-5 py-3 dark:border-white/[0.04]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-gray-400">{title}</h3>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

function MetadataSection({ extras }: { extras: PlanExtras }) {
  const m = extras.metadata;
  if (!m) return null;
  const items = [
    m.phase && { label: "Phase", value: m.phase },
    m.startDate && { label: "Start Date", value: m.startDate },
    m.bodyweight && { label: "Weight", value: m.bodyweight },
  ].filter(Boolean) as { label: string; value: string }[];
  if (!items.length && !m.coachNotes && !m.highlightedChanges) return null;
  return (
    <ExtrasSection title="Plan Overview">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-2">
          {items.map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-white/[0.03]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
              <p className="text-sm font-medium text-zinc-800 dark:text-gray-200">{value}</p>
            </div>
          ))}
        </div>
      )}
      {m.highlightedChanges && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Changes</span>
          <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-300">{m.highlightedChanges}</p>
        </div>
      )}
      {m.coachNotes && <p className="mt-2 text-sm text-zinc-600 dark:text-gray-400">{m.coachNotes}</p>}
    </ExtrasSection>
  );
}

function SupplementsSection({ extras }: { extras: PlanExtras }) {
  if (!extras.supplements?.length) return null;
  const grouped = new Map<string, typeof extras.supplements>();
  for (const supp of extras.supplements!) {
    const key = supp.timing;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(supp);
  }
  const sortedTimings = [...grouped.keys()].sort((a, b) => {
    const ia = SUPPLEMENT_TIMING_ORDER.indexOf(a as typeof SUPPLEMENT_TIMING_ORDER[number]);
    const ib = SUPPLEMENT_TIMING_ORDER.indexOf(b as typeof SUPPLEMENT_TIMING_ORDER[number]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <ExtrasSection title="Supplements">
      <div className="space-y-3">
        {sortedTimings.map((timing) => (
          <div key={timing}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{timing}</span>
            <div className="mt-1 space-y-1">
              {grouped.get(timing)!.map((supp, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-white/[0.03]">
                  <span className="text-sm font-medium text-zinc-800 dark:text-gray-200">{supp.name}</span>
                  {supp.dosage && <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-white/[0.04] dark:text-gray-400">{supp.dosage}</span>}
                  {supp.notes && <span className="text-xs text-zinc-400">— {supp.notes}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ExtrasSection>
  );
}

function AllowancesSection({ extras }: { extras: PlanExtras }) {
  if (!extras.allowances?.length) return null;
  return (
    <ExtrasSection title="Approved Extras">
      <div className="space-y-3">
        {extras.allowances.map((allow, i) => (
          <div key={i}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{allow.category}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {allow.items.map((item, j) => (
                <span key={j} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/[0.04] dark:text-gray-400">{item}</span>
              ))}
            </div>
            {allow.restriction && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{allow.restriction}</p>}
          </div>
        ))}
      </div>
    </ExtrasSection>
  );
}

function RulesSection({ extras }: { extras: PlanExtras }) {
  if (!extras.rules?.length) return null;
  const grouped = new Map<string, string[]>();
  for (const rule of extras.rules) {
    const key = rule.category;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rule.text);
  }
  return (
    <ExtrasSection title="Rules & Guidelines">
      <div className="space-y-3">
        {[...grouped.entries()].map(([category, texts]) => (
          <div key={category}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{category}</span>
            <ul className="mt-1 space-y-1">
              {texts.map((text, i) => (<li key={i} className="text-sm text-zinc-700 dark:text-gray-300">{text}</li>))}
            </ul>
          </div>
        ))}
      </div>
    </ExtrasSection>
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
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200/80 bg-white p-1 dark:border-white/[0.04] dark:bg-[#0a1224]">
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
            className={`relative flex min-w-[44px] flex-1 flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-xs font-medium transition-all ${
              isSelected
                ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="font-bold">{day.slice(0, 3)}</span>
            {hasOverride && (
              <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? "bg-white dark:bg-zinc-900" : dotColor}`} />
            )}
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
    <div className="space-y-1.5">
      {overrides.map((o, i) => {
        const color = getOverrideColor(o.color);
        const mealCount = o.mealAdjustments?.length ?? 0;
        return (
          <div key={i} className={`rounded-xl border ${color.border} px-4 py-2.5`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${color.dot}`} />
              <span className={`text-[11px] font-bold ${color.text}`}>{o.label}</span>
              {mealCount > 0 && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {mealCount} {mealCount === 1 ? "meal" : "meals"} modified
                </span>
              )}
            </div>
            {o.notes && <p className={`mt-1 text-xs ${color.text} opacity-80`}>{o.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SimpleMealPlan({
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
    // Optimistic update
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
        // Revert
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
    <div className="space-y-4">
      {extras && <MetadataSection extras={extras} />}

      {/* Meal progress bar — only visible when viewing today's tab */}
      {adherence && isViewingToday && progressTotal > 0 && (
        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-4 py-3 dark:border-white/[0.04] dark:bg-white/[0.02]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Today&rsquo;s meals
            </span>
            <span className="text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
              {progressDone} / {progressTotal}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300 dark:bg-emerald-600"
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

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50 px-4 py-3 dark:border-white/[0.04] dark:bg-white/[0.02]">
        <span className="text-sm font-semibold text-zinc-700 dark:text-gray-200">
          {meals.length} {meals.length === 1 ? "meal" : "meals"}
        </span>
        <span className="h-4 w-px bg-zinc-200 dark:bg-white/[0.06]" />
        <span className="text-sm text-zinc-500 dark:text-gray-400">
          {resolvedItems.length} {resolvedItems.length === 1 ? "item" : "items"} total
        </span>
        {hasOverrides && (
          <>
            <span className="h-4 w-px bg-zinc-200 dark:bg-white/[0.06]" />
            <span className="text-xs text-zinc-400 dark:text-gray-500">Viewing: {selectedDay}</span>
          </>
        )}
        {mealPlan.publishedAt && (
          <>
            <span className="h-4 w-px bg-zinc-200 dark:bg-white/[0.06]" />
            <span className="text-xs text-zinc-400 dark:text-gray-500">
              Updated {mealPlan.publishedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </>
        )}
      </div>

      {/* Meal cards */}
      {meals.map(([mealName, items], mealIndex) => {
        const accent = getMealAccent(mealIndex);
        const overriddenItems = items.filter((i) => i.overridden);
        const hasOverriddenItems = overriddenItems.length > 0;
        const overrideLabels = [...new Set(overriddenItems.map((i) => i.overridden!.overrideLabel))];
        const isMealDone = isViewingToday ? completedMeals.has(mealName) : false;

        return (
          <div
            key={mealName}
            className={`group overflow-hidden rounded-2xl border bg-white transition-all hover:shadow-md dark:bg-[#0a1224] dark:hover:shadow-lg dark:hover:shadow-blue-500/[0.03] ${
              isMealDone
                ? "border-emerald-200 dark:border-emerald-900/40"
                : `${accent.border} dark:border-white/[0.04] dark:hover:border-white/[0.08]`
            }`}
          >
            {/* Meal header */}
            <div className={`flex items-center border-b border-zinc-100 dark:border-white/[0.04] ${isViewingToday ? "pl-1 pr-4 py-2" : "px-5 py-3.5"}`}>
              {/* Adherence checkbox — always show when adherence prop passed */}
              {isViewingToday && (
                <label
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg"
                  aria-label={`${mealName}: ${isMealDone ? "mark incomplete" : "mark complete"}`}
                >
                  <input
                    type="checkbox"
                    checked={isMealDone}
                    onChange={() => handleMealToggle(mealName, mealIndex)}
                    disabled={isPending}
                    className="h-[18px] w-[18px] cursor-pointer rounded border-2 border-zinc-300 accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-600"
                  />
                </label>
              )}
              <div className={`flex min-w-0 flex-1 items-center gap-2 ${adherence ? "" : ""}`}>
                <h3 className={`text-sm font-bold uppercase tracking-wider ${isMealDone ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-700 dark:text-gray-200"}`}>
                  {mealName}
                </h3>
                {isMealDone && (
                  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
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
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${accent.badge}`}>
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </div>

            {/* Food items */}
            <ul>
              {items.map((item, itemIndex) => {
                const color = item.overridden ? getOverrideColor(item.overridden.overrideColor) : null;
                const changeLabel = item.overridden ? getChangeTypeLabel(item.overridden.changeType) : null;

                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.02] ${
                      itemIndex < items.length - 1 ? "border-b border-zinc-50 dark:border-white/[0.02]" : ""
                    } ${color ? `${color.bg.replace("/15", "/5")}` : ""}`}
                  >
                    {/* Override indicator dot */}
                    {color && <span className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`} />}

                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-zinc-800 dark:text-gray-200">{item.foodName}</span>
                      {item.overridden && (
                        <p className={`mt-0.5 text-[11px] ${color?.text ?? "text-zinc-400"}`}>
                          {changeLabel}
                          {item.overridden.originalServing && ` from ${item.overridden.originalServing}`}
                          {" — "}
                          {item.overridden.overrideLabel}
                        </p>
                      )}
                    </div>

                    {/* Serving badge */}
                    {item.servingDescription && (
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        color
                          ? `${color.bg} ${color.text} ring-1 ${color.border}`
                          : "bg-zinc-100 text-zinc-500 dark:bg-white/[0.04] dark:text-gray-400"
                      }`}>
                        {item.servingDescription}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Extended sections — Rules first (most important for clients) */}
      {extras && (
        <>
          <RulesSection extras={extras} />
          <SupplementsSection extras={extras} />
          <AllowancesSection extras={extras} />
        </>
      )}

      {/* Day overrides reference (collapsed) */}
      {extras?.dayOverrides && extras.dayOverrides.length > 0 && (
        <details className="group rounded-2xl border border-zinc-200/80 bg-white dark:border-white/[0.04] dark:bg-[#0a1224]">
          <summary className="cursor-pointer px-5 py-3 text-xs font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            Day Override Reference
          </summary>
          <div className="space-y-2 px-5 pb-3">
            {extras.dayOverrides.map((override, i) => {
              const color = getOverrideColor(override.color);
              return (
                <div key={i} className={`rounded-lg border ${color.border} px-3 py-2.5`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                    <span className={`text-sm font-semibold ${color.text}`}>{override.label}</span>
                    {override.weekdays?.map((day) => (
                      <span key={day} className={`rounded-full ${color.bg} px-2 py-0.5 text-[10px] font-bold ${color.text}`}>{day}</span>
                    ))}
                  </div>
                  {/* New model: meal adjustments */}
                  {override.mealAdjustments?.map((adj, j) => (
                    <div key={j} className="mt-1.5 pl-3 border-l-2 border-zinc-200 dark:border-zinc-700">
                      <p className="text-xs font-semibold text-zinc-600 dark:text-gray-300">{adj.mealName}</p>
                      {adj.changes.map((ch, k) => (
                        <p key={k} className="text-xs text-zinc-500 dark:text-gray-400">
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
                  {/* Legacy model */}
                  {override.items?.map((item, j) => (
                    <p key={`leg-${j}`} className="mt-1 text-xs text-zinc-600 dark:text-gray-400">
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
