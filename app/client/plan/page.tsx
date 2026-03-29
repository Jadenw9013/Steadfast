import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { getTodayAdherence } from "@/lib/queries/adherence";
import { getExerciseResultsForWeek, getPreviousExerciseResults } from "@/lib/queries/exercise-results";
import { getLocalDate, normalizeToMonday } from "@/lib/utils/date";
import { SimpleMealPlan } from "@/components/client/simple-meal-plan";
import { TrainingProgram } from "@/components/client/training-program";
import { PlanTab } from "@/components/client/plan-tab";

export default async function ClientPlanPage() {
  const user = await getCurrentDbUser();
  const tz = user.timezone || "America/New_York";
  const todayDate = getLocalDate(new Date(), tz);
  const weekOf = normalizeToMonday(new Date());

  const [mealPlan, trainingProgram, todayAdherence, currentResults, previousResults] = await Promise.all([
    getCurrentPublishedMealPlan(user.id),
    getPublishedTrainingProgram(user.id),
    getTodayAdherence(user.id, todayDate),
    getExerciseResultsForWeek(user.id, weekOf),
    getPreviousExerciseResults(user.id, weekOf),
  ]);

  // Serialize Maps to plain Records for TrainingProgram client component
  const currentWeek: Record<string, { exerciseName: string; programDay: string; weight: number; reps: number }> = {};
  for (const [key, val] of currentResults) {
    currentWeek[key] = { exerciseName: val.exerciseName, programDay: val.programDay, weight: val.weight, reps: val.reps };
  }
  const previousWeek: Record<string, { exerciseName: string; programDay: string; weight: number; reps: number }> = {};
  for (const [key, val] of previousResults) {
    previousWeek[key] = { exerciseName: val.exerciseName, programDay: val.programDay, weight: val.weight, reps: val.reps };
  }

  const todayWeekday = new Date(todayDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long" });

  // Extract cardio from training program (__CARDIO__ day)
  const cardioDay = trainingProgram?.days?.find((d) => d.dayName === "__CARDIO__");
  const cardioBlock = cardioDay?.blocks?.[0];
  const cardioPrescription = cardioBlock
    ? (() => {
        const [modality = "", frequency = "", duration = "", intensity = ""] = (cardioBlock.title ?? "").split("|");
        return modality || frequency || duration || intensity
          ? { modality: modality.trim(), frequency: frequency.trim(), duration: duration.trim(), intensity: intensity.trim(), notes: cardioBlock.content ?? "" }
          : null;
      })()
    : null;

  // ── Meal Plan content ──
  const mealPlanContent = !mealPlan ? (
    <div
      className="sf-surface-card flex flex-col items-center gap-4 px-8 py-20 text-center"
      style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}
    >
      <p className="text-sm font-semibold">No meal plan yet</p>
      <p className="mt-1 text-sm text-zinc-400">
        Your coach hasn&apos;t published a meal plan yet. Check back soon!
      </p>
    </div>
  ) : (
    <div className="space-y-6">
      {cardioPrescription && (
        <div className="sf-glass-card px-5 py-4" style={{ borderColor: "rgba(34, 197, 94, 0.20)" }}>
          <div className="mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-green-400">Cardio Prescription</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {cardioPrescription.modality && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300">
                <span className="font-normal text-green-500/60">Type</span>{cardioPrescription.modality}
              </span>
            )}
            {cardioPrescription.frequency && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300">
                <span className="font-normal text-green-500/60">Frequency</span>{cardioPrescription.frequency}
              </span>
            )}
            {cardioPrescription.duration && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300">
                <span className="font-normal text-green-500/60">Duration</span>{cardioPrescription.duration}
              </span>
            )}
            {cardioPrescription.intensity && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300">
                <span className="font-normal text-green-500/60">Intensity</span>{cardioPrescription.intensity}
              </span>
            )}
          </div>
          {cardioPrescription.notes && (
            <p className="mt-2.5 text-xs leading-relaxed text-green-400/60">{cardioPrescription.notes}</p>
          )}
        </div>
      )}
      <SimpleMealPlan
        mealPlan={mealPlan}
        adherence={{
          date: todayDate,
          completedMeals: todayAdherence?.meals.filter((m) => m.completed).map((m) => m.mealNameSnapshot) ?? [],
          todayWeekday,
        }}
      />
    </div>
  );

  // ── Training content ──
  const trainingContent = !trainingProgram || trainingProgram.days.length === 0 ? (
    <div
      className="sf-surface-card flex flex-col items-center gap-3 px-8 py-16 text-center"
      style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}
    >
      <p className="text-sm font-semibold text-zinc-300">No training program yet</p>
      <p className="text-sm text-zinc-400">
        Your coach hasn&apos;t published a training program yet.
      </p>
    </div>
  ) : (
    <TrainingProgram
      program={trainingProgram}
      adherence={{
        date: todayDate,
        exercises: todayAdherence?.exercises ?? [],
      }}
      progress={{
        currentWeek,
        previousWeek,
      }}
    />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-white">Plan</h1>
        <p className="mt-1 text-sm text-zinc-500">Your meal plan and training program</p>
      </div>
      <PlanTab mealPlanContent={mealPlanContent} trainingContent={trainingContent} />
    </div>
  );
}
