import { useId } from "react";
import type { PlanPayload } from "@/lib/ai-coach/plan-contract";
import { getExerciseItem, getFoodItem } from "@/lib/ai-coach/catalog/loader";

export function PlanDisplay({ plan }: { plan: PlanPayload }) {
  const nutritionHeading = useId();
  const totals = new Map<string, { grams: number; state: string; name: string }>();
  for (const day of plan.meals?.days ?? []) for (const meal of day.meals) for (const ingredient of meal.ingredients) {
    const food = getFoodItem(ingredient.foodId, ingredient.catalogVersion);
    const prior = totals.get(ingredient.foodId);
    totals.set(ingredient.foodId, { grams: (prior?.grams ?? 0) + ingredient.grams, state: ingredient.state, name: food.success ? food.item.name : ingredient.foodId });
  }
  return <div className="space-y-6">
    <section className="sf-glass-card rounded-2xl border border-white/10 p-5" aria-labelledby={nutritionHeading}>
      <h2 id={nutritionHeading} className="text-xl font-semibold text-zinc-100">Nutrition</h2>
      {plan.nutrition ? <>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(plan.nutrition.targets).map(([key, value]) => <div key={key}><dt className="text-sm text-zinc-400">{{ energyKcal: "Energy", proteinG: "Protein", carbsG: "Carbohydrates", fatG: "Fat" }[key]}</dt><dd className="mt-1 text-xl text-zinc-100">{value} <span className="text-sm text-zinc-400">{key === "energyKcal" ? "kcal/day" : "g/day"}</span></dd></div>)}
        </dl><p className="mt-3 text-sm text-zinc-400">Fixture tolerance: ±{plan.nutrition.tolerancePercent}%. These values are not live dietary advice.</p>
        {plan.nutrition.assumptions.map(text => <p key={text} className="mt-2 text-sm text-zinc-400">{text}</p>)}
      </> : <p className="mt-3 text-zinc-400">Nutrition is unavailable or paused. No target has been assigned.</p>}
      {plan.meals?.days.map(day => <details key={day.day} className="mt-3 rounded-xl border border-white/10"><summary className="min-h-12 cursor-pointer p-3 text-zinc-100">Day {day.day} meals</summary><div className="space-y-4 px-3 pb-3">{day.meals.map(meal => <div key={meal.id}><h3 className="font-medium text-zinc-100">{meal.name}</h3><ul className="mt-2 space-y-1 text-sm text-zinc-300">{meal.ingredients.map(food => <li key={food.foodId}>{food.grams} g · {food.foodId.replaceAll("-", " ")} ({food.state.toLowerCase().replaceAll("_", " ")})</li>)}</ul><p className="mt-2 text-sm text-zinc-400">{meal.preparation}</p></div>)}</div></details>)}
      {totals.size > 0 && <details className="mt-4"><summary className="min-h-12 cursor-pointer py-3 text-zinc-100">Weekly ingredient quantities</summary><p className="mb-3 text-sm text-zinc-400">Consumed/prepared quantities. Purchase weights and cooking yields are not established by this fixture catalog.</p><ul className="space-y-2 text-zinc-300">{Array.from(totals.entries()).map(([id, item]) => <li key={id}>{item.name}: {Math.round(item.grams)} g ({item.state.toLowerCase()})</li>)}</ul></details>}
    </section>
    <section className="sf-glass-card rounded-2xl border border-white/10 p-5"><h2 className="text-xl font-semibold text-zinc-100">Strength</h2>{plan.strength.length ? plan.strength.map(session => <div key={session.sessionId} className="mt-4 border-t border-white/10 pt-4"><h3 className="font-medium text-zinc-100">Day {session.day}</h3>{session.exercises.map(exercise => { const entry = getExerciseItem(exercise.exerciseId, exercise.catalogVersion); return <div key={exercise.exerciseId} className="mt-2 text-zinc-300"><p>{entry.success ? entry.item.name : exercise.exerciseId} · {exercise.sets} sets × {exercise.reps} reps</p><p className="mt-1 text-sm text-zinc-400">Rest {exercise.restSeconds} seconds. {exercise.effort}</p></div>; })}</div>) : <p className="mt-3 text-zinc-400">Strength training is unavailable or paused.</p>}</section>
    <section className="sf-glass-card rounded-2xl border border-white/10 p-5"><h2 className="text-xl font-semibold text-zinc-100">Cardio</h2>{plan.cardio.length ? plan.cardio.map(session => <div key={session.sessionId} className="mt-4 text-zinc-300"><p>Day {session.day} · {session.exerciseId.replaceAll("-", " ")} · {session.durationMinutes} minutes</p><p className="mt-1 text-sm text-zinc-400">{session.intensity}</p></div>) : <p className="mt-3 text-zinc-400">Cardio is unavailable or paused.</p>}</section>
  </div>;
}
