export type MealPlanFoodItem = {
  id: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
};

export type MealGroup = {
  mealName: string;
  items: MealPlanFoodItem[];
};

export type FoodLibraryEntry = {
  id: string;
  name: string;
  defaultUnit: string;
};

// ── Macro-only plans (MealMacroTarget) ────────────────────────────────────────

export type MacroMealTarget = {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
};

/** Local editor row — same shape as MacroMealTarget plus a stable client-side id for React keys. */
export type EditableMacroMeal = MacroMealTarget & { id: string };

export function macroTargetsToEditable(targets: MacroMealTarget[]): EditableMacroMeal[] {
  return targets.map((t) => ({ ...t, id: crypto.randomUUID() }));
}

export function flattenMacroMeals(
  meals: EditableMacroMeal[]
): { mealName: string; sortOrder: number; calories: number; protein: number; carbs: number; fats: number }[] {
  return meals.map((meal, i) => ({
    mealName: meal.mealName,
    sortOrder: i,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fats: meal.fats,
  }));
}

export function groupItemsToMeals(
  items: {
    mealName: string;
    foodName: string;
    quantity: string;
    unit: string;
    servingDescription?: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  }[]
): MealGroup[] {
  const map = new Map<string, MealPlanFoodItem[]>();
  for (const item of items) {
    const key = item.mealName || "Untitled Meal";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({
      id: crypto.randomUUID(),
      foodName: item.foodName,
      quantity: item.quantity,
      unit: item.unit,
      servingDescription: item.servingDescription
        || (item.quantity && item.unit ? `${item.quantity} ${item.unit}`.trim() : item.quantity || item.unit || ""),
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fats: item.fats,
    });
  }
  return Array.from(map, ([mealName, items]) => ({ mealName, items }));
}

export function flattenMeals(
  meals: MealGroup[]
): {
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription?: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  sortOrder: number;
}[] {
  let sort = 0;
  return meals.flatMap((meal) =>
    meal.items.map((item) => ({
      mealName: meal.mealName,
      foodName: item.foodName,
      quantity: item.quantity,
      unit: item.unit,
      servingDescription: item.servingDescription || undefined,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fats: item.fats,
      sortOrder: sort++,
    }))
  );
}
