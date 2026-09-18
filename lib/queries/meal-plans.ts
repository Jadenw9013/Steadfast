import { db } from "@/lib/db";
import { parsePlanExtras, type PlanExtras } from "@/types/meal-plan-extras";
import { resolveDefaultPlanMode } from "@/lib/meal-plans/macro-targets";
import { isMislabeledMacroPlan } from "@/lib/meal-plans/display-mode";
import { resolveEditorPlanMode } from "@/lib/meal-plans/plan-mode";

export async function getCurrentPublishedMealPlan(clientId: string) {
  const plan = await db.mealPlan.findFirst({
    where: { clientId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      macroTargets: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (
    plan &&
    isMislabeledMacroPlan(plan.planMode, { items: plan.items.length, macroTargets: plan.macroTargets.length })
  ) {
    console.warn("[meal-plan] mislabeled MACROS plan rendered as MEAL_PLAN", {
      mealPlanId: plan.id,
      items: plan.items.length,
      macroTargets: plan.macroTargets.length,
    });
  }

  return plan;
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
  /** CoachClient's persistent default — never the published row's mode. */
  clientPlanMode: "MEAL_PLAN" | "MACROS";
  /** The mode the editor should actually render: the draft's mode if a draft
   *  exists, else the client default. Never the published row's mode. */
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

  // 1. Check for existing draft for this week, latest published plan (used
  // for export + fallback), and the client's persistent default mode — all
  // in parallel, no network I/O dependency between them.
  const [draft, published, clientPlanMode] = await Promise.all([
    db.mealPlan.findFirst({
      where: { clientId, weekOf, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      include,
    }),
    db.mealPlan.findFirst({
      where: { clientId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      include,
    }),
    resolveDefaultPlanMode(coachId, clientId),
  ]);

  // The draft's mode wins over the client default; the published row's mode
  // is never used as the *rule* to decide which editor renders (T-800 —
  // that's what let a stale CoachClient default silently flip the editor on
  // the next publish). Shared with the REST GET route via
  // lib/meal-plans/plan-mode.ts so the two coach-facing readers cannot
  // disagree (code-review r1 MAJOR-1). Server-resolved
  // `draft?.planMode ?? clientPlanMode` — never inferred from the published
  // row's content (round-2 adjudication: a content-based fallback here makes
  // the Plan Type toggle unreachable for most clients, see
  // board/tickets/T-800.md "## Decision").
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
