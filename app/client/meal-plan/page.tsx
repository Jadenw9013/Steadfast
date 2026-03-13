import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { getTodayAdherence } from "@/lib/queries/adherence";
import { getLocalDate } from "@/lib/utils/date";
import { SimpleMealPlan } from "@/components/client/simple-meal-plan";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";

export default async function ClientMealPlanPage() {
  const user = await getCurrentDbUser();
  const tz = user.timezone || "America/New_York";
  const todayDate = getLocalDate(new Date(), tz);

  const [mealPlan, trainingProgram, todayAdherence] = await Promise.all([
    getCurrentPublishedMealPlan(user.id),
    getPublishedTrainingProgram(user.id),
    getTodayAdherence(user.id, todayDate),
  ]);

  // Extract cardio from training program (__CARDIO__ day)
  const cardioDay = trainingProgram?.days?.find((d) => d.dayName === "__CARDIO__");
  const cardioBlock = cardioDay?.blocks?.[0];
  const cardioPrescription = cardioBlock
    ? (() => {
        const [modality = "", frequency = "", duration = "", intensity = ""] = (cardioBlock.title ?? "").split("|");
        return (modality || frequency || duration || intensity)
          ? { modality: modality.trim(), frequency: frequency.trim(), duration: duration.trim(), intensity: intensity.trim(), notes: cardioBlock.content ?? "" }
          : null;
      })()
    : null;

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/client"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:text-zinc-300"
          aria-label="Back to dashboard"
        >
          &larr; Dashboard
        </Link>

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Meal Plan
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              Your personalized nutrition plan from your coach
            </p>
          </div>
          {mealPlan && <ExportPdfButton mealPlanId={mealPlan.id} variant="small" />}
        </div>
      </section>

      {/* Cardio prescription banner — shown when coach has configured cardio */}
      {cardioPrescription && (
        <section className="animate-fade-in" style={{ animationDelay: "60ms" }} aria-label="Cardio prescription">
          <div className="rounded-2xl border border-green-500/20 bg-green-500/[0.05] px-5 py-4 dark:bg-green-950/20">
            <div className="mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-green-600 dark:text-green-400">Cardio Prescription</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {cardioPrescription.modality && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                  <span className="font-normal text-green-500/60">Type</span>{cardioPrescription.modality}
                </span>
              )}
              {cardioPrescription.frequency && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                  <span className="font-normal text-green-500/60">Frequency</span>{cardioPrescription.frequency}
                </span>
              )}
              {cardioPrescription.duration && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                  <span className="font-normal text-green-500/60">Duration</span>{cardioPrescription.duration}
                </span>
              )}
              {cardioPrescription.intensity && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
                  <span className="font-normal text-green-500/60">Intensity</span>{cardioPrescription.intensity}
                </span>
              )}
            </div>
            {cardioPrescription.notes && (
              <p className="mt-2.5 text-xs leading-relaxed text-green-600/70 dark:text-green-400/60">{cardioPrescription.notes}</p>
            )}
          </div>
        </section>
      )}

      <section
        className="animate-fade-in"
        style={{ animationDelay: "80ms" }}
        aria-labelledby="meal-plan-heading"
      >
        <h2 id="meal-plan-heading" className="sr-only">
          Meal plan details
        </h2>
        {!mealPlan ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-20 text-center dark:border-zinc-700 dark:bg-[#0a1224]">
            <div>
              <p className="text-sm font-semibold">No meal plan yet</p>
              <p className="mt-1 text-sm text-zinc-400">
                Your coach hasn&apos;t published a meal plan yet. Check back soon!
              </p>
            </div>
          </div>
        ) : (
          <SimpleMealPlan
            mealPlan={mealPlan}
            adherence={{
              date: todayDate,
              completedMeals: todayAdherence?.meals.filter((m) => m.completed).map((m) => m.mealNameSnapshot) ?? [],
              todayWeekday: new Date(todayDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long" }),
            }}
          />
        )}
      </section>
    </div>
  );
}
