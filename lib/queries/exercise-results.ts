import { db } from "@/lib/db";
import { normalizeToMonday } from "@/lib/utils/date";

type ExerciseResultRow = {
  exerciseName: string;
  programDay: string;
  weight: number;
  reps: number;
  weekOf: Date;
};

/**
 * Get all exercise results for a client for a specific week.
 * Returns a Map keyed by "programDay::exerciseName" for fast lookup.
 */
export async function getExerciseResultsForWeek(
  clientId: string,
  weekOf: Date
): Promise<Map<string, ExerciseResultRow>> {
  const monday = normalizeToMonday(weekOf);
  const results = await db.exerciseResult.findMany({
    where: { clientId, weekOf: monday },
  });
  const map = new Map<string, ExerciseResultRow>();
  for (const r of results) {
    map.set(`${r.programDay}::${r.exerciseName}`, {
      exerciseName: r.exerciseName,
      programDay: r.programDay,
      weight: r.weight,
      reps: r.reps,
      weekOf: r.weekOf,
    });
  }
  return map;
}

/**
 * Get the previous week's exercise results for a client.
 */
export async function getPreviousExerciseResults(
  clientId: string,
  currentWeekOf: Date
): Promise<Map<string, ExerciseResultRow>> {
  const currentMonday = normalizeToMonday(currentWeekOf);
  const prevMonday = new Date(currentMonday);
  prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
  return getExerciseResultsForWeek(clientId, prevMonday);
}

/**
 * Coach view: get the last N weeks of exercise results for a client,
 * grouped by exercise, ordered newest-first.
 */
export async function getRecentExerciseProgress(
  clientId: string,
  weeks = 6
): Promise<ExerciseResultRow[]> {
  const now = normalizeToMonday(new Date());
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);

  return db.exerciseResult.findMany({
    where: {
      clientId,
      weekOf: { gte: cutoff },
    },
    orderBy: [
      { programDay: "asc" },
      { exerciseName: "asc" },
      { weekOf: "desc" },
    ],
  });
}
