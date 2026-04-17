import { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Steadfast - Structured Coaching & Consistent Results",
  description:
    "Steadfast provides structured coaching, weekly check-ins, custom meal plans, and feedback. Your client work, finally organized. Stay accountable, see progress.",
};

export default async function Home() {
  const { userId, sessionClaims } = await auth();

  if (userId) {
    const role = sessionClaims?.metadata?.role;
    if (role === "coach") redirect("/coach/dashboard");
    redirect("/client");
  }

  return (
    <div className="flex min-h-screen flex-col landing-dark-bg text-white">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 bg-[#010612]/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Steadfast home">
            <div className="relative h-7 w-7 transition-transform duration-200 group-hover:scale-110 sm:h-8 sm:w-8">
              <Image src="/brand/Steadfast_logo_pictoral.png" alt="" fill priority className="object-contain" />
            </div>
            <span className="hidden font-display text-xs font-bold uppercase tracking-[0.25em] text-gray-100 sm:inline">Steadfast</span>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Main navigation">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-gray-400 transition-colors hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-gray-900 transition-all hover:bg-gray-200 hover:shadow-sm active:scale-[0.97]"
            >
              Get Started
            </Link>
          </nav>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-gray-700/40 to-transparent" />
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
              <Image src="/brand/Steadfast_logo.png" alt="Steadfast" fill priority className="object-contain drop-shadow-[0_0_40px_rgba(59,130,246,0.15)]" />
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
              className="mx-auto mt-8 max-w-lg animate-fade-in-up text-[15px] leading-relaxed text-gray-400"
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
                className="group w-full rounded-xl border border-gray-700 px-8 py-3.5 text-center font-display text-xs font-semibold uppercase tracking-wider text-gray-400 transition-all hover:border-blue-500/40 hover:text-white sm:w-auto"
              >
                Explore Coaches
              </Link>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce-subtle" style={{ animationDelay: "1200ms" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </section>

        {/* ─ Divider ─ */}
        <div className="divider-glow mx-auto max-w-3xl" />

        {/* ════════════════════════════════════════════
            FOR COACHES — Showcase
        ════════════════════════════════════════════ */}
        <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
          <div className="landing-glow absolute -left-20 top-1/2 h-[400px] w-[400px] bg-blue-500/8" />

          <div className="relative mx-auto max-w-6xl">
            <Reveal>
              <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:gap-16">
                {/* Left: Copy */}
                <div className="flex-1">
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-blue-500">For coaches</p>
                  <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[2.75rem]">
                    Your client work, finally organized.
                  </h2>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-gray-400">
                    Stop juggling DMs, spreadsheets, and PDFs. Steadfast gives you one workspace that shows you exactly what needs attention.
                  </p>

                  <div className="mt-8 space-y-5">
                    <FeatureBullet
                      title="Instant inbox"
                      description="See who submitted, who's late, and who needs feedback — all on one screen sorted by priority."
                    />
                    <FeatureBullet
                      title="AI meal plan import"
                      description="Upload a photo or PDF. OCR + AI extracts foods and portions into a structured, editable draft automatically."
                    />
                    <FeatureBullet
                      title="Week-over-week tracking"
                      description="Automatic weight trend calculation with visual deltas so you can spot stalls and wins instantly."
                    />
                  </div>
                </div>

                {/* Right: Floating Dashboard */}
                <div className="relative flex-1 min-h-[400px] sm:min-h-[460px]">
                  <CoachDashboardMockup />
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─ Divider ─ */}
        <div className="divider-glow mx-auto max-w-3xl" />

        {/* ════════════════════════════════════════════
            FOR CLIENTS — Showcase
        ════════════════════════════════════════════ */}
        <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
          <div className="landing-glow absolute -right-20 top-1/3 h-[350px] w-[350px] bg-indigo-500/8" />

          <div className="relative mx-auto max-w-6xl">
            <Reveal>
              <div className="flex flex-col-reverse gap-12 lg:flex-row lg:items-center lg:gap-16">
                {/* Left: Check-in Mockup */}
                <div className="relative flex-1 min-h-[400px] sm:min-h-[460px]">
                  <CheckInMockup />
                </div>

                {/* Right: Copy */}
                <div className="flex-1">
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-blue-500">For clients</p>
                  <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-[2.75rem]">
                    Stay accountable, see progress.
                  </h2>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-gray-400">
                    Submit your weekly check-in in minutes. Your coach reviews it, leaves feedback, and you keep moving forward.
                  </p>

                  <div className="mt-8 space-y-5">
                    <FeatureBullet
                      title="2-minute check-ins"
                      description="Log weight, progress photos, and how your week went. Quick, structured, and consistent."
                    />
                    <FeatureBullet
                      title="Your meal plan, always visible"
                      description="See exactly what to eat with clear portions, macros, and structure — no guessing."
                    />
                    <FeatureBullet
                      title="Progress you can see"
                      description="Weight trend charts, coach feedback history, and photo comparisons all in one place."
                    />
                  </div>
                </div>
              </div>
            </Reveal>
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
              <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 select-none font-display text-[120px] leading-none text-gray-800/30">&ldquo;</span>

              <blockquote className="relative text-base leading-relaxed italic text-gray-400 sm:text-lg">
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
          <div className="landing-glow absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 bg-blue-500/10" />

          <Reveal>
            <div className="relative mx-auto max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl md:text-5xl">
                Ready to start?
              </h2>
              <p className="mt-4 text-[15px] text-gray-400">
                Create your free account or browse our coach directory.
              </p>
              <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Link href="/sign-up" className="btn-primary w-full px-10 py-3.5 sm:w-auto">
                  Create Free Account
                </Link>
                <Link
                  href="/coaches"
                  className="w-full rounded-xl border border-gray-700 px-10 py-3.5 text-center font-display text-xs font-semibold uppercase tracking-wider text-gray-400 transition-all hover:border-blue-500/40 hover:text-white sm:w-auto"
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
   INLINE COMPONENTS
════════════════════════════════════════════════════════ */

function CoachDashboardMockup() {
  const clients = [
    { initials: "MK", name: "Marcus K.", detail: "Wk 9  ·  −0.8 lbs", color: "bg-blue-500/80", status: "Needs review", statusClass: "dashboard-status-needs" },
    { initials: "SL", name: "Sara L.", detail: "Wk 12  ·  −1.2 lbs", color: "bg-purple-500/80", status: "Needs review", statusClass: "dashboard-status-needs" },
    { initials: "TD", name: "Tyler D.", detail: "Wk 5  ·  +0.1 lbs", color: "bg-emerald-500/80", status: "Reviewed", statusClass: "dashboard-status-done" },
    { initials: "JP", name: "Jamie P.", detail: "Wk 1  ·  Onboarding", color: "bg-amber-500/80", status: "Waiting", statusClass: "dashboard-status-wait" },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center lg:justify-end">
      {/* Main card */}
      <div className="dashboard-card relative w-full max-w-[380px] sm:max-w-[420px]">
        {/* Card header */}
        <div className="dashboard-card-header">
          <span className="font-display text-[13px] font-medium text-gray-200">Coach Inbox</span>
          <span className="dashboard-header-badge">4 to review</span>
        </div>

        {/* Card body */}
        <div className="p-4 sm:p-[18px]">
          {clients.map((c, i) => (
            <div
              key={c.initials}
              className={`flex items-center justify-between py-[9px] ${i < clients.length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${c.color}`}>
                  {c.initials}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-200">{c.name}</p>
                  <p className="mt-px font-mono text-[11px] text-gray-500">{c.detail}</p>
                </div>
              </div>
              <span className={`dashboard-status ${c.statusClass}`}>{c.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Floating stat: check-in rate — bottom-left */}
      <div className="dashboard-float-stat dashboard-float-left hidden lg:block">
        <div className="font-display text-[22px] font-bold leading-none text-blue-400">94<span className="text-lg">%</span></div>
        <p className="mt-1 text-[11px] text-gray-500">Check-in rate</p>
        <p className="font-mono text-[11px] font-semibold text-emerald-400">↑ 6% this month</p>
      </div>

      {/* Floating stat: review time — top-right */}
      <div className="dashboard-float-stat dashboard-float-right hidden lg:block">
        <div className="font-display text-[22px] font-bold leading-none text-teal-400">2 min</div>
        <p className="mt-1 text-[11px] text-gray-500">Avg. review time</p>
        <p className="font-mono text-[11px] font-semibold text-emerald-400">↓ faster than ever</p>
      </div>
    </div>
  );
}

function CheckInMockup() {
  const days = [
    { label: "M", on: true, color: "green" },
    { label: "T", on: true, color: "green" },
    { label: "W", on: true, color: "green" },
    { label: "T", on: true, color: "green" },
    { label: "F", on: true, color: "green" },
    { label: "S", on: true, color: "amber" },
    { label: "S", on: false, color: "none" },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center lg:justify-start">
      {/* Main card */}
      <div className="dashboard-card relative w-full max-w-[380px] sm:max-w-[420px]" style={{ animationDelay: "200ms" }}>
        {/* Card header */}
        <div className="dashboard-card-header">
          <span className="font-display text-[13px] font-medium text-gray-200">Weekly Check-In</span>
          <span className="dashboard-header-badge">Week 12</span>
        </div>

        {/* Card body */}
        <div className="space-y-4 p-4 sm:p-[18px]">
          {/* Weight */}
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Current Weight</p>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-lg font-bold text-gray-200">185.4</span>
                <span className="text-[11px] text-gray-500">lbs</span>
              </div>
              <span className="font-mono text-[11px] font-semibold text-emerald-400">↓ 0.8 lbs</span>
            </div>
          </div>

          {/* Diet compliance */}
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Diet Compliance</p>
            <div className="flex gap-1.5">
              {days.map((d, i) => (
                <div
                  key={i}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-bold"
                  style={{
                    background: d.color === "green" ? "rgba(34,197,94,0.12)" : d.color === "amber" ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.03)",
                    color: d.color === "green" ? "#4ade80" : d.color === "amber" ? "#fbbf24" : "rgba(255,255,255,0.15)",
                    border: `1px solid ${d.color === "green" ? "rgba(34,197,94,0.2)" : d.color === "amber" ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.04)"}`,
                  }}
                >
                  {d.on ? "✓" : d.label}
                </div>
              ))}
            </div>
            <p className="mt-1 font-mono text-[10px] text-gray-500">6 / 7 days on plan</p>
          </div>

          {/* Energy */}
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Energy Level</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <div
                  key={n}
                  className={`flex h-8 flex-1 items-center justify-center rounded-md text-[11px] font-bold ${n <= 4
                    ? "border border-blue-500/20 bg-blue-500/10 text-blue-400"
                    : "border border-white/[0.04] bg-white/[0.03] text-gray-600"
                    }`}
                >
                  {n <= 4 ? "⚡" : n}
                </div>
              ))}
            </div>
            <p className="mt-1 font-mono text-[10px] text-gray-500">4 / 5 — Good energy</p>
          </div>

          {/* Notes */}
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Notes</p>
            <div className="rounded-lg border border-white/[0.04] bg-white/[0.03] px-3 py-2">
              <p className="text-[12px] leading-relaxed text-gray-400">Felt strong this week. Energy was good on training days. Saturday was a social event.</p>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end pt-1">
            <div className="rounded-lg bg-white px-5 py-2 font-display text-[11px] font-bold uppercase tracking-wider text-gray-900">
              Submit Check-In
            </div>
          </div>
        </div>
      </div>

      {/* Floating stat: streak — top-left */}
      <div className="dashboard-float-stat hidden lg:block" style={{ position: "absolute", left: "-110px", top: "-70px", animation: "stat-float-down 7s ease-in-out infinite" }}>
        <div className="font-display text-[22px] font-bold leading-none text-emerald-400">12</div>
        <p className="mt-1 text-[11px] text-gray-500">Week streak</p>
        <p className="font-mono text-[11px] font-semibold text-emerald-400">🔥 Personal best</p>
      </div>

      {/* Floating stat: progress — bottom-right */}
      <div className="dashboard-float-stat hidden lg:block" style={{ position: "absolute", right: "30px", bottom: "-50px", animation: "stat-float-up 9s ease-in-out infinite" }}>
        <div className="font-display text-[22px] font-bold leading-none text-blue-400">−6.2</div>
        <p className="mt-1 text-[11px] text-gray-500">lbs total</p>
        <p className="font-mono text-[11px] font-semibold text-emerald-400">↓ since Week 1</p>
      </div>
    </div>
  );
}

function FeatureBullet({ title, description }: { title: string; description: string }) {
  return (
    <div className="feature-check">
      <svg className="feature-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 12 2 2 4-4" />
        <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
      </svg>
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  );
}
