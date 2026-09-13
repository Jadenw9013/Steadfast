import { db } from "@/lib/db";
import { parsePlanExtras, type PlanExtras } from "@/types/meal-plan-extras";

export async function getCurrentPublishedMealPlan(clientId: string) {
  return db.mealPlan.findFirst({
    where: { clientId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      macroTargets: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getMealPlanHistory(clientId: string) {
  return db.mealPlan.findMany({
    where: { clientId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      weekOf: true,
      version: true,
      publishedAt: true,
    },
  });
}

export async function getDraftMealPlan(clientId: string, weekOf: Date) {
  return db.mealPlan.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      macroTargets: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getMealPlanById(id: string) {
  return db.mealPlan.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      macroTargets: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export type EffectiveMealPlan = {
  source: "draft" | "published" | "empty";
  draftId: string | null;
  publishedId: string | null;
  planMode: "MEAL_PLAN" | "MACROS";
  planExtras: PlanExtras | null;
  supportContent: string | null;
  items: {
    mealName: string;
    foodName: string;
    quantity: string;
    unit: string;
    servingDescription: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  }[];
  macroTargets: {
    mealName: string;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  }[];
};

function mapItems(items: {
  mealName: string;
  foodName: string;
  quantity: string;
  unit: string;
  servingDescription: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}[]) {
  return items.map((item) => ({
    mealName: item.mealName,
    foodName: item.foodName,
    quantity: item.quantity,
    unit: item.unit,
    servingDescription: item.servingDescription,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fats: item.fats,
  }));
}

function mapMacroTargets(targets: {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}[]) {
  return targets.map((t) => ({
    mealName: t.mealName,
    calories: t.calories,
    protein: t.protein,
    carbs: t.carbs,
    fats: t.fats,
  }));
}

export async function getEffectiveMealPlanForReview(
  clientId: string,
  weekOf: Date
): Promise<EffectiveMealPlan> {
  const include = {
    items: { orderBy: { sortOrder: "asc" as const } },
    macroTargets: { orderBy: { sortOrder: "asc" as const } },
  };

  // 1. Check for existing draft for this week
  const draft = await db.mealPlan.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    include,
  });

  // Also find latest published plan (used for export + fallback)
  const published = await db.mealPlan.findFirst({
    where: { clientId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    include,
  });

  if (draft) {
    return {
      source: "draft",
      draftId: draft.id,
      publishedId: published?.id ?? null,
      planMode: draft.planMode,
      planExtras: parsePlanExtras(draft.planExtras),
      supportContent: draft.supportContent,
      items: mapItems(draft.items),
      macroTargets: mapMacroTargets(draft.macroTargets),
    };
  }

  if (published) {
    return {
      source: "published",
      draftId: null,
      publishedId: published.id,
      planMode: published.planMode,
      planExtras: parsePlanExtras(published.planExtras),
      supportContent: published.supportContent,
      items: mapItems(published.items),
      macroTargets: mapMacroTargets(published.macroTargets),
    };
  }

  // 3. No plan at all
  return {
    source: "empty",
    draftId: null,
    publishedId: null,
    planMode: "MEAL_PLAN",
    planExtras: null,
    supportContent: null,
    items: [],
    macroTargets: [],
  };
}
