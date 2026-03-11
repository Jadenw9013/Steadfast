import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { getTodayAdherence } from "@/lib/queries/adherence";
import { getExerciseResultsForWeek, getPreviousExerciseResults } from "@/lib/queries/exercise-results";
import { getLocalDate, normalizeToMonday } from "@/lib/utils/date";
import { TrainingProgram } from "@/components/client/training-program";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";

export default async function ClientTrainingPage() {
  const user = await getCurrentDbUser();
  const tz = user.timezone || "America/New_York";
  const todayDate = getLocalDate(new Date(), tz);
  const weekOf = normalizeToMonday(new Date());

  const [program, todayAdherence, currentResults, previousResults] = await Promise.all([
    getPublishedTrainingProgram(user.id),
    getTodayAdherence(user.id, todayDate),
    getExerciseResultsForWeek(user.id, weekOf),
    getPreviousExerciseResults(user.id, weekOf),
  ]);

  // Serialize Maps to plain Records for the client component
  const currentWeek: Record<string, { exerciseName: string; programDay: string; weight: number; reps: number }> = {};
  for (const [key, val] of currentResults) {
    currentWeek[key] = { exerciseName: val.exerciseName, programDay: val.programDay, weight: val.weight, reps: val.reps };
  }
  const previousWeek: Record<string, { exerciseName: string; programDay: string; weight: number; reps: number }> = {};
  for (const [key, val] of previousResults) {
    previousWeek[key] = { exerciseName: val.exerciseName, programDay: val.programDay, weight: val.weight, reps: val.reps };
  }

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/client"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:text-zinc-500 dark:hover:text-zinc-300"
          aria-label="Back to dashboard"
        >
          &larr; Dashboard
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Your Training Program</h1>
            {program && program.days.length > 0 && (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                {program.days.length} {program.days.length === 1 ? "day" : "days"}
              </span>
            )}
          </div>
          {program && <ExportPdfButton resourceId={program.id} type="training-program" variant="small" />}
        </div>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-zinc-500">
          Tap a day to expand your workout
        </p>
      </section>

      <section
        className="animate-fade-in"
        style={{ animationDelay: "80ms" }}
        aria-labelledby="training-program-heading"
      >
        <h2 id="training-program-heading" className="sr-only">
          Training program
        </h2>
        {!program || program.days.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-700 dark:bg-[#0a1224] dark:shadow-none">
            <p className="text-sm font-semibold">No training program yet</p>
            <p className="text-sm text-gray-400 dark:text-zinc-400">
              Your coach hasn&apos;t published a training program yet.
            </p>
          </div>
        ) : (
          <TrainingProgram
            program={program}
            adherence={{
              date: todayDate,
              exercises: todayAdherence?.exercises ?? [],
            }}
            progress={{
              currentWeek,
              previousWeek,
            }}
          />
        )}
      </section>
    </div>
  );
}
