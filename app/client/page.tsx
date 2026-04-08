import { getCurrentDbUser } from "@/lib/auth/roles";
import { getClientCheckInsLight, getLatestCoachMessage } from "@/lib/queries/check-ins";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getPublishedTrainingProgram } from "@/lib/queries/training-programs";
import { formatDateUTC, getLocalDate } from "@/lib/utils/date";
import { getMyIntake } from "@/lib/queries/client-intake";
import { parseCadenceConfig, getEffectiveCadence, getClientCadenceStatus, cadenceFromLegacyDays, getCadencePreview } from "@/lib/scheduling/cadence";
import { getProfilePhotoUrl } from "@/lib/supabase/profile-photo-storage";
import { getAdherenceEnabled, getTodayAdherence, getTodayMealNames } from "@/lib/queries/adherence";
import { db } from "@/lib/db";
import Link from "next/link";
import Image from "next/image";
import { ConnectCoachBanner } from "@/components/client/connect-coach-banner";
import { MyRequestsCard } from "@/components/client/my-requests-card";
import { getMyCoachingRequests } from "@/lib/queries/my-requests";
import { TestimonialPrompt } from "@/components/client/testimonial-prompt";
import { getTestimonialEligibility } from "@/lib/queries/testimonial-eligibility";
import { BecomeCoachForm } from "@/components/client/become-coach-form";
import { StatusCard, type StatusCardData } from "@/components/client/status-card";
import { deriveStatusState } from "@/lib/status";
import { TodayAdherence } from "@/components/client/today-adherence";
import { DeleteCheckInButton } from "@/components/client/delete-check-in-button";
import { RecentCheckIns } from "@/components/client/recent-check-ins";
import { WeightProgress } from "@/components/charts/weight-progress";
import { getWeightHistory } from "@/lib/queries/weight-history";
import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
import timezonePlugin from "dayjs/plugin/timezone";


dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

