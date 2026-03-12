/**
 * Diff two meal plans to produce human-readable change descriptions.
 *
 * Compares MealGroup arrays + PlanExtras and returns structured change entries
 * for the preview UI.
 */

import type { MealGroup } from "@/types/meal-plan";
import type { PlanExtras } from "@/types/meal-plan-extras";

export type ChangeEntry = {
  type: "added" | "removed" | "modified" | "info";
  category: "meal" | "item" | "supplement" | "override" | "rule" | "allowance" | "meta";
  label: string;
  detail?: string;
};

export function diffMealPlans(
  before: MealGroup[],
  after: MealGroup[],
  extrasBefore: PlanExtras | null,
  extrasAfter: PlanExtras | null
): ChangeEntry[] {
  const changes: ChangeEntry[] = [];

  // --- Meal-level changes ---
  const beforeNames = new Set(before.map((m) => m.mealName));
  const afterNames = new Set(after.map((m) => m.mealName));

  // New meals
  for (const meal of after) {
    if (!beforeNames.has(meal.mealName)) {
      changes.push({
        type: "added",
        category: "meal",
        label: `New meal: ${meal.mealName}`,
        detail: `${meal.items.length} item${meal.items.length !== 1 ? "s" : ""}`,
      });
    }
  }

  // Removed meals
  for (const meal of before) {
    if (!afterNames.has(meal.mealName)) {
      changes.push({
        type: "removed",
        category: "meal",
        label: `Removed: ${meal.mealName}`,
      });
    }
  }

  // Item-level changes within shared meals
  for (const afterMeal of after) {
    const beforeMeal = before.find((m) => m.mealName === afterMeal.mealName);
    if (!beforeMeal) continue; // Already handled as new meal

    const beforeFoods = new Map(
      beforeMeal.items.map((i) => [i.foodName.toLowerCase(), i])
    );
    const afterFoods = new Map(
      afterMeal.items.map((i) => [i.foodName.toLowerCase(), i])
    );

    // Added items
    for (const [key, item] of afterFoods) {
      if (!beforeFoods.has(key)) {
        changes.push({
          type: "added",
          category: "item",
          label: `${afterMeal.mealName}: + ${item.foodName}`,
          detail: item.servingDescription || undefined,
        });
      }
    }

    // Removed items
    for (const [key, item] of beforeFoods) {
      if (!afterFoods.has(key)) {
        changes.push({
          type: "removed",
          category: "item",
          label: `${afterMeal.mealName}: − ${item.foodName}`,
        });
      }
    }

    // Modified items (portion changed)
    for (const [key, afterItem] of afterFoods) {
      const beforeItem = beforeFoods.get(key);
      if (!beforeItem) continue;

      const beforePortion = beforeItem.servingDescription || `${beforeItem.quantity} ${beforeItem.unit}`;
      const afterPortion = afterItem.servingDescription || `${afterItem.quantity} ${afterItem.unit}`;

      if (beforePortion !== afterPortion) {
        changes.push({
          type: "modified",
          category: "item",
          label: `${afterMeal.mealName}: ${afterItem.foodName}`,
          detail: `${beforePortion} → ${afterPortion}`,
        });
      }
    }
  }

  // --- Extras changes ---

  // Day overrides
  const beforeOverrides = extrasBefore?.dayOverrides ?? [];
  const afterOverrides = extrasAfter?.dayOverrides ?? [];
  const beforeOverrideLabels = new Set(beforeOverrides.map((o) => o.label));

  for (const override of afterOverrides) {
    if (!beforeOverrideLabels.has(override.label)) {
      changes.push({
        type: "added",
        category: "override",
        label: `Day override: ${override.label}`,
        detail: override.weekdays?.join(", ") ?? undefined,
      });
    }
  }

  // Supplements
  const beforeSupps = new Set(
    (extrasBefore?.supplements ?? []).map((s) => s.name.toLowerCase())
  );
  for (const supp of extrasAfter?.supplements ?? []) {
    if (!beforeSupps.has(supp.name.toLowerCase())) {
      changes.push({
        type: "added",
        category: "supplement",
        label: `Supplement: ${supp.name}`,
        detail: [supp.dosage, supp.timing].filter(Boolean).join(" · ") || undefined,
      });
    }
  }

  // Removed supplements
  const afterSupps = new Set(
    (extrasAfter?.supplements ?? []).map((s) => s.name.toLowerCase())
  );
  for (const supp of extrasBefore?.supplements ?? []) {
    if (!afterSupps.has(supp.name.toLowerCase())) {
      changes.push({
        type: "removed",
        category: "supplement",
        label: `Supplement: ${supp.name}`,
      });
    }
  }

  // Rules
  const beforeRules = new Set(
    (extrasBefore?.rules ?? []).map((r) => r.text.toLowerCase())
  );
  for (const rule of extrasAfter?.rules ?? []) {
    if (!beforeRules.has(rule.text.toLowerCase())) {
      changes.push({
        type: "added",
        category: "rule",
        label: `Rule: ${rule.text}`,
        detail: rule.category,
      });
    }
  }

  // Highlighted changes from metadata
  if (extrasAfter?.metadata?.highlightedChanges) {
    changes.push({
      type: "info",
      category: "meta",
      label: extrasAfter.metadata.highlightedChanges,
    });
  }

  return changes;
}
