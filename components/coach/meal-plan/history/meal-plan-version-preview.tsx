import { groupItemsToMeals } from "@/types/meal-plan";
import type { MealPlanVersionDetail } from "@/lib/meal-plans/history";

/**
 * T-801 — read-only preview of a single meal plan version. Branches on
 * `planMode`, never on which array is non-empty: since T-101 a MACROS version
 * routinely also carries the previous week's foods (see the history service
 * header and spec Risk 7). No editor component is mounted here.
 */
export function MealPlanVersionPreview({ detail }: { detail: MealPlanVersionDetail }) {
  const extras = detail.planExtras;
  const hasExtras =
    extras !== null && extras !== undefined && !(typeof extras === "object" && Object.keys(extras as object).length === 0);

  return (
    <div className="space-y-4">
      {detail.planMode === "MACROS" ? (
        <MacroTargetsTable macroTargets={detail.macroTargets} />
      ) : (
        <FoodsPreview items={detail.items} />
      )}

      {detail.supportContent && detail.supportContent.trim().length > 0 && (
        <div className="sf-glass-card p-5">
          <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
            Guidance &amp; Support
          </h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300/90">
            {detail.supportContent}
          </div>
        </div>
      )}

      {hasExtras && (
        <div className="sf-glass-card p-5">
          <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
            Plan Extras
          </h3>
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
            {JSON.stringify(extras, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function FoodsPreview({ items }: { items: MealPlanVersionDetail["items"] }) {
  if (items.length === 0) {
    return (
      <div className="sf-glass-card p-8 text-center">
        <p className="text-sm text-zinc-400">This version has no food items.</p>
      </div>
    );
  }

  const meals = groupItemsToMeals(items);

  return (
    <div className="space-y-3">
      {meals.map((meal) => (
        <div key={meal.mealName} className="sf-glass-card p-5">
          <h3 className="mb-3 text-sm font-bold text-white">{meal.mealName}</h3>
          <ul className="space-y-2">
            {meal.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-zinc-200">{item.foodName}</p>
                  <p className="text-xs text-zinc-500">{item.servingDescription}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-zinc-400">
                  <span className="font-semibold text-white">{item.calories}</span> cal
                  {" · "}
                  {item.protein}p / {item.carbs}c / {item.fats}f
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MacroTargetsTable({ macroTargets }: { macroTargets: MealPlanVersionDetail["macroTargets"] }) {
  if (macroTargets.length === 0) {
    return (
      <div className="sf-glass-card p-8 text-center">
        <p className="text-sm text-zinc-400">This version has no macro targets.</p>
      </div>
    );
  }

  return (
    <div className="sf-glass-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.08] text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-4 py-3 font-semibold">Meal</th>
            <th className="px-4 py-3 font-semibold">Calories</th>
            <th className="px-4 py-3 font-semibold">Protein</th>
            <th className="px-4 py-3 font-semibold">Carbs</th>
            <th className="px-4 py-3 font-semibold">Fats</th>
          </tr>
        </thead>
        <tbody>
          {macroTargets.map((target) => (
            <tr key={target.id} className="border-b border-white/[0.04] last:border-0">
              <td className="px-4 py-3 font-medium text-white">{target.mealName}</td>
              <td className="px-4 py-3 text-zinc-300">{target.calories}</td>
              <td className="px-4 py-3 text-emerald-400">{target.protein}g</td>
              <td className="px-4 py-3 text-amber-400">{target.carbs}g</td>
              <td className="px-4 py-3 text-rose-400">{target.fats}g</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