export default async function ClientDashboard() {
  const user = await getCurrentDbUser();

  const coachAssignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: {
      id: true,
      cadenceConfig: true,
      coach: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          checkInDaysOfWeek: true,
          cadenceConfig: true,
          coachProfile: { select: { welcomeMessage: true, slug: true, isPublished: true, bannerPhotoPath: true } },
          profilePhotoPath: true,
        },
      },
    },
  });

  const tz = user.timezone || "America/Los_Angeles";
  const todayDate = getLocalDate(new Date(), tz);
  const todayLabel = dayjs(new Date()).tz(tz).format("MMM D, YYYY");

  // ── No-coach state: early return with focused layout ──────────────────────
  if (!coachAssignment) {
    const [myRequests, checkIns] = await Promise.all([
      getMyCoachingRequests(),
      getClientCheckInsLight(user.id),
    ]);
    return (
      <div className="space-y-6">
        <section className="animate-fade-in">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/80">STEADFAST</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wider text-zinc-500">{todayLabel}</p>
          </div>
        </section>

        {myRequests.length > 0 && <MyRequestsCard requests={myRequests} />}

        <section className="animate-fade-in" style={{ animationDelay: "60ms" }}>
          <div className="flex flex-col items-center gap-5 rounded-2xl border border-blue-500/20 bg-blue-500/[0.05] px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-white">Find Your Coach</h2>
              <p className="text-sm text-zinc-400">Browse coaches, send a request, and get started on your fitness journey.</p>
            </div>
            <Link
              href="/coaches"
              className="sf-button-primary block w-full text-center"
              style={{ minHeight: "48px" }}
            >
              Browse Coaches
            </Link>
          </div>
        </section>

        {checkIns.length > 0 && (
          <section className="animate-fade-in" style={{ animationDelay: "100ms" }}>
            <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Your Previous Data</p>
            <div className="space-y-2">
              {checkIns.slice(0, 5).map((checkIn) => {
                const dateLabel = checkIn.submittedAt.toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                });
                return (
                  <Link
                    key={checkIn.id}
                    href={`/client/check-ins/${checkIn.id}`}
                    className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                    style={{ minHeight: "52px" }}
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{dateLabel}</p>
                      {checkIn.weight && (
                        <p className="text-xs text-zinc-500">{Number(checkIn.weight).toFixed(1)} lbs</p>
                      )}
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-600" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {!user.isCoach && (
          <div className="animate-fade-in" style={{ animationDelay: "200ms" }}>
            <BecomeCoachForm />
          </div>
        )}
      </div>
    );
  }

  const [checkIns, mealPlan, latestCoachMessage, weightHistory, trainingProgram, pendingIntake, adherenceEnabled, todayAdherence, planMeals] = await Promise.all([
    getClientCheckInsLight(user.id),
    getCurrentPublishedMealPlan(user.id),
    getLatestCoachMessage(user.id),
    getWeightHistory(user.id),
    getPublishedTrainingProgram(user.id),
    getMyIntake(user.id),
    getAdherenceEnabled(user.id),
    getTodayAdherence(user.id, todayDate),
    getTodayMealNames(user.id),
  ]);

  // ── Cadence-aware status derivation ──────────────────────────────────────

  const coachCadence = coachAssignment
    ? parseCadenceConfig(coachAssignment.coach.cadenceConfig)
    : null;
  const clientCadenceOverride = coachAssignment
    ? parseCadenceConfig(coachAssignment.cadenceConfig)
    : null;
  const effectiveCadence = coachAssignment
    ? getEffectiveCadence(
      coachCadence ?? cadenceFromLegacyDays(coachAssignment.coach.checkInDaysOfWeek),
      clientCadenceOverride
    )
    : null;

  const latestCheckIn = checkIns[0] ?? null;
  const cadenceResult = effectiveCadence
    ? getClientCadenceStatus(
      effectiveCadence,
      latestCheckIn ? { submittedAt: latestCheckIn.submittedAt, status: latestCheckIn.status } : null,
      tz
    )
    : null;


  const cadencePreview = effectiveCadence ? getCadencePreview(effectiveCadence) : null;
  const nextDueLabel = cadencePreview ?? undefined;



  const latestWeight = checkIns.find((c) => c.weight != null);
  const prevWeight = latestWeight
    ? checkIns.find((c) => c.weight != null && c.id !== latestWeight.id)
    : null;
  const weightDelta =
    latestWeight?.weight && prevWeight?.weight
      ? +(latestWeight.weight - prevWeight.weight).toFixed(1)
      : null;

  let coachAvatarUrl: string | null = null;
  if (coachAssignment) {
    const avatarPath = coachAssignment.coach.profilePhotoPath;
    if (avatarPath) {
      try { coachAvatarUrl = await getProfilePhotoUrl(avatarPath); } catch { /* */ }
    }
  }
  const coachInitial = coachAssignment?.coach.firstName?.[0] ?? "C";

  // ── iOS-style status derivation ─────────────────────────────────────────
  const weeklyAdherenceScore = (() => {
    if (!latestCheckIn) return null;
    const diet = (latestCheckIn.dietCompliance ?? 0) * 10;
    const energy = (latestCheckIn.energyLevel ?? 0) * 10;
    if (latestCheckIn.dietCompliance != null && latestCheckIn.energyLevel != null) {
      return Math.round(diet * 0.75 + energy * 0.25);
    }
    if (latestCheckIn.dietCompliance != null) return diet;
    if (latestCheckIn.energyLevel != null) return energy;
    return null;
  })();

  const statusState = coachAssignment
    ? deriveStatusState({
      cadenceStatus: cadenceResult?.status ?? null,
      weeklyScore: weeklyAdherenceScore,
      liveScore: null, // live adherence not yet computed server-side
    })
    : null;

  // Streak: count consecutive on-track or locked-in check-ins
  const streakWeeks = (() => {
    if (statusState === "overdue") return 0;
    let streak = 0;
    for (const ci of checkIns) {
      const d = (ci.dietCompliance ?? 0) * 10;
      const e = (ci.energyLevel ?? 0) * 10;
      let score = 70;
      if (ci.dietCompliance != null && ci.energyLevel != null) {
        score = Math.round(d * 0.75 + e * 0.25);
      } else if (ci.dietCompliance != null) {
        score = d;
      } else if (ci.energyLevel != null) {
        score = e;
      }
      if (score >= 65) streak++;
      else break;
    }
    return streak;
  })();

  const statusCardData: StatusCardData | null = statusState
    ? {
      state: statusState,
      streakWeeks,
      opensCheckIn: cadenceResult?.status === "due" || cadenceResult?.status === "overdue",
    }
    : null;

  return (
    <div className="space-y-6">
      {/* ── Masthead (iOS-style) ────────────────────────────────────────────── */}
      <section className="animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/80">
              STEADFAST
            </p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wider text-zinc-500">
              {todayLabel}
            </p>
          </div>

          {coachAssignment && (() => {
            const slug = coachAssignment.coach.coachProfile?.slug;
            const isPublished = coachAssignment.coach.coachProfile?.isPublished;
            const badge = (
              <div className={`sf-glass-card flex items-center gap-2.5 px-3 py-2 ${slug && isPublished ? "transition-colors hover:border-white/[0.16]" : ""}`}>
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-white/[0.12] bg-zinc-800">
                  {coachAvatarUrl ? (
                    <Image src={coachAvatarUrl} alt="" width={28} height={28} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-zinc-300">
                      {coachInitial}
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-white leading-tight">
                    {coachAssignment.coach.firstName ? coachAssignment.coach.firstName.toLowerCase() : "Your Coach"}
                  </span>
                  <span className="text-[11px] font-medium text-zinc-400">Coach</span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 ml-0.5" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </div>
            );
            return slug && isPublished ? (
              <Link href={`/coaches/${slug}`}>{badge}</Link>
            ) : badge;
          })()}
        </div>
      </section>


      {/* Intake questionnaire banner */}
      {pendingIntake && (pendingIntake.status === "PENDING" || pendingIntake.status === "IN_PROGRESS") && (
        <div className="animate-fade-in" style={{ animationDelay: "40ms" }}>
          <Link
            href="/client/intake"
            className="group flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-blue-500/20 bg-blue-950/30 px-6 py-5 transition-all hover:border-blue-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                {pendingIntake.status === "IN_PROGRESS" ? "Continue Intake" : "Action Required"}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-blue-100">
                {pendingIntake.status === "IN_PROGRESS"
                  ? "Your intake is in progress"
                  : "Your coach sent you an intake questionnaire"}
              </p>
              <p className="mt-0.5 text-xs text-blue-400/70">
                {pendingIntake.status === "IN_PROGRESS"
                  ? "Pick up where you left off"
                  : "Provide your baseline stats and goals to get started"}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-blue-400 transition-transform group-hover:translate-x-0.5">
              {pendingIntake.status === "IN_PROGRESS" ? "Continue →" : "Start →"}
            </span>
          </Link>
        </div>
      )}

      {/* Testimonial prompt */}
      {coachAssignment && await (async () => {
        const eligibility = await getTestimonialEligibility(user.id);
        if (!eligibility.coachId) return null;
        return (
          <TestimonialPrompt
            coachId={eligibility.coachId}
            coachName={eligibility.coachName!}
            hasExisting={!eligibility.eligible}
          />
        );
      })()}

      {/* Primary Status Card (iOS-style atmospheric card) */}
      {statusCardData && (
        <div className="animate-fade-in" style={{ animationDelay: "80ms" }}>
          <StatusCard data={statusCardData} />
        </div>
      )}

      {/* Your Program — 2-card grid */}
      {(mealPlan || (trainingProgram && trainingProgram.days.length > 0)) && (
        <section
          className="animate-fade-in"
          style={{ animationDelay: "60ms" }}
          aria-labelledby="plans-heading"
        >
          <h2
            id="plans-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400"
          >
            Your Program
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {mealPlan ? (
              <Link
                href="/client/meal-plan"
                className="group flex flex-col gap-2 overflow-hidden sf-glass-card p-4 sm:p-5 transition-all hover:border-blue-500/20 hover:shadow-lg hover:shadow-zinc-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                aria-label="View your nutrition plan"
                style={{ minHeight: "100px" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Nutrition</p>
                <p className="text-sm font-bold text-zinc-100">Meal Plan</p>
                <span className="mt-auto text-xs font-medium text-zinc-500 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
                  Open Plan →
                </span>
              </Link>
            ) : (
              <div className="flex flex-col gap-2 overflow-hidden sf-surface-card p-4 sm:p-5" style={{ minHeight: "100px" }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/60">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Nutrition</p>
                <p className="text-sm text-zinc-600">Not yet assigned</p>
              </div>
            )}

            {trainingProgram && trainingProgram.days.length > 0 ? (
              <Link
                href="/client/training"
                className="group flex flex-col gap-2 overflow-hidden sf-glass-card p-4 sm:p-5 transition-all hover:border-emerald-500/20 hover:shadow-lg hover:shadow-zinc-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                aria-label="View your training program"
                style={{ minHeight: "100px" }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true"><path d="M6 5v11"/><path d="M18 5v11"/><path d="M2 9h4"/><path d="M18 9h4"/><path d="M2 15h4"/><path d="M18 15h4"/><path d="M6 9h12"/><path d="M6 15h12"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Training</p>
                <p className="text-sm font-bold text-zinc-100">Workout Program</p>
                <span className="mt-auto text-xs font-medium text-zinc-500 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
                  Open Program →
                </span>
              </Link>
            ) : (
              <div className="flex flex-col gap-2 overflow-hidden sf-surface-card p-4 sm:p-5" style={{ minHeight: "100px" }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/60">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600" aria-hidden="true"><path d="M6 5v11"/><path d="M18 5v11"/><path d="M2 9h4"/><path d="M18 9h4"/><path d="M2 15h4"/><path d="M18 15h4"/><path d="M6 9h12"/><path d="M6 15h12"/></svg>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Training</p>
                <p className="text-sm text-zinc-600">Not yet assigned</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Cardio Prescription strip */}
      {(() => {
        const cardioDay = trainingProgram?.days?.find((d) => d.dayName === "__CARDIO__");
        const b = cardioDay?.blocks?.[0];
        if (!b) return null;
        const [modality = "", frequency = "", duration = "", intensity = ""] = (b.title ?? "").split("|");
        if (!modality && !frequency && !duration && !intensity) return null;
        const chips = [
          modality && { label: "Type", value: modality.trim() },
          frequency && { label: "Frequency", value: frequency.trim() },
          duration && { label: "Duration", value: duration.trim() },
          intensity && { label: "Intensity", value: intensity.trim() },
        ].filter(Boolean) as { label: string; value: string }[];
        return (
          <section className="animate-fade-in" style={{ animationDelay: "70ms" }} aria-label="Cardio prescription">
            <div className="rounded-2xl border border-green-500/20 bg-green-500/[0.05] px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-green-400">Cardio Prescription</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {chips.map(({ label, value }) => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300">
                    <span className="font-normal text-green-500/60">{label}</span>
                    {value}
                  </span>
                ))}
              </div>
              {b.content && (
                <p className="mt-2.5 text-xs leading-relaxed text-green-400/60">{b.content}</p>
              )}
            </div>
          </section>
        );
      })()}

      {/* Guidance & Support */}
      {mealPlan?.supportContent && (
        <div className="animate-fade-in sf-glass-card p-4" style={{ animationDelay: "120ms" }}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Guidance &amp; Support
          </p>
          <div className="whitespace-pre-wrap text-sm leading-snug text-zinc-300 line-clamp-4">
            {mealPlan.supportContent}
          </div>
        </div>
      )}

      {/* Weight (Surface card — iOS-style) */}
      {latestWeight?.weight && (
        <section
          className="animate-fade-in sf-surface-card"
          style={{
            animationDelay: "180ms",
            "--sf-card-highlight": "rgba(59, 91, 219, 0.12)",
            "--sf-card-atmosphere": "#141C2B",
          } as React.CSSProperties}
          aria-label="Weight overview"
        >
          <div className="sf-surface-edge" aria-hidden="true" />
          <div className="relative z-[1]">
            <p className="text-[13px] font-bold text-white">
              Weight Progress
            </p>
            <p className="mt-1 text-xs font-semibold text-zinc-400">
              as of {latestWeight.submittedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
            <div className="mt-3 flex items-baseline gap-1">
              <p className="text-[44px] font-black tabular-nums tracking-tight text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                {Number(latestWeight.weight).toFixed(1)}
              </p>
              <span className="text-sm font-bold text-white/60">LBS</span>
              {weightDelta != null && weightDelta !== 0 && (
                <span
                  className={`ml-3 rounded-full px-2.5 py-0.5 text-xs font-semibold ${weightDelta < 0
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-amber-500/20 text-amber-400"
                    }`}
                >
                  {weightDelta < 0 ? "\u2193" : "\u2191"} {Math.abs(weightDelta)} lbs
                </span>
              )}
            </div>
            <WeightProgress
              data={weightHistory}
              clientId={user.id}
              className="mt-4"
            />
          </div>
        </section>
      )}

      {/* Today Adherence */}
      {adherenceEnabled && (
        <div className="animate-fade-in" style={{ animationDelay: "140ms" }}>
          <TodayAdherence
            date={todayDate}
            planMeals={planMeals}
            existingMeals={todayAdherence?.meals ?? []}
            workoutCompleted={todayAdherence?.workoutCompleted ?? false}
          />
        </div>
      )}

      {/* Recent Check-Ins — collapsible dropdown */}
      <RecentCheckIns
        checkIns={checkIns.map((ci) => ({
          id: ci.id,
          weight: ci.weight,
          status: ci.status,
          notes: ci.notes,
          submittedAt: ci.submittedAt.toISOString(),
          _count: ci._count,
        }))}
      />

      {latestCoachMessage && (() => {
        // Parse check-in protocol messages — don't show raw [CHECKIN:...] strings
        const checkinMatch = latestCoachMessage.body.match(/^\[CHECKIN:([a-zA-Z0-9_-]+):([^\]]+)\]([\s\S]*)$/);
        const isCheckIn = !!checkinMatch;
        const checkInId = checkinMatch?.[1];
        const checkInDate = checkinMatch?.[2];
        const checkInNotes = checkinMatch?.[3]?.trim();

        const href = isCheckIn && checkInId
          ? `/client/check-ins/${checkInId}`
          : `/client/messages/${formatDateUTC(latestCoachMessage.weekOf)}`;

        return (
          <Link
            href={href}
            className="group animate-fade-in block overflow-hidden sf-glass-card p-5 transition-all hover:border-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1e]"
            style={{ animationDelay: "160ms" }}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                {isCheckIn ? "Latest Check-In" : "Coach Feedback"}
              </p>
              <span className="text-xs font-medium text-zinc-400 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
                View →
              </span>
            </div>

            {isCheckIn ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-200">
                    Check-in submitted
                  </p>
                  <p className="text-xs text-zinc-400">
                    {checkInDate}{checkInNotes && checkInNotes !== "Check-in submitted" ? ` · ${checkInNotes}` : ""}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-zinc-300 line-clamp-2">
                {latestCoachMessage.body}
              </p>
            )}
          </Link>
        );
      })()}

      {/* Become a Coach */}
      {!user.isCoach && (
        <div className="animate-fade-in" style={{ animationDelay: "200ms" }}>
          <BecomeCoachForm />
        </div>
      )}
    </div>
  );
}
