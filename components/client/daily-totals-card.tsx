/**
 * T-802 §2.2 — the one daily totals card, shared by both plan bodies. Source
 * differs by caller: the macro body sums `macroTargets`, the foods body sums
 * the day-resolved items (so an override that swaps a food changes the
 * totals) — the caller decides the source and the label, this component only
 * renders.
 *
 * `MacroStackedBar` and `macroSplit` moved here verbatim from
 * `macro-plan-view.tsx` (protein/carbs ×4, fats ×9 — not re-derived).
 *
 * Number formatting (T-802a review r2, parity item 5; rationale corrected in
 * review r3, NIT 5): on web `MealPlanItem.calories/protein/carbs/fats` are
 * Prisma `Int` columns (`prisma/schema.prisma`), so a summed total is always
 * a whole number here — the float-sum artifact (e.g. `1234.5000000000002`)
 * is an iOS-side concern (`MealPlanItemDetail` macros are `Double?`).
 * `Math.round` is kept anyway for cross-platform parity with iOS's formatter,
 * then thousands-separated with `toLocaleString("en-US")`, matching T-802
 * §2.2's mockup ("2,340"). One rule, applied to every calorie/macro number on
 * the client meal-plan screen — daily totals AND per-meal cards (T-802's
 * 2026-09-18 "degraded hint + number formatting" decision). T-802b must match
 * it.
 */

type Totals = { calories: number; protein: number; carbs: number; fats: number };

/** Round to the nearest integer and thousands-separate (en-US). The one
 *  formatting rule for every number on this card. */
export function formatTotal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Proportional macro split by calories (protein/carbs = 4 cal/g, fat = 9 cal/g). */
export function macroSplit(m: { protein: number; carbs: number; fats: number }) {
  const p = m.protein * 4, c = m.carbs * 4, f = m.fats * 9;
  const total = p + c + f;
  if (total === 0) return { p: 0, c: 0, f: 0 };
  return { p: (p / total) * 100, c: (c / total) * 100, f: (f / total) * 100 };
}

export function MacroStackedBar({ target }: { target: { protein: number; carbs: number; fats: number } }) {
  const split = macroSplit(target);
  const hasAny = target.protein + target.carbs + target.fats > 0;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      {hasAny ? (
        <>
          <div className="bg-emerald-500/80" style={{ width: `${split.p}%` }} />
          <div className="bg-amber-500/80" style={{ width: `${split.c}%` }} />
          <div className="bg-rose-500/80" style={{ width: `${split.f}%` }} />
        </>
      ) : null}
    </div>
  );
}

/** Hidden when all four totals are 0 — many foods plans carry no macro data
 *  at all, and a card of zeros reads like a plan of zeros (T-802 §2.2). */
export function DailyTotalsCard({ label, totals }: { label: string; totals: Totals }) {
  if (totals.calories === 0 && totals.protein === 0 && totals.carbs === 0 && totals.fats === 0) return null;

  return (
    <div className="sf-glass-card p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-black tabular-nums text-white">{formatTotal(totals.calories)}</span>
        <span className="text-sm font-semibold text-zinc-500">calories</span>
      </div>
      <div className="mt-3">
        <MacroStackedBar target={totals} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-base font-bold tabular-nums text-emerald-400">{formatTotal(totals.protein)}g</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Protein</p>
        </div>
        <div>
          <p className="text-base font-bold tabular-nums text-amber-400">{formatTotal(totals.carbs)}g</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Carbs</p>
        </div>
        <div>
          <p className="text-base font-bold tabular-nums text-rose-400">{formatTotal(totals.fats)}g</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Fats</p>
        </div>
      </div>
    </div>
  );
}
