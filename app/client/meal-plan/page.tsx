import Link from "next/link";
import { getClientProvider } from "@/lib/queries/client-provider";
import { AiClientSurface, ProviderResolution } from "@/components/ai-coach/client-surface";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { getTodayAdherence } from "@/lib/queries/adherence";
import { getLocalDate } from "@/lib/utils/date";
import { SimpleMealPlan } from "@/components/client/simple-meal-plan";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";
import { resolveClientPlanView, logDegradedPlanRender } from "@/lib/meal-plans/client-plan-view";

export default async function ClientMealPlanPage() {
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
          <h1 className="mt-3 text-2xl font-black tracking-tight text-white">Meal Plan</h1>
        </section>
        <div className="sf-surface-card flex flex-col items-center gap-5 px-5 py-14 text-center sm:px-8 sm:py-20" style={{ "--sf-card-highlight": "rgba(59, 91, 219, 0.08)", "--sf-card-atmosphere": "#0e1420" } as React.CSSProperties}>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800/60">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-zinc-100">Meal Plan requires a coach</p>
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

  const [mealPlan, trainingProgram, todayAdherence] = await Promise.all([
    getCurrentPublishedMealPlan(user.id, provider.relationshipStartedAt),
    getPublishedTrainingProgram(user.id, provider.relationshipStartedAt),
    getTodayAdherence(user.id, todayDate),
  ]);

  if (mealPlan) {
    logDegradedPlanRender({
      mealPlanId: mealPlan.id,
      planMode: mealPlan.planMode,
      itemCount: mealPlan.items.length,
      macroTargetCount: mealPlan.macroTargets?.length ?? 0,
      view: resolveClientPlanView({
        planMode: mealPlan.planMode,
        itemCount: mealPlan.items.length,
        macroTargetCount: mealPlan.macroTargets?.length ?? 0,
      }),
    });
  }

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
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          aria-label="Back to dashboard"
        >
          &larr; Dashboard
        </Link>

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white">
              Meal Plan
            </h1>
          </div>
          {mealPlan && <ExportPdfButton mealPlanId={mealPlan.id} variant="small" />}
        </div>
      </section>

      {/* Cardio prescription banner — shown when coach has configured cardio */}
      {cardioPrescription && (
        <section className="animate-fade-in" style={{ animationDelay: "60ms" }} aria-label="Cardio prescription">
          <div className="sf-glass-card px-5 py-4" style={{ borderColor: "rgba(34, 197, 94, 0.20)" }}>
            <div className="mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
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
        <SimpleMealPlan
          mealPlan={mealPlan}
          adherence={{
            date: todayDate,
            completedMeals: todayAdherence?.meals.filter((m) => m.completed).map((m) => m.mealNameSnapshot) ?? [],
            todayWeekday: new Date(todayDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long" }),
          }}
        />
      </section>
    </div>
  );
}
