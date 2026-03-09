import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { LandingThemeToggle } from "@/components/ui/landing-theme-toggle";
import { Reveal, StaggerReveal } from "@/components/ui/reveal";

export default async function Home() {
  const { userId, sessionClaims } = await auth();

  if (userId) {
    const role = sessionClaims?.metadata?.role;
    if (role === "coach") redirect("/coach/dashboard");
    redirect("/client");
  }

  return (
    <div className="flex min-h-screen flex-col dot-grid">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Steadfast home">
            <div className="relative h-7 w-7 transition-transform duration-200 group-hover:scale-110 sm:h-8 sm:w-8">
              <Image src="/brand/Steadfast_logo_pictoral.png" alt="" fill priority className="object-contain brightness-0 dark:brightness-100" />
            </div>
            <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-gray-900 dark:text-gray-100 sm:inline">Steadfast</span>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Main navigation">
            <LandingThemeToggle />
            <Link
              href="/sign-in"
              className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-gray-800 hover:shadow-sm active:scale-[0.97] dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              Get Started
            </Link>
          </nav>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-gray-700/40" />
      </header>

      <main id="main-content" className="relative z-10">
        {/* ════════════════════════════════════════════
            HERO
        ════════════════════════════════════════════ */}
        <section className="relative flex min-h-[calc(100vh-56px)] items-center justify-center overflow-hidden px-5 sm:px-8">
          {/* Double glow */}
          <div className="pointer-events-none absolute left-1/2 top-[32%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/8 blur-[120px] animate-pulse-glow sm:h-[500px] sm:w-[500px]" />
          <div className="pointer-events-none absolute left-1/2 top-[32%] h-[160px] w-[160px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/15 blur-[50px] animate-pulse-glow-inner sm:h-[220px] sm:w-[220px]" />

          <div className="relative mx-auto max-w-4xl text-center">
            {/* Logo */}
            <div className="relative mx-auto mb-14 h-[140px] w-[140px] animate-fade-in sm:h-[180px] sm:w-[180px]">
              <Image src="/brand/Steadfast_logo.png" alt="Steadfast" fill priority className="object-contain brightness-0 drop-shadow-[0_0_40px_rgba(0,0,0,0.1)] dark:brightness-100 dark:drop-shadow-[0_0_40px_rgba(59,130,246,0.15)]" />
            </div>

            {/* Headline */}
            <h1
              className="animate-fade-in-up font-display text-balance text-5xl font-bold uppercase leading-[0.92] tracking-tight sm:text-6xl md:text-7xl lg:text-8xl"
              style={{ animationDelay: "120ms" }}
            >
              Structured coaching.
              <br />
              <span className="text-gradient-shift">Consistent results.</span>
            </h1>

            {/* Subtitle */}
            <p
              className="mx-auto mt-8 max-w-lg animate-fade-in-up text-[15px] leading-relaxed text-gray-500 dark:text-gray-400"
              style={{ animationDelay: "280ms" }}
            >
              Weekly check-ins, custom meal plans, and structured feedback&mdash;so nothing falls through the cracks.
            </p>

            {/* CTAs */}
            <div
              className="mt-10 flex animate-fade-in-up flex-col items-center gap-3 sm:flex-row sm:justify-center"
              style={{ animationDelay: "420ms" }}
            >
              <Link href="/sign-up" className="btn-primary w-full px-8 py-3.5 sm:w-auto">
                Create Free Account
              </Link>
              <Link
                href="/coaches"
                className="group w-full rounded-xl border border-gray-300 px-8 py-3.5 text-center font-display text-xs font-semibold uppercase tracking-wider text-gray-500 transition-all hover:border-blue-500/40 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500/40 dark:hover:text-white sm:w-auto"
              >
                Explore Coaches
              </Link>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce-subtle" style={{ animationDelay: "1200ms" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-gray-600">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </section>

        {/* ─ Divider ─ */}
        <div className="divider-glow mx-auto max-w-3xl" />

        {/* ════════════════════════════════════════════
            HOW IT WORKS
        ════════════════════════════════════════════ */}
        <section id="how-it-works" className="px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <div className="flex items-center justify-center gap-2.5">
                <div className="h-0.5 w-5 rounded-full bg-blue-500" />
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-gray-400">How it works</p>
              </div>
              <h2 className="mt-4 text-center font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl md:text-5xl">
                Simple weekly rhythm
              </h2>
            </Reveal>

            <div className="mt-20 grid gap-20 lg:grid-cols-2">
              {/* Coaches column */}
              <Reveal delay={100}>
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-blue-500">For coaches</p>
                <div className="relative mt-8 space-y-0">
                  <div className="absolute left-[19px] top-10 bottom-10 w-px bg-gradient-to-b from-blue-500/25 via-blue-500/10 to-transparent" />
                  <WorkflowStep number="01" title="Collect check-ins" description="Clients submit weight, photos, and notes every week. Everything lands in your inbox." />
                  <WorkflowStep number="02" title="Review and respond" description="See metrics, track trends, and leave feedback — all from one workspace." />
                  <WorkflowStep number="03" title="Publish meal plans" description="Build or import meal plans. Clients see exactly what to eat." last />
                </div>
              </Reveal>

              {/* Clients column */}
              <Reveal delay={250}>
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-blue-500">For clients</p>
                <div className="relative mt-8 space-y-0">
                  <div className="absolute left-[19px] top-10 bottom-10 w-px bg-gradient-to-b from-blue-500/25 via-blue-500/10 to-transparent" />
                  <WorkflowStep number="01" title="Submit your check-in" description="Log weight, progress photos, and how your week went. Takes 2 minutes." />
                  <WorkflowStep number="02" title="Follow your plan" description="View your personalized meal plan with clear portions and structure." />
                  <WorkflowStep number="03" title="Track your progress" description="See weight trends and coach feedback week over week." last />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ─ Divider ─ */}
        <div className="divider-glow mx-auto max-w-3xl" />

        {/* ════════════════════════════════════════════
            FEATURES
        ════════════════════════════════════════════ */}
        <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
          {/* Subtle ambient light */}
          <div className="pointer-events-none absolute -top-40 left-1/3 h-[500px] w-[500px] rounded-full bg-blue-500/[0.03] blur-[140px]" />
          <div className="pointer-events-none absolute -bottom-40 right-1/3 h-[500px] w-[500px] rounded-full bg-indigo-500/[0.02] blur-[140px]" />

          <div className="relative mx-auto max-w-5xl">
            <Reveal>
              <div className="flex items-center justify-center gap-2.5">
                <div className="h-0.5 w-5 rounded-full bg-blue-500" />
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-gray-400">Features</p>
              </div>
              <h2 className="mt-4 text-center font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl md:text-5xl">
                Everything you need
              </h2>
            </Reveal>

            <StaggerReveal className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" staggerMs={70}>
              {features.map((f) => (
                <FeatureCard key={f.title} {...f} />
              ))}
            </StaggerReveal>
          </div>
        </section>

        {/* ─ Divider ─ */}
        <div className="divider-glow mx-auto max-w-3xl" />

        {/* ════════════════════════════════════════════
            SCRIPTURE
        ════════════════════════════════════════════ */}
        <section className="px-5 py-24 sm:px-8 sm:py-28">
          <Reveal>
            <div className="relative mx-auto max-w-xl text-center">
              {/* Decorative quote mark */}
              <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 select-none font-display text-[120px] leading-none text-gray-200/40 dark:text-gray-800/30">&ldquo;</span>

              <blockquote className="relative text-base leading-relaxed italic text-gray-500 dark:text-gray-400 sm:text-lg">
                Blessed is the one who perseveres under trial because, having stood the test, that person will receive the crown of life that the Lord has promised to those who love him.
              </blockquote>
              <p className="mt-6 font-display text-[11px] font-bold uppercase tracking-[0.3em] text-blue-500">
                James 1:12
              </p>
            </div>
          </Reveal>
        </section>

        {/* ─ Divider ─ */}
        <div className="divider-glow mx-auto max-w-3xl" />

        {/* ════════════════════════════════════════════
            BOTTOM CTA
        ════════════════════════════════════════════ */}
        <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/[0.04] blur-[100px]" />

          <Reveal>
            <div className="relative mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl md:text-5xl">
                Ready to start?
              </h2>
              <p className="mt-4 text-[15px] text-gray-500 dark:text-gray-400">
                Create your free account or browse our coach directory.
              </p>
              <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Link href="/sign-up" className="btn-primary w-full px-10 py-3.5 sm:w-auto">
                  Create Free Account
                </Link>
                <Link
                  href="/coaches"
                  className="w-full rounded-xl border border-gray-300 px-10 py-3.5 text-center font-display text-xs font-semibold uppercase tracking-wider text-gray-500 transition-all hover:border-blue-500/40 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500/40 dark:hover:text-white sm:w-auto"
                >
                  Explore Coaches
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   FEATURES DATA
════════════════════════════════════════════════════════ */

const features = [
  {
    title: "Weekly Check-Ins",
    description: "Weight, photos, diet compliance, energy, and notes. Structured data every week.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Coach Inbox",
    description: "See who needs review at a glance. Filter by status. One-click to review.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    title: "Meal Plan Editor",
    description: "Build meals from a food library. Duplicate, reorder, and publish in minutes.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
        <path d="M7 2v20" />
        <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
      </svg>
    ),
  },
  {
    title: "PDF & Photo Import",
    description: "Upload a meal plan image or PDF. OCR extracts the foods automatically.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <polyline points="9 15 12 12 15 15" />
      </svg>
    ),
  },
  {
    title: "Secure Uploads",
    description: "Progress photos in private buckets. Server-signed URLs only.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Weight Tracking",
    description: "Automatic trend calculation with visual deltas week over week.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
  },
  {
    title: "Find a Coach",
    description: "Browse coaches, submit intake requests, and get matched — all in-platform.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    title: "Onboarding Forms",
    description: "Coaches define intake questions. New clients complete them automatically.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    title: "Training Programs",
    description: "Structured workout programming with exercise tracking and progression.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
];

/* ════════════════════════════════════════════════════════
   COMPONENTS
════════════════════════════════════════════════════════ */

function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card-glass stagger-item group rounded-2xl p-6">
      <div className="mb-4 h-5 w-5 text-gray-400 transition-colors group-hover:text-blue-500 dark:text-gray-500 dark:group-hover:text-blue-400">
        {icon}
      </div>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>
    </div>
  );
}

function WorkflowStep({
  number,
  title,
  description,
  last = false,
}: {
  number: string;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div className={`group flex items-start gap-5 ${last ? "" : "pb-10"}`}>
      {/* Numbered circle */}
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <span className="relative z-10 font-display text-xs font-bold tabular-nums text-gray-400 transition-colors group-hover:text-blue-500 dark:text-gray-600 dark:group-hover:text-blue-400">
          {number}
        </span>
        <div className="absolute inset-0 rounded-full border border-gray-200 transition-all group-hover:border-blue-500/40 group-hover:shadow-[0_0_16px_rgba(59,130,246,0.12)] dark:border-gray-800 dark:group-hover:border-blue-500/30" />
      </div>

      {/* Content */}
      <div className="pt-2">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>
      </div>
    </div>
  );
}
