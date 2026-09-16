import { db } from "@/lib/db";

/** True if coach has enabled daily adherence tracking for this client. */
export async function getAdherenceEnabled(clientId: string): Promise<boolean> {
  const assignment = await db.coachClient.findFirst({
    where: { clientId },
    select: { adherenceEnabled: true },
  });
  return assignment?.adherenceEnabled ?? false;
}

export type TodayAdherenceData = {
  id: string;
  workoutCompleted: boolean;
  workoutCompletedAt: string | null;
  meals: {
    mealNameSnapshot: string;
    displayOrder: number;
    completed: boolean;
    completedAt: string | null;
  }[];
  exercises: {
    dayLabel: string;
    exerciseName: string;
    exerciseOrder: number;
    completed: boolean;
  }[];
} | null;

/** Get today's adherence record for a client (or null if none exists yet). */
export async function getTodayAdherence(
  clientId: string,
  date: string
): Promise<TodayAdherenceData> {
  const record = await db.dailyAdherence.findUnique({
    where: { clientId_date: { clientId, date } },
    include: {
      meals: { orderBy: { displayOrder: "asc" } },
      exercises: { orderBy: { exerciseOrder: "asc" } },
    },
  });
  if (!record) return null;
  return {
    id: record.id,
    workoutCompleted: record.workoutCompleted,
    workoutCompletedAt: record.workoutCompletedAt?.toISOString() ?? null,
    meals: record.meals.map((m) => ({
      mealNameSnapshot: m.mealNameSnapshot,
      displayOrder: m.displayOrder,
      completed: m.completed,
      completedAt: m.completedAt?.toISOString() ?? null,
    })),
    exercises: record.exercises.map((e) => ({
      dayLabel: e.dayLabel,
      exerciseName: e.exerciseName,
      exerciseOrder: e.exerciseOrder,
      completed: e.completed,
    })),
  };
}

export type AdherenceDaySummary = {
  date: string;
  mealsCompleted: number;
  mealsTotal: number;
  workoutCompleted: boolean;
  // CB08: whether a DailyAdherence record exists for this date at all. An
  // untracked day is not verified nonadherence — the client may have been
  // fine and simply not opened the checkoff UI. Callers must not treat
  // `tracked: false` the same as a recorded zero/incomplete day.
  tracked: boolean;
};

export type AdherenceSummary = {
  today: AdherenceDaySummary;
  last7Days: AdherenceDaySummary[];
};

/**
 * Get adherence summary for the last N days (including today) for coach view.
 * mealsTotalPerDay is derived from each day's checkoff records (not from
 * the live plan) so the numbers always reflect what was actually presented.
 */
export async function getAdherenceSummary(
  clientId: string,
  todayDate: string,
  days = 7
): Promise<AdherenceSummary> {
  // Build last `days` date strings YYYY-MM-DD
  const dates: string[] = [];
  const base = new Date(todayDate + "T00:00:00Z");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  const records = await db.dailyAdherence.findMany({
    where: { clientId, date: { in: dates } },
    include: { meals: true },
  });

  const byDate = new Map(records.map((r) => [r.date, r]));

  const summarize = (date: string): AdherenceDaySummary => {
    const r = byDate.get(date);
    if (!r) return { date, mealsCompleted: 0, mealsTotal: 0, workoutCompleted: false, tracked: false };
    const total = r.meals.length;
    const completed = r.meals.filter((m) => m.completed).length;
    return { date, mealsCompleted: completed, mealsTotal: total, workoutCompleted: r.workoutCompleted, tracked: true };
  };

  return {
    today: summarize(todayDate),
    last7Days: dates.map(summarize),
  };
}

/** Get CoachClient record ID for a client (needed for toggle action). */
export async function getCoachClientForAdherence(coachId: string, clientId: string) {
  return db.coachClient.findUnique({
    where: { coachId_clientId: { coachId, clientId } },
    select: { id: true, adherenceEnabled: true },
  });
}

/**
 * Derive "today's meal names" from the currently published meal plan.
 *
 * Mode-gated (T-101). `items` and `macroTargets` now coexist on every version
 * — carry-forward keeps both representations so switching modes is reversible
 * — so "which array is non-empty" is not a usable signal. A MACROS plan
 * routinely carries the previous foods plan's items, and deriving the
 * checklist from those would write `mealNameSnapshot` rows for meals the
 * client is never shown: the macro-mode UI
 * (`components/client/macro-plan-view.tsx`) builds its own checklist from the
 * macro targets and calls `toggleMealCheckoff` with THOSE names, so the two
 * lists would persist two disjoint sets of checkoffs for the same day. Pick by
 * `planMode`, exactly as the client view does.
 */
export async function getTodayMealNames(clientId: string): Promise<{ mealName: string; order: number }[]> {
  const plan = await db.mealPlan.findFirst({
    where: { clientId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    select: {
      planMode: true,
      items: { orderBy: { sortOrder: "asc" }, select: { mealName: true, sortOrder: true } },
      macroTargets: { orderBy: { sortOrder: "asc" }, select: { mealName: true, sortOrder: true } },
    },
  });
  if (!plan) return [];
  const rows = plan.planMode === "MACROS" ? plan.macroTargets : plan.items;
  // Deduplicate by mealName preserving first-seen sortOrder
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!seen.has(row.mealName)) seen.set(row.mealName, row.sortOrder);
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([mealName, order]) => ({ mealName, order }));
}
