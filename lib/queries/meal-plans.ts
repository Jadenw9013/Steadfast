import { db } from "@/lib/db";
import { parsePlanExtras, type PlanExtras } from "@/types/meal-plan-extras";
import { resolveDefaultPlanMode, resolveEditorPlanMode } from "@/lib/meal-plans/plan-mode";

export async function getCurrentPublishedMealPlan(clientId: string, publishedAfter?: Date) {
  return db.mealPlan.findFirst({
    where: { clientId, status: "PUBLISHED", ...(publishedAfter ? { publishedAt: { gte: publishedAfter } } : {}) },
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
  /** The client's persistent default (`CoachClient.planMode`). */
  clientPlanMode: "MEAL_PLAN" | "MACROS";
  /** The one mode the coach's editor renders: `draft?.planMode ?? clientPlanMode`.
   *  There is deliberately no `planMode` field on this type — the plan row's own
   *  mode is a client-facing snapshot and must never drive the editor (T-102a). */
  editorMode: "MEAL_PLAN" | "MACROS";
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

/**
 * Object argument, not positionals: `coachId` and `clientId` are both `string`,
 * so a silent swap would compile (T-102a).
 */
export async function getEffectiveMealPlanForReview(args: {
  coachId: string;
  clientId: string;
  weekOf: Date;
}): Promise<EffectiveMealPlan> {
  const { coachId, clientId, weekOf } = args;
  const include = {
    items: { orderBy: { sortOrder: "asc" as const } },
    macroTargets: { orderBy: { sortOrder: "asc" as const } },
  };

  // All three reads in parallel — the CoachClient.planMode read adds no latency.
  const [draft, published, clientPlanMode] = await Promise.all([
    // 1. Check for existing draft for this week
    db.mealPlan.findFirst({
      where: { clientId, weekOf, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      include,
    }),
    // Also find latest published plan (used for export + fallback).
    // Deliberately unscoped by week — that defect is T-733, not this ticket.
    db.mealPlan.findFirst({
      where: { clientId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      include,
    }),
    resolveDefaultPlanMode(coachId, clientId),
  ]);

  // Computed from the DRAFT only — never from `published`. See lib/meal-plans/plan-mode.ts.
  const editorMode = resolveEditorPlanMode(draft?.planMode ?? null, clientPlanMode);

  if (draft) {
    return {
      source: "draft",
      draftId: draft.id,
      publishedId: published?.id ?? null,
      clientPlanMode,
      editorMode,
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
      clientPlanMode,
      editorMode,
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
    clientPlanMode,
    editorMode,
    planExtras: null,
    supportContent: null,
    items: [],
    macroTargets: [],
  };
}
