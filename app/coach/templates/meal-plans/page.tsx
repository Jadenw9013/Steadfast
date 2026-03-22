import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Meal Plan Templates | Steadfast" };

export default function MealPlanTemplatesPage() {
  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/templates"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          &larr; Templates
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Meal Plan Templates
        </h1>
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "80ms" }}>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-16 text-center dark:border-zinc-700 dark:bg-[#0a1224]">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M13 21v-4"/><path d="M11 21v-4"/></svg>
          </div>
          <p className="text-sm font-semibold">Meal plan templates are coming soon.</p>
          <p className="max-w-xs text-sm text-zinc-500">
            You&apos;ll be able to build reusable nutrition frameworks and apply them to any client.
          </p>
        </div>
      </section>
    </div>
  );
}
