import Link from "next/link";
import { getClientProvider } from "@/lib/queries/client-provider";
import { AiClientSurface, ProviderResolution } from "@/components/ai-coach/client-surface";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { getTodayAdherence } from "@/lib/queries/adherence";
import { getExerciseResultsForWeek, getPreviousExerciseResults } from "@/lib/queries/exercise-results";
import { getLocalDate, normalizeToMonday } from "@/lib/utils/date";
import { TrainingProgram } from "@/components/client/training-program";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";

export default async function ClientTrainingPage() {
  const user = await getCurrentDbUser();
  const provider = await getClientProvider(user.id);
  if (provider.resolutionRequired) return <ProviderResolution />;
  if (provider.origin === "AI" || provider.aiPreviewAvailable) return <AiClientSurface clientId={user.id} path={["plan"]} />;

  if (provider.origin === "NONE") {
    return (
      <div className="space-y-8">
        <section className="animate-fade-in">
          <Link href="/client" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500" aria-label="Back to dashboard">
            &larr; Dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-white">Training Program</h1>
        </section>
        <div className="sf-surface-card flex flex-col items-center gap-5 px-5 py-14 text-center sm:px-8 sm:py-20" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/60">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-zinc-100">Training Program requires a coach</p>
            <p className="text-sm text-zinc-400">Once you connect with a coach, this will unlock automatically.</p>
          </div>
          <Link href="/coaches" className="sf-button-primary block" style={{ minHeight: "48px" }}>
            Find a Coach
          </Link>
        </div>
      </div>
    );
  }

  const tz = user.timezone || "America/New_York";
  const todayDate = getLocalDate(new Date(), tz);
  const weekOf = normalizeToMonday(new Date());

  const [program, todayAdherence, currentResults, previousResults] = await Promise.all([
    getPublishedTrainingProgram(user.id, provider.relationshipStartedAt),
    getTodayAdherence(user.id, todayDate),
    getExerciseResultsForWeek(user.id, weekOf),
    getPreviousExerciseResults(user.id, weekOf),
  ]);

  // Serialize Maps to plain Records for the client component
  const currentWeek: Record<string, { id: string; exerciseName: string; programDay: string; weight: number; reps: number; createdAt: string }> = {};
  for (const [key, val] of currentResults) {
    currentWeek[key] = { id: val.id, exerciseName: val.exerciseName, programDay: val.programDay, weight: val.weight, reps: val.reps, createdAt: val.createdAt.toISOString() };
  }
  const previousWeek: Record<string, { id: string; exerciseName: string; programDay: string; weight: number; reps: number; createdAt: string }> = {};
  for (const [key, val] of previousResults) {
    previousWeek[key] = { id: val.id, exerciseName: val.exerciseName, programDay: val.programDay, weight: val.weight, reps: val.reps, createdAt: val.createdAt.toISOString() };
  }

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/client"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          aria-label="Back to dashboard"
        >
          &larr; Dashboard
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="text-2xl font-black tracking-tight text-white">Training Program</h1>
            {program && program.days.length > 0 && (
              <span className="sf-section-label shrink-0 text-xs">
                {program.days.length} {program.days.length === 1 ? "day" : "days"}
              </span>
            )}
          </div>
          {program && <ExportPdfButton resourceId={program.id} type="training-program" variant="small" />}
        </div>
        <p className="mt-1.5 text-sm text-zinc-500">
          Select a day to start your workout
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
          <div className="sf-surface-card flex flex-col items-center gap-3 px-5 py-12 text-center sm:px-8 sm:py-16" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
            <p className="text-sm font-semibold text-zinc-300">No training program yet</p>
            <p className="text-sm text-zinc-400">
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
