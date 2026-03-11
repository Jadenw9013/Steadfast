import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { SimpleMealPlan } from "@/components/client/simple-meal-plan";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";

export default async function ClientMealPlanPage() {
  const user = await getCurrentDbUser();
  const mealPlan = await getCurrentPublishedMealPlan(user.id);

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
          <SimpleMealPlan mealPlan={mealPlan} />
        )}
      </section>
    </div>
  );
}
