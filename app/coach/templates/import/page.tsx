import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { WorkoutImportFlow } from "@/components/coach/training-import/import-flow";

export default async function ImportWorkoutTemplatePage() {
  await getCurrentDbUser(); // auth gate — throws if not authenticated coach

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/templates/workouts"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:text-zinc-300"
          aria-label="Back to templates"
        >
          &larr; Templates
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Import Workout Plan</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Upload a file or paste workout text. We&apos;ll parse it into days and
          blocks for you to review before saving.
        </p>
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "80ms" }}>
        <WorkoutImportFlow />
      </section>
    </div>
  );
}
