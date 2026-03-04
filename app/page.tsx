import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

export default async function Home() {
  const { userId, sessionClaims } = await auth();

  if (userId) {
    const role = sessionClaims?.metadata?.role;
    if (role === "coach") {
      redirect("/coach/dashboard");
    }
    redirect("/client");
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-[#09090b]">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/90 backdrop-blur-md dark:border-zinc-800/60 dark:bg-[#09090b]/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
            aria-label="Steadfast home"
          >
            <div className="relative h-8 w-8 sm:h-9 sm:w-9">
              <Image
                src="/brand/Steadfast_logo_pictoral.png"
                alt=""
                fill
                priority
                className="object-contain"
              />
            </div>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Main navigation">
            <Link
              href="/sign-in"
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content">
        {/* ── Hero ── */}
        <section className="flex min-h-[calc(100vh-64px)] items-center px-5 sm:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="relative mx-auto mb-8 h-[32vh] max-h-[400px] w-[32vh] max-w-[400px] animate-fade-in">
              <Image
                src="/brand/Steadfast_logo.png"
                alt="Steadfast"
                fill
                priority
                className="object-contain"
              />
            </div>
            <h1 className="animate-fade-in text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              Structured coaching.{" "}
              <span className="text-zinc-400">Consistent results.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl animate-fade-in text-lg leading-relaxed text-zinc-500 dark:text-zinc-400" style={{ animationDelay: "100ms" }}>
              Weekly check-ins, personalized meal plans, and structured feedback
              — so nothing falls through the cracks.
            </p>
            <div className="mt-10 flex animate-fade-in flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: "200ms" }}>
              <Link
                href="/sign-up"
                className="w-full rounded-xl bg-zinc-900 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 sm:w-auto"
              >
                Create Free Account
              </Link>
              <a
                href="#how-it-works"
                className="w-full rounded-xl border border-zinc-300 px-8 py-3.5 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800 sm:w-auto"
              >
                See How It Works
              </a>
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="border-t border-zinc-200/60 px-5 py-24 dark:border-zinc-800/60 sm:px-8">
          <div className="mx-auto max-w-5xl">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-400">
              How it works
            </p>
            <h2 className="mt-3 text-center text-3xl font-semibold tracking-tight">
              Simple weekly rhythm
            </h2>

            {/* Two workflows */}
            <div className="mt-16 grid gap-16 lg:grid-cols-2">
              {/* Coach workflow */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">For coaches</p>
                <div className="mt-6 space-y-6">
                  <WorkflowStep number={1} title="Collect check-ins" description="Clients submit weight, photos, and notes every week. Everything lands in your inbox." />
                  <WorkflowStep number={2} title="Review and respond" description="See metrics, track trends, and leave feedback — all from one workspace." />
                  <WorkflowStep number={3} title="Publish meal plans" description="Build or import meal plans. Clients see exactly what to eat." />
                </div>
              </div>

              {/* Client workflow */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">For clients</p>
                <div className="mt-6 space-y-6">
                  <WorkflowStep number={1} title="Submit your check-in" description="Log weight, progress photos, and how your week went. Takes 2 minutes." />
                  <WorkflowStep number={2} title="Follow your plan" description="View your personalized meal plan with clear portions and structure." />
                  <WorkflowStep number={3} title="Track your progress" description="See weight trends and coach feedback week over week." />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="border-t border-zinc-200/60 bg-white px-5 py-24 dark:border-zinc-800/60 dark:bg-[#0f0f11] sm:px-8">
          <div className="mx-auto max-w-5xl">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Built for real coaching
            </p>
            <h2 className="mt-3 text-center text-3xl font-semibold tracking-tight">
              Everything you need, nothing you don&apos;t
            </h2>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                title="Weekly Check-Ins"
                description="Weight, photos, diet compliance, energy, and notes. Structured data every week."
              />
              <FeatureCard
                title="Coach Inbox"
                description="See who needs review at a glance. Filter by status. One-click to review."
              />
              <FeatureCard
                title="Meal Plan Editor"
                description="Build meals from a food library. Duplicate, reorder, and publish in minutes."
              />
              <FeatureCard
                title="PDF/Photo Import"
                description="Upload a meal plan image or PDF. OCR extracts the foods automatically."
              />
              <FeatureCard
                title="Secure Uploads"
                description="Progress photos stored in private buckets. Server-signed URLs only."
              />
              <FeatureCard
                title="Weight Tracking"
                description="Automatic trend calculation with visual deltas week over week."
              />
            </div>
          </div>
        </section>

        {/* ── Scripture ── */}
        <section className="border-t border-zinc-200/60 px-5 py-20 dark:border-zinc-800/60 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <blockquote className="text-lg italic leading-relaxed text-zinc-500 dark:text-zinc-400">
              &ldquo;Blessed is the one who perseveres under trial because, having stood the test, that person will receive the crown of life that the Lord has promised to those who love him.&rdquo;
            </blockquote>
            <p className="mt-4 text-sm font-semibold tracking-wide text-zinc-400">
              &mdash; James 1:12
            </p>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="border-t border-zinc-200/60 px-5 py-24 dark:border-zinc-800/60 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Ready to get started?
            </h2>
            <p className="mt-4 text-base text-zinc-500">
              Create your free account and connect with your coach today.
            </p>
            <Link
              href="/sign-up"
              className="mt-8 inline-block rounded-xl bg-zinc-900 px-10 py-3.5 text-sm font-semibold text-white transition-all hover:bg-zinc-700 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Create Free Account
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50 p-6 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800/80 dark:bg-[#121215] dark:hover:border-zinc-700">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function WorkflowStep({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
        {number}
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>
    </div>
  );
}
